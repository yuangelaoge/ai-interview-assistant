// 临时验证脚本：确认 macOS Core Audio Taps (audiotee) 能否拿到非静音系统音频 PCM。
// 用法：
//   1. npm i audiotee
//   2. node scripts/test-audiotee.mjs
//   3. 播放任意系统声音（音乐/视频）
//   4. 观察输出的 RMS / peak 是否非零；非零即说明系统音频采集成功。
// 验证完可删除本文件，并按需 npm rm audiotee。

import { AudioTee } from 'audiotee';

const SAMPLE_RATE = 16000;

const audiotee = new AudioTee({ sampleRate: SAMPLE_RATE, chunkDurationMs: 200 });

let chunkCount = 0;
let maxPeakOverall = 0;

audiotee.on('start', () => {
  console.log(`[start] Core Audio Tap 已启动，采样率 ${SAMPLE_RATE}Hz。现在播放任意系统声音...`);
});

audiotee.on('log', (msg) => {
  console.log('[log]', msg);
});

audiotee.on('error', (err) => {
  console.error('[error]', err);
});

audiotee.on('data', (chunk) => {
  const buf = chunk?.data ?? chunk;
  if (!buf || buf.length < 2) {
    return;
  }

  // sampleRate 指定后为 16-bit signed int PCM（mono）。
  let sumSquares = 0;
  let peak = 0;
  let sampleCount = 0;
  for (let offset = 0; offset + 1 < buf.length; offset += 2) {
    const sample = buf.readInt16LE(offset) / 32768;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sumSquares += sample * sample;
    sampleCount += 1;
  }

  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  if (peak > maxPeakOverall) maxPeakOverall = peak;
  chunkCount += 1;

  // 每 5 个 chunk（约 1 秒）打印一次，避免刷屏。
  if (chunkCount % 5 === 0) {
    const bar = '#'.repeat(Math.min(40, Math.round(rms * 200)));
    console.log(
      `[data] chunk#${chunkCount} bytes=${buf.length} rms=${rms.toFixed(4)} peak=${peak.toFixed(4)} ${bar}`
    );
  }
});

audiotee.on('stop', () => {
  console.log(`[stop] 采集结束。共 ${chunkCount} 个 chunk，全程最大 peak=${maxPeakOverall.toFixed(4)}。`);
  console.log(maxPeakOverall > 0.01 ? '✅ 成功：拿到了非静音系统音频。' : '❌ 失败：全程静音（peak 接近 0）。');
});

console.log('启动中... 按 Ctrl+C 停止。');
await audiotee.start();

process.on('SIGINT', async () => {
  console.log('\n收到中断，正在停止...');
  await audiotee.stop();
  process.exit(0);
});
