/**
 * G.711 and PCM conversion — the implementation behind `AudioCodec`.
 *
 * This is where carrier wire formats stop. Everything here is pure, dependency
 * free, and exactly testable, which matters because an audio bug does not throw
 * — it just makes the agent sound wrong, and you find out from a customer.
 *
 * G.711 mu-law is implemented to the standard (ITU-T G.711 / the classic Sun
 * reference), not approximated. Round-tripping is lossy by design — mu-law is
 * an 8-bit companded format — so the tests assert bounded quantisation error
 * rather than exact equality.
 *
 * RESAMPLING IS DELIBERATELY SIMPLE, and the limitation is stated rather than
 * hidden: linear interpolation upward, averaging downward. That is honest for a
 * measurement harness and NOT good enough for production audio quality, where a
 * polyphase resampler belongs. It is called out again in the benchmark design
 * document so the choice is visible when results are read.
 */

import type { AudioFormat, NormalizedAudioFrame } from '@platform/providers';

const BIAS = 0x84;
const CLIP = 32635;

/** Exponent lookup for mu-law encoding, computed rather than transcribed. */
function encodeExponent(index: number): number {
  // 0,1 -> 0; 2,3 -> 1; 4..7 -> 2; 8..15 -> 3; ... 128..255 -> 7
  return index < 2 ? 0 : 31 - Math.clz32(index);
}

/** Decode table: the linear magnitude at the base of each mu-law exponent. */
const DECODE_BASE = [0, 132, 396, 924, 1980, 4092, 8316, 16764] as const;

export function linearToMulaw(sample: number): number {
  let value = Math.max(-32768, Math.min(32767, Math.trunc(sample)));
  const sign = (value >> 8) & 0x80;
  if (sign !== 0) value = -value;
  if (value > CLIP) value = CLIP;
  value += BIAS;
  const exponent = encodeExponent((value >> 7) & 0xff);
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function mulawToLinear(byte: number): number {
  const inverted = ~byte & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  const magnitude =
    (DECODE_BASE[exponent] as number) + (mantissa << (exponent + 3));
  return sign !== 0 ? -magnitude : magnitude;
}

/** Little-endian 16-bit PCM bytes to samples. */
export function pcm16ToSamples(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i += 1) {
    const lo = bytes[i * 2] as number;
    const hi = bytes[i * 2 + 1] as number;
    samples[i] = (((hi << 8) | lo) << 16) >> 16; // sign-extend
  }
  return samples;
}

export function samplesToPcm16(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] as number;
    bytes[i * 2] = value & 0xff;
    bytes[i * 2 + 1] = (value >> 8) & 0xff;
  }
  return bytes;
}

export function mulawToSamples(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    samples[i] = mulawToLinear(bytes[i] as number);
  }
  return samples;
}

export function samplesToMulaw(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    bytes[i] = linearToMulaw(samples[i] as number);
  }
  return bytes;
}

/**
 * Resample between 8 kHz and 16 kHz.
 *
 * Only the 2:1 cases occur in telephony, so only those are implemented — a
 * general resampler would be untested code pretending to be capability.
 */
export function resample(
  samples: Int16Array,
  from: number,
  to: number,
): Int16Array {
  if (from === to) return samples;

  if (to === from * 2) {
    // Upsample: linear interpolation between neighbours.
    const out = new Int16Array(samples.length * 2);
    for (let i = 0; i < samples.length; i += 1) {
      const current = samples[i] as number;
      const next = (samples[i + 1] ?? current) as number;
      out[i * 2] = current;
      out[i * 2 + 1] = (current + next) >> 1;
    }
    return out;
  }

  if (from === to * 2) {
    // Downsample: average adjacent pairs. A crude low-pass — enough to avoid
    // the worst aliasing, not a substitute for a real anti-alias filter.
    const out = new Int16Array(Math.floor(samples.length / 2));
    for (let i = 0; i < out.length; i += 1) {
      const a = samples[i * 2] as number;
      const b = (samples[i * 2 + 1] ?? a) as number;
      out[i] = (a + b) >> 1;
    }
    return out;
  }

  throw new Error(
    `Unsupported resample ${from} -> ${to}. Telephony uses 8k and 16k only.`,
  );
}

/** Convert a normalized frame into a target format. A no-op when already correct. */
export function convertFrame(
  frame: NormalizedAudioFrame,
  to: AudioFormat,
): NormalizedAudioFrame {
  if (frame.encoding === to.encoding && frame.sampleRate === to.sampleRate) {
    return frame;
  }

  const samples =
    frame.encoding === 'mulaw'
      ? mulawToSamples(frame.payload)
      : pcm16ToSamples(frame.payload);

  const resampled = resample(samples, frame.sampleRate, to.sampleRate);

  const payload =
    to.encoding === 'mulaw' ? samplesToMulaw(resampled) : samplesToPcm16(resampled);

  return {
    encoding: to.encoding,
    sampleRate: to.sampleRate,
    channels: 1,
    timestampMs: frame.timestampMs,
    sequence: frame.sequence,
    payload,
  };
}

/** The `AudioCodec` implementation. Stateless, so one instance serves everything. */
export function createAudioCodec() {
  return {
    name: 'g711-linear-codec',
    convert: convertFrame,
  };
}

/** Duration of a frame in milliseconds, from its own declared format. */
export function frameDurationMs(frame: NormalizedAudioFrame): number {
  const bytesPerSample = frame.encoding === 'mulaw' ? 1 : 2;
  const sampleCount = frame.payload.length / bytesPerSample;
  return (sampleCount / frame.sampleRate) * 1000;
}
