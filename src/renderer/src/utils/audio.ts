import type { AudioChunkPayload } from '../../../shared/types';

export class MicrophoneRecorder {
  private stream?: MediaStream;
  private audioContext?: AudioContext;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private buffers: Float32Array[] = [];
  private flushTimer?: number;
  private sampleRate = 16000;
  private lastLevelAt = 0;
  private lastVoiceNoticeAt = 0;
  private sequence = 0;
  private readonly onChunk: (payload: AudioChunkPayload) => void;
  private readonly onError: (message: string) => void;
  private readonly onState?: (message: string) => void;
  private readonly onLevel?: (level: number) => void;
  private readonly captureSessionId: string;
  private readonly deviceId: string;

  get sessionId(): string {
    return this.captureSessionId;
  }

  constructor(
    onChunk: (payload: AudioChunkPayload) => void,
    onError: (message: string) => void,
    onState?: (message: string) => void,
    onLevel?: (level: number) => void,
    deviceId = ''
  ) {
    this.onChunk = onChunk;
    this.onError = onError;
    this.onState = onState;
    this.onLevel = onLevel;
    this.deviceId = deviceId;
    this.captureSessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async start(): Promise<void> {
    if (this.audioContext) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前运行环境不支持麦克风采集。请使用 Electron 桌面端运行。');
    }

    this.onState?.('正在请求麦克风权限...');

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('没有获取到可用的麦克风音轨。');
    }

    this.onState?.(`麦克风已接入：${audioTracks[0].label || '默认输入设备'}`);

    try {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    } catch {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (this.audioContext.state !== 'running') {
      throw new Error(`麦克风音频上下文未启动：${this.audioContext.state}`);
    }

    this.sampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      this.buffers.push(new Float32Array(channel));

      const rms = Math.sqrt(channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length);
      const now = Date.now();

      if (now - this.lastLevelAt > 180) {
        this.lastLevelAt = now;
        this.onLevel?.(Math.min(1, rms * 12));
      }

      if (rms > 0.01 && now - this.lastVoiceNoticeAt > 1500) {
        this.lastVoiceNoticeAt = now;
        this.onState?.('麦克风正在接收声音...');
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.flushTimer = window.setInterval(() => this.flush(), 1000);
  }

  stop(): void {
    this.flush();

    if (this.flushTimer) {
      window.clearInterval(this.flushTimer);
    }

    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.audioContext?.close().catch(() => {
      this.onError('麦克风录音关闭异常。');
    });

    this.processor = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.audioContext = undefined;
    this.flushTimer = undefined;
    this.buffers = [];
    this.sequence = 0;
    this.onLevel?.(0);
  }

  flush(): number | undefined {
    if (this.buffers.length === 0) {
      return undefined;
    }

    const samples = mergeBuffers(this.buffers);
    this.buffers = [];
    const wav = encodeWav(samples, this.sampleRate);
    const sequence = this.sequence;

    this.onChunk({
      mimeType: 'audio/wav',
      data: wav,
      sequence,
      captureSessionId: this.captureSessionId
    });
    this.sequence += 1;
    return sequence;
  }
}

function mergeBuffers(buffers: Float32Array[]): Float32Array {
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const result = new Float32Array(length);
  let offset = 0;

  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }

  return result;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
