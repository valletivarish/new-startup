/**
 * The blind listening gate.
 *
 * Latency alone must not choose the TTS. For an outbound screening call the
 * voice IS the product surface, and it is the least reversible half of the
 * decision: STT can be swapped behind the normalized audio boundary with
 * candidates none the wiser, but the voice is what every candidate hears.
 *
 * A latency-only rule would select the cheapest provider that emits a first
 * byte inside 300 ms, with no check on what that byte is the start of — a TTS
 * that reads "15 lakhs" as "fifteen lakh zero zero zero zero zero" passes.
 *
 * THE ANONYMITY IS THE POINT. Sample filenames are opaque, presentation order
 * is shuffled with a recorded seed, and the mapping is written to a separate
 * file the listener never opens. Without that, a listener who knows which
 * sample is which is scoring a brand.
 *
 * SO IS THE COMMON FORMAT. Providers return different encodings and rates, so
 * every sample is decoded to linear PCM and levelled before anyone hears it.
 * Resampling is a LAST RESORT and is reported, because our linear resampler
 * adds artefacts a natively-8 kHz provider never suffers — levelling a 16 kHz
 * provider down to meet its peers does not remove a fidelity bias, it reverses
 * it. The real fix is to ask every provider for the same documented format,
 * which is what the adapters now do.
 *
 * SO IS THE COMMON SAMPLE RATE. Providers do not document the same output
 * format matrix, so the adapters legitimately request different rates — one
 * documents 8 kHz for its companded encodings only, another documents 16 kHz
 * for linear PCM. Presenting those side by side would let a listener prefer
 * whichever provider we happened to ask for higher-fidelity audio, which is a
 * property of our request rather than of the voice. Every sample is therefore
 * resampled to the LOWEST rate present before anyone hears it — and that is
 * also the honest rate, because a candidate on a PSTN call hears 8 kHz however
 * good the synthesis was.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CorpusLanguageTag } from '../adapters/types.js';
import { encodeWav } from '../audio/wav.js';
import { mulawToSamples, pcm16ToSamples, resample } from '../audio/codec.js';

/** Lines chosen to stress exactly what Indian screening calls contain. */
export interface QualityLine {
  readonly lineId: string;
  readonly text: string;
  readonly language: CorpusLanguageTag;
  /** What this line is testing, shown to the listener as context. */
  readonly probes: readonly (
    | 'indian_name'
    | 'lakh_crore'
    | 'date'
    | 'english_technical_term'
    | 'code_switch'
    | 'numerals'
  )[];
}

export interface QualitySample {
  readonly providerId: string;
  readonly lineId: string;
  readonly audio: Uint8Array;
  readonly sampleRate: 8000 | 16000;
  /** How the bytes are encoded. Providers do not agree, so it must be carried. */
  readonly encoding?: 'pcm16' | 'mulaw';
}

/** What a listener scores. Deliberately small — long forms get filled in badly. */
export interface ListenerScore {
  readonly sampleKey: string;
  readonly listenerId: string;
  /** 1–5. Can you understand every word? */
  readonly intelligibility: number;
  /** 1–5. Does it sound like a person? */
  readonly naturalness: number;
  /** 1–5. Are names, numbers and terms pronounced correctly? */
  readonly pronunciation: number;
  /** 1–5. Would this be acceptable calling an Indian candidate? */
  readonly indianSuitability: number;
  /** The gate: would you reject this voice outright? */
  readonly unacceptable: boolean;
  readonly notes?: string;
}

/** Deterministic PRNG so shuffles are reproducible from the recorded seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export interface BlindSet {
  /** Opaque key → provider+line. NEVER shown to the listener. */
  readonly mapping: Readonly<Record<string, { providerId: string; lineId: string }>>;
  /** Presentation order, by opaque key. */
  readonly order: readonly string[];
  readonly seed: number;
  /** The single rate every sample was levelled to before being heard. */
  readonly presentationSampleRate?: number;
}

/**
 * Build a blind set.
 *
 * Keys are `sample-NNN` in shuffled order, carrying no provider information —
 * not even a stable per-provider prefix, which would let a listener notice that
 * every `a-*` sample sounds the same.
 */
export function buildBlindSet(samples: readonly QualitySample[], seed: number): BlindSet {
  const shuffled = shuffle(samples, seed);
  const mapping: Record<string, { providerId: string; lineId: string }> = {};
  const order: string[] = [];

  shuffled.forEach((sample, index) => {
    const key = `sample-${String(index + 1).padStart(3, '0')}`;
    mapping[key] = { providerId: sample.providerId, lineId: sample.lineId };
    order.push(key);
  });

  return { mapping, order, seed };
}

/**
 * Write the listening pack.
 *
 * Audio and the scoring sheet go in `listen/`; the mapping goes OUTSIDE it, so
 * a listener handed the folder cannot accidentally decode the set.
 */
export async function writeBlindPack(
  rootDir: string,
  samples: readonly QualitySample[],
  lines: readonly QualityLine[],
  seed: number,
): Promise<{ blindSet: BlindSet; listenDir: string; mappingPath: string }> {
  // Every sample must correspond to a known line. Without the reference text a
  // listener cannot judge pronunciation, and a silently empty scoring sheet
  // would produce confident scores about nothing.
  const knownLines = new Set(lines.map((l) => l.lineId));
  const orphans = samples.filter((s) => !knownLines.has(s.lineId)).map((s) => s.lineId);
  if (orphans.length > 0) {
    throw new Error(
      `Quality samples reference unknown line ids: ${[...new Set(orphans)].join(', ')}. ` +
        'Every sample must map to a line so the listener sees the intended text.',
    );
  }

  const blindSet = buildBlindSet(samples, seed);
  const listenDir = join(rootDir, 'listen');
  await mkdir(listenDir, { recursive: true });

  // One rate for everybody, chosen as the lowest any provider gave us.
  const presentationRate = samples.reduce(
    (lowest, sample) => Math.min(lowest, sample.sampleRate),
    Infinity,
  ) as 8000 | 16000;
  const resampled = samples.filter((s) => s.sampleRate !== presentationRate);
  if (resampled.length > 0) {
    // Named, not silent: whoever gets resampled is carrying an artefact its
    // peers do not, and a listener scoring it does not know that.
    console.warn(
      `⚠ ${new Set(resampled.map((s) => s.providerId)).size} provider(s) had to be resampled to ` +
        `${presentationRate} Hz for the listening pack: ` +
        `${[...new Set(resampled.map((s) => s.providerId))].join(', ')}. ` +
        'They carry resampling artefacts their peers do not. Prefer asking every provider for ' +
        'the same documented output format.',
    );
  }

  const byKey = new Map(Object.entries(blindSet.mapping));
  const byProviderLine = new Map(samples.map((s) => [`${s.providerId}::${s.lineId}`, s]));
  const linesById = new Map(lines.map((l) => [l.lineId, l]));

  for (const key of blindSet.order) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const sample = byProviderLine.get(`${entry.providerId}::${entry.lineId}`);
    if (!sample) continue;
    const decoded = sample.encoding === 'mulaw'
      ? mulawToSamples(sample.audio)
      : pcm16ToSamples(sample.audio);
    const levelled = sample.sampleRate === presentationRate
      ? decoded
      : resample(decoded, sample.sampleRate, presentationRate);
    await writeFile(join(listenDir, `${key}.wav`), encodeWav(levelled, presentationRate));
  }

  // The scoring sheet, pre-filled with keys and no provider information.
  const sheet = blindSet.order.map((key) => {
    const entry = byKey.get(key);
    const line = entry ? linesById.get(entry.lineId) : undefined;
    return {
      sampleKey: key,
      // The TEXT is shown — a listener must know what was meant to judge
      // pronunciation — but never who said it.
      text: line?.text ?? '',
      probes: line?.probes ?? [],
      intelligibility: null,
      naturalness: null,
      pronunciation: null,
      indianSuitability: null,
      unacceptable: null,
      notes: '',
    };
  });

  await writeFile(
    join(listenDir, 'scoring-sheet.json'),
    JSON.stringify(
      {
        instructions:
          'Score each sample 1-5 on the four dimensions and set "unacceptable" true ' +
          'if you would reject this voice for calling a real candidate. Do not ' +
          'discuss with other listeners before submitting. You are not told which ' +
          'provider produced which sample, and that is deliberate.',
        listenerId: '<your initials>',
        samples: sheet,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // Mapping lives OUTSIDE listen/ so handing over the folder cannot leak it.
  const mappingPath = join(rootDir, 'blind-mapping.json');
  await writeFile(
    mappingPath,
    JSON.stringify({ ...blindSet, presentationSampleRate: presentationRate }, null, 2) + '\n',
    'utf8',
  );

  return {
    blindSet: { ...blindSet, presentationSampleRate: presentationRate },
    listenDir,
    mappingPath,
  };
}

export interface QualityVerdict {
  readonly providerId: string;
  readonly listeners: number;
  readonly unacceptableVotes: number;
  readonly excluded: boolean;
  readonly meanIntelligibility: number;
  readonly meanNaturalness: number;
  readonly meanPronunciation: number;
  readonly meanIndianSuitability: number;
}

/**
 * Decode scores against the mapping and apply the gate.
 *
 * The gate, pre-registered: **a candidate that 2 of 3 listeners mark
 * unacceptable is excluded**, regardless of latency or price.
 */
export function decodeQuality(
  blindSet: BlindSet,
  scores: readonly ListenerScore[],
  unacceptableThreshold = 2,
): readonly QualityVerdict[] {
  const byProvider = new Map<string, { scores: ListenerScore[]; listeners: Set<string> }>();

  for (const score of scores) {
    const entry = blindSet.mapping[score.sampleKey];
    if (!entry) continue;
    const bucket = byProvider.get(entry.providerId) ?? { scores: [], listeners: new Set() };
    bucket.scores.push(score);
    bucket.listeners.add(score.listenerId);
    byProvider.set(entry.providerId, bucket);
  }

  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

  return [...byProvider.entries()].map(([providerId, bucket]) => {
    // Count LISTENERS who rejected, not samples — one listener disliking five
    // samples is one vote, not five.
    const rejecting = new Set(
      bucket.scores.filter((s) => s.unacceptable).map((s) => s.listenerId),
    );
    return {
      providerId,
      listeners: bucket.listeners.size,
      unacceptableVotes: rejecting.size,
      excluded: rejecting.size >= unacceptableThreshold,
      meanIntelligibility: mean(bucket.scores.map((s) => s.intelligibility)),
      meanNaturalness: mean(bucket.scores.map((s) => s.naturalness)),
      meanPronunciation: mean(bucket.scores.map((s) => s.pronunciation)),
      meanIndianSuitability: mean(bucket.scores.map((s) => s.indianSuitability)),
    };
  });
}
