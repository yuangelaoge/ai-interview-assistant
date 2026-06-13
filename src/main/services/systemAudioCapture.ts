// 主进程系统音频采集服务：通过 audiotee（macOS Core Audio Taps）拿到系统扬声器
// 音频（面试官声音），按约 1 秒攒一段送现有 transcribeAudio 转写，标记 speaker='interviewer'，
// 作为问题入口驱动渲染层收题状态机。
//
// 关键坑：audiotee 是 ESM-only，主进程编译为 CommonJS。直接 `import { AudioTee } from 'audiotee'`
// 会被 tsc 编成 require() 触发 ERR_REQUIRE_ESM。这里用 `import type` 拿类型（编译期擦除），
// 运行时用 Function-eval 包裹的动态 import 绕过 tsc 的 import()->require 降级。

import type { AudioTee as AudioTeeClass } from 'audiotee';
import type { SystemAudioStatus, SystemAudioTranscript } from '../../shared/types';
import { transcribeAudio } from './answerService';
import { bufferToArrayBuffer, isLikelySilentPcm16, pcm16ToWav } from '../utils/wav';

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 200;
const FLUSH_INTERVAL_MS = 1000;

interface CaptureCallbacks {
  onTranscript: (transcript: SystemAudioTranscript) => void;
  onStatus: (status: SystemAudioStatus) => void;
}

interface ActiveCapture {
  sessionId: string;
  stop: () => Promise<void>;
}

type AudioTeeModule = { AudioTee: typeof AudioTeeClass };

let activeCapture: ActiveCapture | undefined;

async function loadAudioTee(): Promise<AudioTeeModule> {
  // Function-eval indirection：tsc 看不到这是 import()，不会降级成 require()。
  const dynamicImport = Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<AudioTeeModule>;
  return dynamicImport('audiotee');
}

export async function startSystemAudioCapture(
  sessionId: string,
  callbacks: CaptureCallbacks
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('系统音频采集仅支持 macOS（Core Audio Taps）。');
  }

  if (activeCapture) {
    await stopSystemAudioCapture();
  }

  const { AudioTee } = await loadAudioTee();
  const tee = new AudioTee({ sampleRate: SAMPLE_RATE, chunkDurationMs: CHUNK_DURATION_MS });

  let buffers: Buffer[] = [];
  let sequence = 0;
  let nextEmitSequence = 0;
  let stopped = false;
  const pending = new Map<number, string>();

  // 转写是并发的，可能乱序返回；按 sequence 顺序对外 emit，保证拼接顺序。
  const emitOrdered = (): void => {
    while (pending.has(nextEmitSequence)) {
      const text = pending.get(nextEmitSequence) ?? '';
      pending.delete(nextEmitSequence);
      const currentSequence = nextEmitSequence;
      nextEmitSequence += 1;

      if (text) {
        callbacks.onTranscript({
          sessionId,
          sequence: currentSequence,
          text,
          timestamp: Date.now(),
          confidence: 0.88
        });
      }
    }
  };

  const flush = async (): Promise<void> => {
    if (buffers.length === 0) {
      return;
    }

    const pcm = Buffer.concat(buffers);
    buffers = [];
    const seq = sequence;
    sequence += 1;

    if (isLikelySilentPcm16(pcm)) {
      pending.set(seq, '');
      emitOrdered();
      return;
    }

    try {
      const result = await transcribeAudio({
        mimeType: 'audio/wav',
        data: bufferToArrayBuffer(pcm16ToWav(pcm, SAMPLE_RATE)),
        sequence: seq,
        captureSessionId: sessionId,
        speaker: 'interviewer'
      });
      pending.set(seq, (result.text ?? '').trim());
    } catch (error) {
      pending.set(seq, '');
      callbacks.onStatus({
        sessionId,
        status: 'error',
        message: `系统音频转写失败，已跳过本段：${error instanceof Error ? error.message : String(error)}`
      });
    }

    emitOrdered();
  };

  const interval = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  tee.on('data', (chunk) => {
    const data = chunk?.data;
    if (data && data.length > 0) {
      buffers.push(Buffer.from(data));
    }
  });

  tee.on('error', (error: Error) => {
    callbacks.onStatus({
      sessionId,
      status: 'error',
      message: `系统音频采集出错：${error.message}`
    });
  });

  activeCapture = {
    sessionId,
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(interval);
      await flush();
      try {
        await tee.stop();
      } catch {
        // 停止异常不阻断流程
      }
    }
  };

  await tee.start();
  callbacks.onStatus({ sessionId, status: 'listening' });
}

export async function stopSystemAudioCapture(): Promise<void> {
  const capture = activeCapture;
  activeCapture = undefined;
  if (capture) {
    await capture.stop();
  }
}
