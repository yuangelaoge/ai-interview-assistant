import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import type { AudioChunkPayload, VolcengineSaucConfig } from '../../shared/types';

const protocolVersion = 0b0001;
const headerSize = 0b0001;
const serializationJson = 0b0001;
const serializationNone = 0b0000;
const compressionGzip = 0b0001;
const fullClientRequest = 0b0001;
const audioOnlyRequest = 0b0010;
const fullServerResponse = 0b1001;
const errorResponse = 0b1111;
const positiveSequence = 0b0001;
const lastPacketNoSequence = 0b0010;
const noSequence = 0b0000;

interface SaucResponse {
  result?: {
    text?: string;
    utterances?: Array<{ text?: string; definite?: boolean }>;
  };
  audio_info?: {
    duration?: number;
  };
  message?: string;
}

interface PcmAudio {
  data: Buffer;
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
}

export async function transcribeWithVolcengineSauc(
  config: VolcengineSaucConfig,
  payload: AudioChunkPayload
): Promise<string> {
  validateConfig(config);

  const pcm = normalizeForSauc(extractPcmAudio(Buffer.from(payload.data)));
  if (pcm.length === 0 || isLikelySilentPcm(pcm)) {
    return '';
  }

  const requestId = randomUUID();
  const socket = await openSocket(config, requestId);
  const responses: SaucResponse[] = [];
  const collector = collectResponses(socket, responses);

  try {
    socket.send(buildFullClientRequest(config));
    await waitForFirstResponse(collector, 2_000);

    for (const chunk of splitBuffer(pcm, 3200)) {
      socket.send(buildAudioOnlyRequest(chunk, false));
      await wait(20);
    }

    socket.send(buildAudioOnlyRequest(Buffer.alloc(0), true));
    await waitForRecognitionResult(collector, responses);
  } finally {
    collector.stop();
    socket.close();
  }

  return extractBestText(responses);
}

function openSocket(config: VolcengineSaucConfig, requestId: string): Promise<WebSocket> {
  const headers: Record<string, string> = {
    'X-Api-Resource-Id': config.resourceId.trim(),
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
    'X-Api-Connect-Id': requestId
  };

  if (config.apiKey.trim()) {
    headers['X-Api-Key'] = config.apiKey.trim();
  } else {
    headers['X-Api-App-Key'] = config.appKey.trim();
    headers['X-Api-Access-Key'] = config.accessKey.trim();
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(config.endpoint.trim(), { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('火山流式 ASR 连接超时。'));
    }, 10_000);

    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      response.destroy();
      socket.terminate();
      const message = response.headers['x-api-message'];
      const logId = response.headers['x-tt-logid'];
      reject(
        new Error(
          `火山流式 ASR 建连失败：HTTP ${response.statusCode} ${formatHeader(message) || response.statusMessage || ''}${
            logId ? `，logid=${formatHeader(logId)}` : ''
          }`.trim()
        )
      );
    });
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function formatHeader(value: string | string[] | number | undefined): string {
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return value ? String(value) : '';
}

function buildFullClientRequest(config: VolcengineSaucConfig): Buffer {
  const payload = gzipSync(
    Buffer.from(
      JSON.stringify({
        user: {
          uid: 'interview-assistant'
        },
        audio: {
          format: 'pcm',
          codec: 'raw',
          rate: 16000,
          bits: 16,
          channel: 1
        },
        request: {
          model_name: config.modelName.trim() || 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          show_utterances: true,
          enable_nonstream: config.enableNonstream
        }
      }),
      'utf8'
    )
  );

  return concatFrame(buildHeader(fullClientRequest, noSequence, serializationJson, compressionGzip), payload);
}

function buildAudioOnlyRequest(audio: Buffer, isLast: boolean): Buffer {
  const payload = gzipSync(audio);
  return concatFrame(
    buildHeader(audioOnlyRequest, isLast ? lastPacketNoSequence : noSequence, serializationNone, compressionGzip),
    payload
  );
}

function buildHeader(messageType: number, flags: number, serialization: number, compression: number): Buffer {
  return Buffer.from([
    (protocolVersion << 4) | headerSize,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00
  ]);
}

function concatFrame(header: Buffer, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return Buffer.from(data);
}

function collectResponses(socket: WebSocket, responses: SaucResponse[]) {
  let error: Error | undefined;
  let lastMessageAt = 0;

  const onMessage = (data: WebSocket.RawData) => {
    try {
      const response = parseResponse(toBuffer(data));
      responses.push(response);
      lastMessageAt = Date.now();
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
  };

  const onError = (caught: Error) => {
    error = caught;
  };

  socket.on('message', onMessage);
  socket.on('error', onError);

  return {
    get error() {
      return error;
    },
    get lastMessageAt() {
      return lastMessageAt;
    },
    stop() {
      socket.off('message', onMessage);
      socket.off('error', onError);
    }
  };
}

async function waitForFirstResponse(
  collector: ReturnType<typeof collectResponses>,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (collector.error) {
      throw collector.error;
    }

    if (collector.lastMessageAt > 0) {
      return;
    }

    await wait(30);
  }
}

async function waitForRecognitionResult(
  collector: ReturnType<typeof collectResponses>,
  responses: SaucResponse[]
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (collector.error) {
      throw collector.error;
    }

    const hasText = Boolean(extractBestText(responses));
    const idleFor = collector.lastMessageAt ? Date.now() - collector.lastMessageAt : Number.POSITIVE_INFINITY;
    if (hasText && idleFor > 500) {
      return;
    }

    await wait(80);
  }

  if (responses.length === 0) {
    throw new Error('火山流式 ASR 等待响应超时。');
  }
}

function parseResponse(frame: Buffer): SaucResponse {
  if (frame.length < 8) {
    throw new Error('火山流式 ASR 返回帧过短。');
  }

  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  const compression = frame[2] & 0x0f;
  let offset = (frame[0] & 0x0f) * 4;

  if (messageType === errorResponse) {
    offset += 4;
    const size = frame.readUInt32BE(offset);
    offset += 4;
    const payload = frame.subarray(offset, offset + size).toString('utf8');
    throw new Error(`火山流式 ASR 返回错误：${payload}`);
  }

  if (messageType !== fullServerResponse) {
    return {};
  }

  if (flags === positiveSequence || flags === 0b0011) {
    offset += 4;
  }

  const size = frame.readUInt32BE(offset);
  offset += 4;
  const payload = frame.subarray(offset, offset + size);
  const text = (compression === compressionGzip ? gunzipSync(payload) : payload).toString('utf8');
  return JSON.parse(text) as SaucResponse;
}

function extractBestText(responses: SaucResponse[]): string {
  for (const response of responses.slice().reverse()) {
    const text = response.result?.text?.trim();
    if (text) {
      return text;
    }

    const utteranceText = response.result?.utterances
      ?.map((utterance) => utterance.text?.trim())
      .filter(Boolean)
      .join('');
    if (utteranceText) {
      return utteranceText;
    }
  }

  return '';
}

function extractPcmAudio(buffer: Buffer): PcmAudio {
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    return {
      data: buffer,
      sampleRate: 16000,
      bitsPerSample: 16,
      channels: 1
    };
  }

  let offset = 12;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let channels = 1;
  let data = Buffer.alloc(0);

  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (id === 'fmt ' && size >= 16) {
      channels = buffer.readUInt16LE(offset + 2);
      sampleRate = buffer.readUInt32LE(offset + 4);
      bitsPerSample = buffer.readUInt16LE(offset + 14);
    }

    if (id === 'data') {
      data = Buffer.from(buffer.subarray(offset, offset + size));
    }

    offset += size + (size % 2);
  }

  return {
    data,
    sampleRate,
    bitsPerSample,
    channels
  };
}

function normalizeForSauc(audio: PcmAudio): Buffer {
  if (audio.data.length === 0) {
    return audio.data;
  }

  if (audio.bitsPerSample !== 16) {
    throw new Error(`火山流式 ASR 目前仅支持 16bit PCM，当前音频是 ${audio.bitsPerSample}bit。`);
  }

  const mono = toMonoInt16(audio.data, Math.max(1, audio.channels));
  if (audio.sampleRate === 16000) {
    return int16ToBuffer(mono);
  }

  return int16ToBuffer(resampleLinear(mono, audio.sampleRate, 16000));
}

function toMonoInt16(buffer: Buffer, channels: number): Int16Array {
  const frameCount = Math.floor(buffer.length / 2 / channels);
  const mono = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += buffer.readInt16LE((frame * channels + channel) * 2);
    }
    mono[frame] = clampInt16(Math.round(sum / channels));
  }

  return mono;
}

function resampleLinear(samples: Int16Array, sourceRate: number, targetRate: number): Int16Array {
  if (sourceRate <= 0 || sourceRate === targetRate || samples.length === 0) {
    return samples;
  }

  const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const result = new Int16Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = (index * sourceRate) / targetRate;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const ratio = sourcePosition - leftIndex;
    const sample = samples[leftIndex] * (1 - ratio) + samples[rightIndex] * ratio;
    result[index] = clampInt16(Math.round(sample));
  }

  return result;
}

function int16ToBuffer(samples: Int16Array): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], index * 2);
  }
  return buffer;
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}

function splitBuffer(buffer: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
  }
  return chunks;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isLikelySilentPcm(buffer: Buffer): boolean {
  if (buffer.length < 2) {
    return true;
  }

  let sum = 0;
  const samples = Math.floor(buffer.length / 2);
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    sum += Math.abs(buffer.readInt16LE(offset));
  }

  return sum / samples < 80;
}

function validateConfig(config: VolcengineSaucConfig): void {
  if (!config.endpoint.trim()) {
    throw new Error('缺少火山流式 ASR WebSocket 地址。');
  }

  if (!config.resourceId.trim()) {
    throw new Error('缺少火山流式 ASR Resource ID。');
  }

  if (!config.apiKey.trim() && !(config.appKey.trim() && config.accessKey.trim())) {
    throw new Error('缺少火山流式 ASR 凭据：新版控制台填 X-Api-Key，旧版控制台填 App Key 和 Access Key。');
  }
}
