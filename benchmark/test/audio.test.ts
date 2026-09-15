/**
 * Audio layer tests.
 *
 * Audio bugs do not throw — they make the agent sound wrong, or make one
 * provider receive different input from another, and you find out from a
 * customer. So the codec is tested against the standard, and the WAV parser is
 * tested against the malformed files a real recording session produces.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  convertFrame, frameDurationMs, linearToMulaw, mulawToLinear,
  pcm16ToSamples, resample, samplesToMulaw, samplesToPcm16,
} from '../src/audio/codec.js';
import {
  decodeWav, encodeWav, leadingSilenceMs, peakLevel, rmsDbfs, toMono, WavFormatError,
} from '../src/audio/wav.js';
import { applyAmrNarrowband, applyCondition, probeFfmpeg } from '../src/audio/condition.js';

/** A 1 kHz tone — deterministic, and loud enough to survive companding. */
function tone(sampleRate: number, ms: number, amplitude = 8000): Int16Array {
  const count = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 1000 * i) / sampleRate));
  }
  return out;
}

describe('G.711 mu-law follows the standard', () => {
  it('round-trips within companding error, preserving sign', () => {
    for (const sample of [0, 100, 1000, 5000, 16000, 32000, -100, -5000, -32000]) {
      const restored = mulawToLinear(linearToMulaw(sample));
      const tolerance = Math.max(8, Math.abs(sample) * 0.09);
      expect(Math.abs(restored - sample), `sample ${sample}`).toBeLessThanOrEqual(tolerance);
      expect(Math.sign(restored) === Math.sign(sample) || sample === 0).toBe(true);
    }
  });

  it('encodes digital silence to the standard idle byte', () => {
    // 0x00 here would send a loud tone down the line instead of nothing.
    expect(linearToMulaw(0)).toBe(0xff);
  });

  it('is one byte per sample', () => {
    expect(samplesToMulaw(new Int16Array([0, 1000, -1000, 32000]))).toHaveLength(4);
  });

  it('round-trips pcm16 bytes exactly, including the extremes', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 1234, -4321]);
    expect([...pcm16ToSamples(samplesToPcm16(samples))]).toEqual([...samples]);
  });
});

describe('resampling', () => {
  it('doubles 8k → 16k and halves back', () => {
    const up = resample(new Int16Array([0, 100, 200, 300]), 8000, 16000);
    expect(up).toHaveLength(8);
    expect(resample(up, 16000, 8000)).toHaveLength(4);
  });

  it('refuses a rate pair telephony never uses rather than guessing', () => {
    expect(() => resample(new Int16Array(4), 44100, 8000)).toThrow(/Unsupported resample/);
  });
});

describe('frame conversion keeps carrier formats out of the platform', () => {
  const frame = {
    encoding: 'mulaw' as const, sampleRate: 8000 as const, channels: 1 as const,
    timestampMs: 40, sequence: 2,
    payload: samplesToMulaw(new Int16Array([0, 500, -500, 2000, 8000, -8000, 100, 0])),
  };

  it('converts carrier mu-law 8k to the pcm16 16k an STT wants', () => {
    const out = convertFrame(frame, { encoding: 'pcm16', sampleRate: 16000, channels: 1 });
    expect(out.encoding).toBe('pcm16');
    expect(out.payload).toHaveLength(32);
    expect(out.timestampMs).toBe(40);
    expect(out.sequence).toBe(2);
  });

  it('is identity when the format already matches', () => {
    expect(convertFrame(frame, { encoding: 'mulaw', sampleRate: 8000, channels: 1 })).toBe(frame);
  });

  it('computes frame duration from the frame itself', () => {
    // 160 bytes of mu-law at 8 kHz is the 20 ms frame carriers mandate.
    expect(frameDurationMs({ ...frame, payload: new Uint8Array(160) })).toBeCloseTo(20, 5);
  });
});

describe('WAV parsing is strict, because silent acceptance is the danger', () => {
  it('round-trips through encode/decode', () => {
    const samples = tone(16000, 100);
    const wav = decodeWav(encodeWav(samples, 16000));
    expect(wav.sampleRate).toBe(16000);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.samples.length).toBe(samples.length);
    expect(wav.durationMs).toBeCloseTo(100, 1);
  });

  it('rejects a non-RIFF file', () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow(WavFormatError);
  });

  it('rejects a truncated file rather than reading garbage', () => {
    expect(() => decodeWav(new Uint8Array(10))).toThrow(/too short/);
  });

  it('rejects non-16-bit audio with an actionable message', () => {
    const wav = encodeWav(tone(16000, 20), 16000);
    const view = new DataView(wav.buffer);
    view.setUint16(34, 24, true); // claim 24-bit
    expect(() => decodeWav(wav)).toThrow(/16-bit/);
  });

  it('rejects a compressed WAV instead of treating the payload as PCM', () => {
    const wav = encodeWav(tone(16000, 20), 16000);
    new DataView(wav.buffer).setUint16(20, 85, true); // MP3 format tag
    expect(() => decodeWav(wav)).toThrow(/Only uncompressed PCM/);
  });

  it('walks chunks, so a LIST chunk is not read as audio', () => {
    // Real recorders emit metadata chunks; assuming a 44-byte header is how a
    // parser reads a copyright string as samples.
    const samples = tone(16000, 50);
    const audio = encodeWav(samples, 16000);
    const listChunk = new Uint8Array(16);
    new DataView(listChunk.buffer).setUint32(0, 0x5453494c, true); // "LIST"
    new DataView(listChunk.buffer).setUint32(4, 8, true);

    const withList = new Uint8Array(audio.length + listChunk.length);
    withList.set(audio.subarray(0, 36), 0);
    withList.set(listChunk, 36);
    withList.set(audio.subarray(36), 36 + listChunk.length);
    new DataView(withList.buffer).setUint32(4, withList.length - 8, true);

    const decoded = decodeWav(withList);
    expect(decoded.samples.length).toBe(samples.length);
  });
});

describe('audio quality checks catch a bad recording session', () => {
  it('detects a silent recording', () => {
    expect(peakLevel(new Int16Array(1000))).toBe(0);
    expect(peakLevel(tone(16000, 50))).toBeGreaterThan(0.2);
  });

  it('measures loudness and leading silence', () => {
    expect(rmsDbfs(tone(16000, 100))).toBeLessThan(0);
    const padded = new Int16Array(16000);
    padded.set(tone(16000, 500), 8000); // 500 ms of silence first
    expect(leadingSilenceMs(padded, 16000)).toBeCloseTo(500, 0);
  });

  it('averages stereo to mono', () => {
    const stereo = new Int16Array([100, 200, 300, 400]);
    expect([...toMono(stereo, 2)]).toEqual([150, 350]);
  });
});

describe('audio conditions record exactly what was done', () => {
  it('produces a checksum so two providers can be proven to get one input', async () => {
    const a = await applyCondition(tone(16000, 200), 16000, 'clean_16k');
    const b = await applyCondition(tone(16000, 200), 16000, 'clean_16k');
    expect(a.metadata.checksum).toBe(b.metadata.checksum);
    expect(a.metadata.checksum).toHaveLength(64);
  });

  it('records every transform step', async () => {
    const result = await applyCondition(tone(16000, 200), 16000, 'narrowband_8k');
    expect(result.metadata.sampleRate).toBe(8000);
    expect(result.metadata.codec).toBe('g711-ulaw');
    expect(result.metadata.steps.join(' ')).toMatch(/resample 16000 -> 8000/);
    expect(result.metadata.steps.join(' ')).toMatch(/mu-law/);
  });

  it('performs a REAL codec round trip, not a simulated one', async () => {
    const probe = await probeFfmpeg();
    if (!probe.available || !probe.best) {
      // Skipping is honest; silently substituting a downsample would not be.
      console.warn('no narrowband ENCODER available — skipping the real codec test');
      return;
    }
    const source = tone(16000, 500);
    const result = await applyAmrNarrowband(source, 16000);

    // Whichever real codec this build can encode — recorded, never assumed.
    expect(result.metadata.codec).toContain('+g711-ulaw');
    expect(result.metadata.codec).toContain(probe.best.label);
    expect(result.metadata.sampleRate).toBe(8000);
    expect(result.metadata.steps.some((s) => s.includes(probe.best!.encoder))).toBe(true);

    // Roughly half the samples, since 16k → 8k.
    expect(result.samples.length).toBeGreaterThan(source.length * 0.4);
    expect(result.samples.length).toBeLessThan(source.length * 0.6);

    // AMR is LOSSY: the output must differ from a plain downsample, otherwise
    // the codec silently did nothing and the condition is a lie.
    const plain = await applyCondition(source, 16000, 'narrowband_8k');
    expect(result.metadata.checksum).not.toBe(plain.metadata.checksum);

    // ...but it must still be audio, not noise or silence.
    expect(peakLevel(result.samples)).toBeGreaterThan(0.05);
  }, 30_000);

  it('fails loudly when no narrowband ENCODER exists rather than degrading silently', async () => {
    const probe = await probeFfmpeg();
    if (probe.best) return; // cannot exercise the failure path on this machine
    await expect(applyAmrNarrowband(tone(16000, 100), 16000)).rejects.toThrow(
      /cannot ENCODE|not found on PATH/i,
    );
  });

  it('reports decode-only builds as having no usable encoder', async () => {
    // The original probe checked `-codecs`, which lists DECODERS too — so a
    // build that can only decode AMR looked capable and the condition would
    // have silently become a downsample.
    const probe = await probeFfmpeg();
    if (!probe.available) return;
    for (const encoder of probe.narrowbandEncoders) {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { stdout } = await promisify(execFile)('ffmpeg', ['-hide_banner', '-encoders']);
      expect(stdout).toContain(encoder);
    }
  });
});

describe('fixture generation', () => {
  it('writes a readable WAV to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bench-wav-'));
    const path = join(dir, 'x.wav');
    await writeFile(path, encodeWav(tone(16000, 120), 16000));
    const { readFile } = await import('node:fs/promises');
    expect(decodeWav(await readFile(path)).durationMs).toBeCloseTo(120, 0);
  });
});
