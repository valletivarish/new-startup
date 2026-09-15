/**
 * Pooling two runs of the same stack into one sample.
 *
 * PRE-REGISTERED, and it was not implemented. `PHASE_5C_BENCHMARK_DESIGN` §6:
 *
 *   "each stack runs twice at different times of day. POOL THE TURNS INTO ONE
 *    SAMPLE and compute percentiles on the pooled set — do not compare two
 *    verdicts."
 *
 * That instruction exists because one run is one sample of a provider's day,
 * and because comparing two verdicts invites picking the flattering one. It
 * also matters statistically: at n=30 the p95 is the second-largest value, so a
 * single outlier IS the p95. Pooling to n≈110 gives the tail real resolution.
 *
 * Pooling recomputes from `raw.jsonl`, never from `metrics.json`. The raw rows
 * are the evidence; the aggregates are a view of them, and a pooled aggregate
 * derived from other aggregates could not be audited.
 *
 * WHAT IT REFUSES TO POOL is the point of the module. Two runs may only be
 * combined when they measured the same thing: same adapter, same kind, same
 * corpus version, same audio condition, same codec, same benchmark version, and
 * the same set of per-utterance input checksums. Pooling across any of those
 * silently averages two different experiments.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { aggregateE2e, aggregateStt, aggregateTts } from './aggregate.js';
import { evaluate, STT_THRESHOLDS, TTS_THRESHOLDS } from '../measure/verdict.js';
import { readRaw, type RawRow, type RunMetadata } from './store.js';
import type { SttCaseResult } from '../runner/stt-runner.js';
import type { TtsCaseResult } from '../runner/tts-runner.js';
import type { E2eTurnResult } from '../runner/e2e-runner.js';

export class IncompatibleRunsError extends Error {
  constructor(reasons: readonly string[]) {
    super(
      `Refusing to pool runs that did not measure the same thing:\n  - ${reasons.join('\n  - ')}\n` +
        'Pooling across a different corpus, condition, codec or adapter would average two ' +
        'different experiments and report the result as one.',
    );
    this.name = 'IncompatibleRunsError';
  }
}

export interface LoadedRun {
  readonly directory: string;
  readonly metadata: RunMetadata;
  readonly rows: readonly RawRow[];
}

export async function loadRun(directory: string): Promise<LoadedRun> {
  const metadata = JSON.parse(
    await readFile(join(directory, 'metadata.json'), 'utf8'),
  ) as RunMetadata;
  return { directory, metadata, rows: await readRaw(directory) };
}

/** Everything that must match before two runs describe the same experiment. */
export function compatibilityReasons(runs: readonly LoadedRun[]): string[] {
  const reasons: string[] = [];
  const first = runs[0];
  if (!first) return ['No runs were given.'];

  const check = (
    label: string,
    of: (run: LoadedRun) => string,
  ) => {
    const values = new Set(runs.map(of));
    if (values.size > 1) {
      reasons.push(`${label} differs across runs: ${[...values].join(' vs ')}`);
    }
  };

  check('Run kind', (r) => r.metadata.subject.kind);
  check('Adapter', (r) => r.metadata.subject.adapterId);
  check('Adapter version', (r) => r.metadata.subject.adapterVersion);
  check('Model', (r) => r.metadata.subject.model);
  check('Corpus version', (r) => r.metadata.corpus.corpusVersion);
  check('Audio condition', (r) => r.metadata.corpus.condition);
  check('Narrowband codec', (r) => String(r.metadata.corpus.codec ?? 'none'));
  check('Benchmark version', (r) => r.metadata.benchmarkVersion);
  check('Retry budget', (r) => String(r.metadata.configuration.maxRetries));
  // Two runs from different places measured two different network paths. Pooling
  // them averages a Bangalore latency with somewhere else's and reports one
  // number, which is exactly the silent-averaging this module exists to refuse.
  check('Benchmark region', (r) => r.metadata.environment.region ?? '(not declared)');

  // The strongest check: the actual bytes each run sent. Two runs can agree on
  // every label above and still have been fed different audio if the corpus was
  // re-recorded without bumping its version.
  const fingerprint = (run: LoadedRun) =>
    Object.entries(run.metadata.corpus.inputChecksums)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, sum]) => `${id}:${sum}`)
      .join('|');
  if (new Set(runs.map(fingerprint)).size > 1) {
    reasons.push(
      'Per-utterance input checksums differ, so the runs were not fed identical audio ' +
        '(the corpus changed without its version changing).',
    );
  }

  return reasons;
}

/**
 * Read back rows of one kind, restoring the identifiers the row carries.
 *
 * `utteranceId` and `lineId` live on the ROW, not inside its payload, but the
 * aggregators read them off the case object. Handing them the bare payload
 * produced pooled failure records identifying `undefined` — a report that names
 * no utterance is a report you cannot act on.
 */
function rowsOfKind(runs: readonly LoadedRun[], kind: RawRow['kind']): unknown[] {
  return runs.flatMap((run) =>
    run.rows
      .filter((row) => row.kind === kind)
      .map((row) => ({
        ...(row.payload as Record<string, unknown>),
        ...(row.utteranceId !== undefined ? { utteranceId: row.utteranceId } : {}),
        ...(row.lineId !== undefined ? { lineId: row.lineId } : {}),
      })),
  );
}

export interface PooledResult {
  readonly kind: 'stt' | 'tts' | 'end_to_end';
  readonly runs: readonly string[];
  readonly aggregate: ReturnType<typeof aggregateStt> | ReturnType<typeof aggregateTts> | ReturnType<typeof aggregateE2e>;
  /**
   * The verdict on the POOLED sample — which is the only verdict the
   * pre-registered rule recognises.
   *
   * Pooling that stopped at an aggregate left the two per-run verdicts as the
   * only ones anybody could read, which is precisely the "compare two verdicts
   * and pick the flattering one" the pooling rule exists to prevent.
   */
  readonly verdict: ReturnType<typeof evaluate>;
  readonly metadata: RunMetadata;
}

/**
 * Pool runs and recompute the aggregate over the combined sample.
 *
 * `strict: false` is deliberately NOT offered. A caller who wants to pool
 * incompatible runs wants a number that does not mean anything.
 */
export async function poolRuns(directories: readonly string[]): Promise<PooledResult> {
  if (directories.length < 2) {
    throw new Error(
      'Pooling needs at least two runs. The pre-registered rule is two runs at different ' +
        'times of day, pooled — a single run is one sample of a provider\'s day.',
    );
  }
  const runs = await Promise.all(directories.map(loadRun));
  const reasons = compatibilityReasons(runs);
  if (reasons.length > 0) throw new IncompatibleRunsError(reasons);

  const first = runs[0] as LoadedRun;
  const kind = first.metadata.subject.kind;

  if (kind === 'stt') {
    const aggregate = aggregateStt(rowsOfKind(runs, 'stt') as SttCaseResult[]);
    return {
      kind, runs: directories, aggregate, metadata: first.metadata,
      verdict: evaluate({
        stages: aggregate.stages,
        ...(aggregate.accuracy ? { accuracy: aggregate.accuracy } : {}),
        ...(aggregate.hinglishAccuracy ? { hinglishAccuracy: aggregate.hinglishAccuracy } : {}),
        sampleCount: aggregate.sampleCount,
        hardFailureCount: aggregate.failures.failed,
        adapterDefectCount: aggregate.adapterDefectCount,
        recoveredCount: aggregate.failures.recovered,
        thresholds: STT_THRESHOLDS,
        headlineStage: 'stt',
      }),
    };
  }
  if (kind === 'tts') {
    const aggregate = aggregateTts(rowsOfKind(runs, 'tts') as TtsCaseResult[]);
    return {
      kind, runs: directories, aggregate, metadata: first.metadata,
      verdict: evaluate({
        stages: aggregate.stages,
        sampleCount: aggregate.sampleCount,
        hardFailureCount: aggregate.failures.failed,
        adapterDefectCount: aggregate.adapterDefectCount,
        recoveredCount: aggregate.failures.recovered,
        headlineComparable: first.metadata.subject.streaming,
        thresholds: TTS_THRESHOLDS,
        headlineStage: 'tts_first_byte',
      }),
    };
  }
  const aggregate = aggregateE2e(rowsOfKind(runs, 'turn') as E2eTurnResult[]);
  return {
    kind: 'end_to_end', runs: directories, aggregate, metadata: first.metadata,
    verdict: evaluate({
      stages: aggregate.stages,
      ...(aggregate.accuracy ? { accuracy: aggregate.accuracy } : {}),
      ...(aggregate.hinglishAccuracy ? { hinglishAccuracy: aggregate.hinglishAccuracy } : {}),
      sampleCount: aggregate.sampleCount,
      hardFailureCount: aggregate.failures.failed,
      adapterDefectCount: aggregate.adapterDefectCount,
      recoveredCount: aggregate.failures.recovered,
      thresholds: STT_THRESHOLDS,
      headlineStage: 'total_turn',
    }),
  };
}
