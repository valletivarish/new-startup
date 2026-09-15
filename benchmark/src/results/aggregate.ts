/**
 * Aggregation — turning raw rows into the figures a verdict is applied to.
 *
 * Everything here is a pure function of the raw file, so any aggregate can be
 * recomputed later and checked against what was reported. That is what makes a
 * verdict auditable instead of merely asserted.
 *
 * Three rules carried through from measurement:
 *   * failed samples are excluded from latency and counted separately;
 *   * samples that only succeeded after a retry are ALSO excluded from latency,
 *     because a provider that is flaky-but-eventually-fast must not out-rank
 *     one that is reliably mediocre;
 *   * but a retried sample's TRANSCRIPT is still a valid transcript. Excluding
 *     it from accuracy as well — as this file used to — threw away real
 *     evidence about the thing the screening gate actually measures, and made
 *     the accuracy sample size quietly smaller than the reported denominator.
 */

import type {
  BenchmarkStage,
  LatencyDistribution,
  TranscriptAccuracy,
} from '@platform/providers';

import { distribution, stageDurations } from '../measure/latency.js';
import { combineAccuracy } from '../measure/accuracy.js';
import {
  ADAPTER_DEFECT,
  summariseFailures,
  type FailureRecord,
  type FailureSummary,
} from '../measure/failures.js';
import type { SttCaseResult } from '../runner/stt-runner.js';
import type { TtsCaseResult } from '../runner/tts-runner.js';
import type { E2eTurnResult } from '../runner/e2e-runner.js';

export interface SttAggregate {
  readonly kind: 'stt';
  readonly stages: { readonly [S in BenchmarkStage]?: LatencyDistribution };
  /** Wall-clock request→completion. Reported for context, never gated on. */
  readonly totalRequest?: LatencyDistribution;
  readonly firstInterim?: LatencyDistribution;
  readonly accuracy?: TranscriptAccuracy;
  readonly hinglishAccuracy?: TranscriptAccuracy;
  readonly failures: FailureSummary;
  readonly sampleCount: number;
  /** Failures caused by our own adapter (4xx), which say nothing about the provider. */
  readonly adapterDefectCount: number;
  /**
   * Samples whose transcript could not be compared with any supplied reference.
   *
   * A corpus gap, not a provider result — but it shrinks the accuracy sample,
   * so it must be visible rather than silently reducing the denominator.
   */
  readonly unscoreableCount: number;
  /** Reasons, deduplicated, so the corpus gap can be fixed. */
  readonly unscoreableReasons: readonly string[];
  /** Proof the residual figure is not merely tracking utterance length. */
  readonly residualVsDurationCorrelation?: number;
}

/** Failures that are our adapter's fault rather than the provider's. */
function countAdapterDefects(records: readonly FailureRecord[]): number {
  return records.filter((r) => ADAPTER_DEFECT.has(r.category)).length;
}

/** Pearson correlation. Used as a bias check, not as a headline metric. */
export function correlation(xs: readonly number[], ys: readonly number[]): number | undefined {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return undefined;
  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (xs[i] as number) - meanX;
    const b = (ys[i] as number) - meanY;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return undefined;
  return num / Math.sqrt(dx * dy);
}

export function aggregateStt(results: readonly SttCaseResult[]): SttAggregate {
  const failed = results.filter((r) => r.failure);
  // Clean = succeeded first time. Retried samples carry the retry's latency.
  const clean = results.filter((r) => !r.failure && !r.recovered);

  const residuals: number[] = [];
  const totals: number[] = [];
  const interims: number[] = [];
  // Paired, not two parallel arrays. Pushing into them under different
  // conditions let one fall behind the other, and `correlation` pairs by index —
  // so one sample missing a duration silently shifted every later pair and the
  // bias check reported a correlation between unrelated values.
  const residualByDuration: { duration: number; residual: number }[] = [];

  for (const result of clean) {
    const m = result.measurements;
    if (m.residualMs !== undefined) {
      residuals.push(m.residualMs);
      if (m.audioDurationMs !== undefined) {
        residualByDuration.push({ duration: m.audioDurationMs, residual: m.residualMs });
      }
    }
    if (m.totalMs !== undefined) totals.push(m.totalMs);
    if (m.firstInterimMs !== undefined) interims.push(m.firstInterimMs);
  }

  // Accuracy is scored over every sample that produced a transcript, including
  // retried ones: a retry changes when the answer arrived, not what it said.
  const transcribed = results.filter((r) => !r.failure);
  const scored = transcribed.filter((r) => r.accuracy).map((r) => r.accuracy as TranscriptAccuracy);
  const hinglish = transcribed
    .filter((r) => r.codeMixed && r.accuracy)
    .map((r) => r.accuracy as TranscriptAccuracy);

  // A HARD-FAILED utterance produced no transcript, so it contributed nothing
  // to the entity denominator — which made failing outright score strictly
  // BETTER than transcribing badly. Its expected entities are counted as
  // missing, because on a real call they were not captured either.
  const failedEntityScores: TranscriptAccuracy[] = failed
    .map((r) => r.expectedEntityCount ?? 0)
    .filter((expected) => expected > 0)
    .map((expected) => ({
      wer: 0, cer: 0, substitutions: 0, deletions: 0, insertions: 0, referenceWords: 0,
      entityAccuracy: 0, entitiesExpected: expected, entitiesFound: 0, entitiesWrong: 0,
    }));

  const records: FailureRecord[] = failed.map((r) => ({
    utteranceId: r.utteranceId,
    category: r.failure?.category ?? 'unknown',
    message: r.failure?.message ?? 'unknown',
    attempts: r.attempts,
  }));

  const residualDistribution = distribution(residuals);

  return {
    kind: 'stt',
    stages: residualDistribution ? { stt: residualDistribution } : {},
    ...(distribution(totals) ? { totalRequest: distribution(totals) as LatencyDistribution } : {}),
    ...(distribution(interims) ? { firstInterim: distribution(interims) as LatencyDistribution } : {}),
    ...(combineAccuracy([...scored, ...failedEntityScores])
      ? { accuracy: combineAccuracy([...scored, ...failedEntityScores]) as TranscriptAccuracy }
      : {}),
    ...(combineAccuracy(hinglish)
      ? { hinglishAccuracy: combineAccuracy(hinglish) as TranscriptAccuracy }
      : {}),
    failures: summariseFailures({
      attempted: results.length,
      succeeded: results.length - failed.length,
      recovered: results.filter((r) => r.recovered).length,
      records,
    }),
    sampleCount: residuals.length,
    adapterDefectCount: countAdapterDefects(records),
    unscoreableCount: results.filter((r) => r.unscoreable).length,
    unscoreableReasons: [...new Set(results.flatMap((r) => (r.unscoreable ? [r.unscoreable] : [])))],
    ...(correlation(
      residualByDuration.map((p) => p.duration),
      residualByDuration.map((p) => p.residual),
    ) !== undefined
      ? {
          residualVsDurationCorrelation: correlation(
            residualByDuration.map((p) => p.duration),
            residualByDuration.map((p) => p.residual),
          ) as number,
        }
      : {}),
  };
}

export interface TtsAggregate {
  readonly kind: 'tts';
  readonly stages: { readonly [S in BenchmarkStage]?: LatencyDistribution };
  readonly firstAudible?: LatencyDistribution;
  readonly realTimeFactor?: LatencyDistribution;
  readonly failures: FailureSummary;
  readonly sampleCount: number;
  readonly adapterDefectCount: number;
}

export function aggregateTts(results: readonly TtsCaseResult[]): TtsAggregate {
  const failed = results.filter((r) => r.failure);
  const clean = results.filter((r) => !r.failure && !r.recovered);

  const firstBytes: number[] = [];
  const audibles: number[] = [];
  const rtfs: number[] = [];
  for (const result of clean) {
    const m = result.measurements;
    if (m.firstByteMs !== undefined) firstBytes.push(m.firstByteMs);
    if (m.firstAudibleMs !== undefined) audibles.push(m.firstAudibleMs);
    if (m.realTimeFactor !== undefined) rtfs.push(m.realTimeFactor);
  }

  const records: FailureRecord[] = failed.map((r) => ({
    utteranceId: r.lineId,
    category: r.failure?.category ?? 'unknown',
    message: r.failure?.message ?? 'unknown',
    attempts: r.attempts,
  }));

  const firstByteDistribution = distribution(firstBytes);

  return {
    kind: 'tts',
    stages: firstByteDistribution ? { tts_first_byte: firstByteDistribution } : {},
    ...(distribution(audibles) ? { firstAudible: distribution(audibles) as LatencyDistribution } : {}),
    ...(distribution(rtfs) ? { realTimeFactor: distribution(rtfs) as LatencyDistribution } : {}),
    failures: summariseFailures({
      attempted: results.length,
      succeeded: results.length - failed.length,
      recovered: results.filter((r) => r.recovered).length,
      records,
    }),
    sampleCount: firstBytes.length,
    adapterDefectCount: countAdapterDefects(records),
  };
}

export interface E2eAggregate {
  readonly kind: 'end_to_end';
  readonly stages: { readonly [S in BenchmarkStage]?: LatencyDistribution };
  readonly accuracy?: TranscriptAccuracy;
  readonly hinglishAccuracy?: TranscriptAccuracy;
  readonly failures: FailureSummary;
  /** Turns with a measurable total_turn. The denominator the gate is applied to. */
  readonly sampleCount: number;
  readonly adapterDefectCount: number;
  /** Where failures happened, so a failing layer is attributable rather than pooled. */
  readonly failuresByStage: Readonly<Record<string, number>>;
  readonly conversationCount: number;
  /** Characters actually SENT to TTS across the run — what a provider meters. */
  readonly replyCharacters: number;
  /** Characters the model generated, of which only the first sentence was sent. */
  readonly replyLength: number;
}

/**
 * Aggregate an end-to-end run.
 *
 * Same two exclusions as everywhere else: failed turns are excluded from
 * latency and counted, and turns that only succeeded after a retry are excluded
 * from latency but keep their transcript in the accuracy sample.
 */
export function aggregateE2e(results: readonly E2eTurnResult[]): E2eAggregate {
  const failed = results.filter((r) => r.failure);
  const clean = results.filter((r) => !r.failure && !r.recovered);

  const buckets = new Map<string, number[]>();
  for (const result of clean) {
    for (const [stage, ms] of Object.entries(stageDurations(result.timeline))) {
      if (typeof ms !== 'number') continue;
      const list = buckets.get(stage) ?? [];
      list.push(ms);
      buckets.set(stage, list);
    }
  }
  const stages: Record<string, LatencyDistribution> = {};
  for (const [stage, values] of buckets) {
    const d = distribution(values);
    if (d) stages[stage] = d;
  }

  const transcribed = results.filter((r) => r.accuracy);
  const scored = transcribed.map((r) => r.accuracy as TranscriptAccuracy);
  const hinglish = transcribed
    .filter((r) => r.codeMixed)
    .map((r) => r.accuracy as TranscriptAccuracy);

  const records: FailureRecord[] = failed.map((r) => ({
    utteranceId: r.utteranceId,
    category: r.failure?.category ?? 'unknown',
    message: r.failure?.message ?? 'unknown',
    attempts: r.attempts.stt + r.attempts.llm + r.attempts.tts,
  }));

  const failuresByStage: Record<string, number> = {};
  for (const result of failed) {
    const stage = result.failure?.stage ?? 'unknown';
    failuresByStage[stage] = (failuresByStage[stage] ?? 0) + 1;
  }

  return {
    kind: 'end_to_end',
    stages: stages as { [S in BenchmarkStage]?: LatencyDistribution },
    ...(combineAccuracy(scored) ? { accuracy: combineAccuracy(scored) as TranscriptAccuracy } : {}),
    ...(combineAccuracy(hinglish)
      ? { hinglishAccuracy: combineAccuracy(hinglish) as TranscriptAccuracy }
      : {}),
    failures: summariseFailures({
      attempted: results.length,
      succeeded: results.length - failed.length,
      recovered: results.filter((r) => r.recovered).length,
      records,
    }),
    sampleCount: stages['total_turn']?.count ?? 0,
    adapterDefectCount: countAdapterDefects(records),
    failuresByStage,
    conversationCount: new Set(results.map((r) => r.conversationId)).size,
    replyCharacters: results.reduce((n, r) => n + r.replyCharacters, 0),
    replyLength: results.reduce((n, r) => n + r.replyLength, 0),
  };
}
