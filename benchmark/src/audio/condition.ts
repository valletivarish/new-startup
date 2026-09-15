/**
 * Audio conditions — turning a studio recording into what a provider will
 * actually hear on an Indian mobile call.
 *
 * The benchmark design is explicit that clean 16 kHz audio measures something
 * this product will never see. Audio from a mobile has already been through
 * AMR-NB (or EVS) on the radio leg and narrowband transcoding at the PSTN
 * handoff. So the deciding condition applies a REAL AMR-NB round trip via
 * ffmpeg — not a linear downsample dressed up as narrowband.
 *
 * Every transform records what it did, so a run can state exactly what each
 * provider was fed and a later reader can reproduce it byte for byte.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AudioCondition } from '@platform/providers';

import { encodeWav } from './wav.js';
import { resample, samplesToMulaw, mulawToSamples } from './codec.js';

const run = promisify(execFile);

/** Exactly what was done to the audio, recorded alongside every result. */
export interface ConditionMetadata {
  readonly condition: AudioCondition;
  readonly sampleRate: number;
  readonly steps: readonly string[];
  /** Codec actually applied, or null when the transform is lossless. */
  readonly codec: string | null;
  /** SHA-256 of the transformed samples — proves two providers got one input. */
  readonly checksum: string;
}

export interface ConditionedAudio {
  readonly samples: Int16Array;
  readonly metadata: ConditionMetadata;
}

export class FfmpegUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegUnavailableError';
  }
}

/**
 * Narrowband codecs we will accept, best first.
 *
 * AMR-NB is what an Indian mobile actually uses on the radio leg, so it is the
 * first choice. But most stock ffmpeg builds ship AMR-NB as DECODE ONLY —
 * encoding needs `libopencore-amrnb`, which Homebrew's default formula omits.
 *
 * Rather than silently falling back to a linear downsample and calling the
 * result "narrowband" — the exact dishonesty the design document refuses — the
 * harness picks the best REAL codec this build can encode, and records which
 * one it used in the condition metadata and in every report.
 */
export const NARROWBAND_CODECS = [
  {
    encoder: 'libopencore_amrnb',
    label: 'amr_nb@12.2k',
    args: ['-c:a', 'libopencore_amrnb', '-b:a', '12.2k'],
    fidelity: 'closest to the Indian mobile radio leg',
  },
  {
    encoder: 'amr_nb',
    label: 'amr_nb@12.2k',
    args: ['-c:a', 'amr_nb', '-b:a', '12.2k'],
    fidelity: 'closest to the Indian mobile radio leg',
  },
  {
    encoder: 'adpcm_g726',
    label: 'g726@32k',
    args: ['-c:a', 'adpcm_g726', '-b:a', '32k'],
    fidelity: 'a real ITU-T narrowband codec, but NOT the mobile radio codec',
  },
] as const;

export interface FfmpegProbe {
  readonly available: boolean;
  readonly version: string | null;
  /** Encoders this build can actually use, in preference order. */
  readonly narrowbandEncoders: readonly string[];
  readonly best: (typeof NARROWBAND_CODECS)[number] | null;
}

/** What can this ffmpeg actually ENCODE? Decoders are not enough. */
export async function probeFfmpeg(): Promise<FfmpegProbe> {
  try {
    const { stdout: encoders } = await run('ffmpeg', ['-hide_banner', '-encoders']);
    const { stdout: versionOut } = await run('ffmpeg', ['-hide_banner', '-version']);
    const version = versionOut.split('\n')[0] ?? null;

    const available = NARROWBAND_CODECS.filter((codec) =>
      new RegExp(`\\b${codec.encoder}\\b`).test(encoders),
    );
    return {
      available: true,
      version,
      narrowbandEncoders: available.map((c) => c.encoder),
      best: available[0] ?? null,
    };
  } catch {
    return { available: false, version: null, narrowbandEncoders: [], best: null };
  }
}

async function sha256(samples: Int16Array): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256')
    .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    .digest('hex');
}

/**
 * Real narrowband codec round trip: pcm16 → codec → pcm16 at 8 kHz.
 *
 * Lossy in the way the real thing is lossy, which linear downsampling is not.
 * Returns the codec label so the caller can record what was actually applied.
 */
async function narrowbandRoundTrip(
  samples: Int16Array,
  sampleRate: number,
): Promise<{ samples: Int16Array; codec: (typeof NARROWBAND_CODECS)[number] }> {
  const probe = await probeFfmpeg();
  if (!probe.available) {
    throw new FfmpegUnavailableError(
      'ffmpeg is required for a narrowband condition and was not found on PATH. ' +
        'Install it (brew install ffmpeg / apt install ffmpeg), or run with ' +
        '--condition clean_16k, which measures a best case rather than a realistic one.',
    );
  }
  if (!probe.best) {
    throw new FfmpegUnavailableError(
      'This ffmpeg build can DECODE narrowband codecs but cannot ENCODE any of them ' +
        `(looked for ${NARROWBAND_CODECS.map((c) => c.encoder).join(', ')}). ` +
        'The narrowband condition would silently degrade to a plain downsample, which ' +
        'is exactly the simulation the benchmark design refuses to pass off as ' +
        'narrowband. Install an ffmpeg with libopencore-amrnb, or run --condition ' +
        'clean_16k and label the results accordingly.',
    );
  }

  const codec = probe.best;
  const extension = codec.label.startsWith('amr') ? 'amr' : 'wav';
  const dir = await mkdtemp(join(tmpdir(), 'bench-nb-'));
  try {
    const wavPath = join(dir, 'in.wav');
    const midPath = join(dir, `mid.${extension}`);
    const rawPath = join(dir, 'out.raw');

    await writeFile(wavPath, encodeWav(samples, sampleRate));
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', wavPath, '-ar', '8000', '-ac', '1',
      ...codec.args, midPath,
    ]);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', midPath, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '8000', '-ac', '1', rawPath,
    ]);

    const raw = await readFile(rawPath);
    const out = new Int16Array(Math.floor(raw.byteLength / 2));
    for (let i = 0; i < out.length; i += 1) out[i] = raw.readInt16LE(i * 2);
    return { samples: out, codec };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Apply a condition to source audio.
 *
 * Source must be mono 16-bit PCM. The returned metadata is what gets stored
 * with the run so the exact input is reproducible.
 */
export async function applyCondition(
  samples: Int16Array,
  sourceSampleRate: number,
  condition: AudioCondition,
): Promise<ConditionedAudio> {
  const steps: string[] = [`source ${sourceSampleRate} Hz mono pcm16`];

  switch (condition) {
    case 'clean_16k': {
      const out =
        sourceSampleRate === 16000 ? samples : resample(samples, sourceSampleRate, 16000);
      if (sourceSampleRate !== 16000) steps.push(`resample ${sourceSampleRate} -> 16000 (linear)`);
      return {
        samples: out,
        metadata: {
          condition, sampleRate: 16000, steps, codec: null,
          checksum: await sha256(out),
        },
      };
    }

    case 'narrowband_8k': {
      // Kept for comparison against the AMR path — NOT the deciding condition.
      // It reproduces bandwidth and quantisation but none of the codec loss.
      const down =
        sourceSampleRate === 8000 ? samples : resample(samples, sourceSampleRate, 8000);
      if (sourceSampleRate !== 8000) steps.push(`resample ${sourceSampleRate} -> 8000 (linear, averaged)`);
      const companded = mulawToSamples(samplesToMulaw(down));
      steps.push('G.711 mu-law companding round trip');
      return {
        samples: companded,
        metadata: {
          condition, sampleRate: 8000, steps, codec: 'g711-ulaw',
          checksum: await sha256(companded),
        },
      };
    }

    case 'narrowband_8k_noisy':
    case 'live_pstn':
    default: {
      // Both of these arrive already degraded — noisy from a real noisy
      // recording, live_pstn from an actual call. Applying AMR again would be
      // double compression, so they only get companded to the carrier format.
      const down =
        sourceSampleRate === 8000 ? samples : resample(samples, sourceSampleRate, 8000);
      if (sourceSampleRate !== 8000) steps.push(`resample ${sourceSampleRate} -> 8000 (linear, averaged)`);
      const companded = mulawToSamples(samplesToMulaw(down));
      steps.push('G.711 mu-law companding round trip');
      return {
        samples: companded,
        metadata: {
          condition, sampleRate: 8000, steps, codec: 'g711-ulaw',
          checksum: await sha256(companded),
        },
      };
    }
  }
}

/**
 * The deciding condition: a REAL narrowband codec round trip.
 *
 * Separate from `applyCondition` because it needs ffmpeg and can therefore
 * fail. A benchmark that silently fell back to a cheaper transform would be
 * reporting a condition it did not run — so this throws instead, and the codec
 * actually used is recorded in the metadata and printed in every report.
 */
export async function applyAmrNarrowband(
  samples: Int16Array,
  sourceSampleRate: number,
): Promise<ConditionedAudio> {
  const { samples: decoded, codec } = await narrowbandRoundTrip(samples, sourceSampleRate);
  const companded = mulawToSamples(samplesToMulaw(decoded));
  return {
    samples: companded,
    metadata: {
      condition: 'narrowband_8k',
      sampleRate: 8000,
      steps: [
        `source ${sourceSampleRate} Hz mono pcm16`,
        `${codec.encoder} encode at 8000 Hz (${codec.fidelity})`,
        `${codec.encoder} decode to pcm16 8000 Hz`,
        'G.711 mu-law companding round trip',
      ],
      codec: `${codec.label}+g711-ulaw`,
      checksum: await sha256(companded),
    },
  };
}
