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

  // 诊断计数：用于区分「audiotee 没产出任何数据」与「拿到的全是静音（多半是权限没授权）」。
  let totalBytes = 0;
  let nonSilentChunks = 0;
  let silenceWatchdog: ReturnType<typeof setTimeout> | undefined;

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

    nonSilentChunks += 1;

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
      totalBytes += data.length;
      buffers.push(Buffer.from(data));
    }
  });

  // audiotee 二进制通过 stderr 上报生命周期/日志/错误；之前没监听，导致权限等问题被吞。
  tee.on('start', () => {
    console.log('[systemAudio] audiotee stream_start');
  });

  tee.on('stop', () => {
    console.log('[systemAudio] audiotee stream_stop');
  });

  tee.on('log', (level, message) => {
    console.log(`[systemAudio][${level}] ${message.message}`, message.context ?? '');
  });

  tee.on('error', (error: Error) => {
    console.error('[systemAudio] audiotee error:', error.message);
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
      if (silenceWatchdog) {
        clearTimeout(silenceWatchdog);
        silenceWatchdog = undefined;
      }
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

  // 静音看门狗：start 后若一直没有非静音音频，多半是没拿到「系统音频录制」权限，
  // 而不是真的没人说话——audiotee 在未授权的终端里会默默录到一片静音。
  silenceWatchdog = setTimeout(() => {
    if (stopped || nonSilentChunks > 0) {
      return;
    }
    const hint =
      totalBytes === 0
        ? '已开始监听，但 5 秒内未收到任何系统音频数据。请确认 audiotee 已启动，且系统正在播放声音。'
        : '已开始监听，但收到的系统音频全是静音。多半是未授予「系统音频录制」权限：打开 系统设置 > 隐私与安全性 > 屏幕与系统音频录制，在最下方「仅系统音频录制」中加入你启动应用的终端（或本应用），然后重启应用。注意 iTerm / VSCode / Cursor 内置终端常常不弹授权、直接录到静音，可改用系统自带「终端」运行。';
    console.warn('[systemAudio] silence watchdog:', hint);
    callbacks.onStatus({ sessionId, status: 'error', message: hint });
  }, 5000);
}

export async function stopSystemAudioCapture(): Promise<void> {
  const capture = activeCapture;
  activeCapture = undefined;
  if (capture) {
    await capture.stop();
  }
}
