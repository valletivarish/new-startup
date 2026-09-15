/**
 * WAV reading and writing — RIFF/WAVE, PCM only.
 *
 * Written rather than taken from a library because the benchmark must know
 * EXACTLY what it fed each provider. A library that silently resamples, or
 * quietly accepts a 24-bit float file, would make two providers receive
 * different audio without anyone noticing — which is the single most damaging
 * way a comparison can be invalid.
 *
 * So: parse strictly, reject anything unexpected, and report the real header.
 */

export interface WavData {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly samples: Int16Array;
  /** Duration in milliseconds, computed from the data actually present. */
  readonly durationMs: number;
}

export class WavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavFormatError';
  }
}

const RIFF = 0x46464952; // "RIFF" little-endian
const WAVE = 0x45564157; // "WAVE"
const FMT = 0x20746d66; // "fmt "
const DATA = 0x61746164; // "data"
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

export function decodeWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) {
    throw new WavFormatError(`File is ${bytes.byteLength} bytes — too short to be a WAV.`);
  }
  if (view.getUint32(0, true) !== RIFF) {
    throw new WavFormatError('Not a RIFF file (missing "RIFF" magic).');
  }
  if (view.getUint32(8, true) !== WAVE) {
    throw new WavFormatError('RIFF file is not WAVE.');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let formatTag = 0;
  let dataOffset = -1;
  let dataLength = 0;

  // Walk chunks rather than assuming a canonical 44-byte header: real
  // recorders emit LIST/fact/JUNK chunks, and assuming they do not is how a
  // parser reads metadata as audio.
  while (offset + 8 <= bytes.byteLength) {
    const id = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === FMT) {
      if (size < 16) throw new WavFormatError('fmt chunk is too small.');
      formatTag = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === DATA) {
      dataOffset = body;
      dataLength = Math.min(size, bytes.byteLength - body);
    }

    // Chunks are word-aligned; an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new WavFormatError('No data chunk found.');
  if (formatTag !== WAVE_FORMAT_PCM && formatTag !== WAVE_FORMAT_EXTENSIBLE) {
    throw new WavFormatError(
      `Unsupported WAV format tag ${formatTag}. Only uncompressed PCM is accepted — ` +
        'convert with: ffmpeg -i in.wav -c:a pcm_s16le -ac 1 out.wav',
    );
  }
  if (bitsPerSample !== 16) {
    throw new WavFormatError(
      `WAV is ${bitsPerSample}-bit. Only 16-bit PCM is accepted, because anything ` +
        'else would have to be converted here and providers would silently receive ' +
        'different audio.',
    );
  }

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true);
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    samples,
    durationMs: (sampleCount / channels / sampleRate) * 1000,
  };
}

/** Write mono 16-bit PCM as a canonical 44-byte-header WAV. */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  view.setUint32(0, RIFF, true);
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, WAVE, true);
  view.setUint32(12, FMT, true);
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, DATA, true);
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, samples[i] as number, true);
  }
  return new Uint8Array(buffer);
}

/** Average interleaved channels down to mono. */
export function toMono(samples: Int16Array, channels: number): Int16Array {
  if (channels === 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += samples[i * channels + c] as number;
    mono[i] = Math.round(sum / channels);
  }
  return mono;
}

/** Peak amplitude as a fraction of full scale. Used to catch silent recordings. */
export function peakLevel(samples: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i] as number);
    if (magnitude > peak) peak = magnitude;
  }
  return peak / 32768;
}

/** RMS level in dBFS. Approximates loudness for a normalisation check. */
export function rmsDbfs(samples: Int16Array): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = (samples[i] as number) / 32768;
    sum += value * value;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

/** Leading silence in milliseconds, at a given amplitude threshold. */
export function leadingSilenceMs(
  samples: Int16Array,
  sampleRate: number,
  threshold = 0.01,
): number {
  const limit = threshold * 32768;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i] as number) > limit) return (i / sampleRate) * 1000;
  }
  return (samples.length / sampleRate) * 1000;
}
