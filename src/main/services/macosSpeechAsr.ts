import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AudioChunkPayload } from '../../shared/types';

const execFileAsync = promisify(execFile);
const helperName = 'macos-speech-recognizer';

interface MacosSpeechResult {
  text?: string;
}

export async function transcribeWithMacosSpeech(payload: AudioChunkPayload): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('macOS 系统语音识别仅支持 darwin 平台。');
  }

  const helperPath = resolveHelperPath();
  if (!fs.existsSync(helperPath)) {
    throw new Error(`未找到 macOS Speech helper：${helperPath}。请先运行 npm run build:macos-speech。`);
  }

  const audioPath = path.join(os.tmpdir(), `interview-macos-speech-${Date.now()}-${payload.sequence ?? 0}.wav`);
  const audio = Buffer.from(payload.data);
  if (isLikelySilentWav(audio)) {
    return '';
  }

  await fs.promises.writeFile(audioPath, audio);

  try {
    const timeoutSeconds = getTimeoutSeconds();
    const args = [
      audioPath,
      '--locale',
      process.env.AI_INTERVIEW_MACOS_SPEECH_LOCALE?.trim() || 'zh-CN',
      '--timeout',
      String(timeoutSeconds)
    ];

    if (process.env.AI_INTERVIEW_MACOS_SPEECH_ON_DEVICE === '1') {
      args.push('--on-device');
    }

    const { stdout } = await execFileAsync(helperPath, args, {
      timeout: (timeoutSeconds + 5) * 1000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const parsed = parseJson(stdout);
    return parsed.text?.trim() ?? '';
  } catch (error) {
    throw new Error(`macOS Speech 识别失败：${formatExecError(error)}`);
  } finally {
    await fs.promises.rm(audioPath, { force: true });
  }
}

function getTimeoutSeconds(): number {
  const parsed = Number(process.env.AI_INTERVIEW_MACOS_SPEECH_TIMEOUT?.trim() || '8');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8;
  }

  return Math.max(2, Math.min(30, parsed));
}

function isLikelySilentWav(audio: Buffer): boolean {
  const dataStart = findWavDataStart(audio);
  if (dataStart === -1 || audio.length <= dataStart + 1) {
    return false;
  }

  let sumSquares = 0;
  let peak = 0;
  let sampleCount = 0;

  for (let offset = dataStart; offset + 1 < audio.length; offset += 2) {
    const sample = audio.readInt16LE(offset) / 32768;
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
    sampleCount += 1;
  }

  if (sampleCount === 0) {
    return true;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  return peak < 0.012 && rms < 0.003;
}

function findWavDataStart(audio: Buffer): number {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    return -1;
  }

  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString('ascii', offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return offset + 8;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return -1;
}

function resolveHelperPath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'helpers', helperName),
    path.resolve(__dirname, '../../helpers', helperName),
    path.join(process.cwd(), 'dist', 'helpers', helperName)
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates[1];
}

function parseJson(rawText: string): MacosSpeechResult {
  try {
    return JSON.parse(rawText) as MacosSpeechResult;
  } catch {
    throw new Error(`helper 返回了非 JSON 内容：${rawText.slice(0, 240)}`);
  }
}

function formatExecError(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & {
      stderr?: string;
      stdout?: string;
      code?: string | number;
    };
    const stderr = details.stderr?.trim();
    const stdout = details.stdout?.trim();
    return [details.message, stderr, stdout, details.code ? `code=${details.code}` : ''].filter(Boolean).join('，');
  }

  return String(error);
}
