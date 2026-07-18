// 12s 44.1kHz mono 16-bit WAV: kick every 500ms (120 BPM) + hats between
const fs = require('fs');
const sr = 44100, secs = 12, n = sr * secs;
const pcm = new Int16Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sr;
  const beatT = t % 0.5;
  let s = 0;
  if (beatT < 0.14) { // kick: 90→45Hz pitch-dropping decaying sine
    const f = 90 - beatT * 320;
    s += Math.sin(2 * Math.PI * f * beatT) * Math.exp(-beatT * 26) * 0.95;
  }
  const hatT = (t + 0.25) % 0.5;
  if (hatT < 0.04) s += (Math.random() * 2 - 1) * Math.exp(-hatT * 120) * 0.25;
  s += Math.sin(2 * Math.PI * 220 * t) * 0.05; // faint tone so loud never zeroes
  pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
}
const data = Buffer.from(pcm.buffer);
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.writeFileSync('__SCRATCH__/beat120.wav', Buffer.concat([h, data]));
console.log('wrote beat120.wav', 44 + data.length, 'bytes');
