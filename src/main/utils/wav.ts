// 主进程侧 WAV 工具：把 audiotee 输出的 16-bit signed int PCM（mono）包成 WAV，
// 并提供与 macosSpeechAsr 一致口径的静音检测，避免把静音段送去转写。

export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const blockAlign = 2; // mono, 16-bit
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export function isLikelySilentPcm16(pcm: Buffer): boolean {
  if (pcm.length < 2) {
    return true;
  }

  let sumSquares = 0;
  let peak = 0;
  let sampleCount = 0;

  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset) / 32768;
    const abs = Math.abs(sample);
    if (abs > peak) {
      peak = abs;
    }
    sumSquares += sample * sample;
    sampleCount += 1;
  }

  if (sampleCount === 0) {
    return true;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  return peak < 0.012 && rms < 0.003;
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
