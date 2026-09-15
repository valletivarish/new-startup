/**
 * Generates placeholder audio for the TEMPLATE corpus.
 *
 * These are tones, not speech. They exist so `validate` and `plan` can be
 * exercised end to end before any recording session happens. A benchmark run
 * against them measures nothing about a provider's accuracy — which is why the
 * template manifest says so, and why any such run reports INCOMPLETE.
 */
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'corpus', 'example', 'audio');

function tone(sampleRate, ms, hz) {
  const count = Math.round((sampleRate * ms) / 1000);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    // Amplitude ~0.2 FS keeps it inside the loudness window the validator wants.
    samples[i] = Math.round(6500 * Math.sin((2 * Math.PI * hz * i) / sampleRate));
  }
  return samples;
}

function wav(samples, sampleRate) {
  const data = samples.length * 2;
  const buffer = new ArrayBuffer(44 + data);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46464952, true);
  view.setUint32(4, 36 + data, true);
  view.setUint32(8, 0x45564157, true);
  view.setUint32(12, 0x20746d66, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true);
  view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buffer);
}

const files = [
  ['ex-01-notice.wav', 2400, 300],
  ['ex-02-experience.wav', 3200, 340],
  ['ex-03-hinglish-ctc.wav', 2800, 380],
  ['ex-04-relocation.wav', 2000, 420],
];

for (const [name, ms, hz] of files) {
  await writeFile(join(outDir, name), wav(tone(16000, ms, hz), 16000));
  console.log('wrote', name);
}
