/**
 * Latency measurement.
 *
 * The value of this module is ATTRIBUTION. A single "1.4 s" says the agent is
 * slow; it does not say whether to change the STT vendor, the TTS vendor, or
 * the endpointing threshold.
 *
 * TWO DEFECTS THIS FILE EXISTS TO NOT REPEAT:
 *
 *  1. STT latency measured from request start to final response. That number is
 *     dominated by utterance length and by how fast audio was uploaded, and it
 *     ERASES streaming STT's entire production advantage — a streaming provider
 *     has already processed everything but the last fragment when the endpoint
 *     fires. Here the primary STT figure is POST-ENDPOINT RESIDUAL latency, and
 *     the wall-clock total is reported separately rather than instead.
 *
 *  2. TTS first-byte measured from LLM first token in a NON-streaming pipeline,
 *     which charges TTS for the LLM's remaining generation time. Measured from
 *     whichever LLM mark actually preceded synthesis.
 *
 * Percentiles are nearest-rank, so every reported figure is a value that
 * actually occurred. Means are never reported: a mean hides the tail, and the
 * tail is what a candidate experiences.
 */

import type {
  BenchmarkStage,
  LatencyDistribution,
  StageDurations,
  TurnTimeline,
} from '@platform/providers';

/** Monotonic clock. Injected everywhere so tests assert exact durations. */
export type Clock = () => number;

export const systemClock: Clock = () => performance.now();

// ---------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------

/**
 * Every mark of one STT request.
 *
 * `audioEndedAt` is the endpoint: the moment the last audio frame was handed
 * over, which on a live call is when the VAD fires. Everything the latency
 * budget cares about is measured from there.
 */
export interface SttTimeline {
  readonly requestStartedAt: number;
  readonly audioStartedAt?: number;
  readonly audioEndedAt?: number;
  readonly firstInterimAt?: number;
  /** One entry per `isFinal` result, in arrival order. */
  readonly finalAts: readonly number[];
  readonly completedAt?: number;
  readonly retries: number;
  readonly failed?: string;
}

export interface SttMeasurements {
  /** THE primary figure: endpoint → last final. What the 300 ms budget means. */
  readonly residualMs?: number;
  /**
   * Set when the endpoint landed AFTER the last final, which is physically
   * impossible for a real measurement and means the adapter abandoned the audio
   * before consuming it. The residual is withheld rather than reported as a
   * flatteringly small (or negative) number.
   */
  readonly residualInvalid?: true;
  /** Wall clock request → completion. Reported, never used as the gate. */
  readonly totalMs?: number;
  /** Endpoint → first interim. Tells you whether a provider streams at all. */
  readonly firstInterimMs?: number;
  /** How long the audio itself was, so residual can be seen to be independent. */
  readonly audioDurationMs?: number;
  readonly finalCount: number;
  readonly retries: number;
}

export function measureStt(timeline: SttTimeline): SttMeasurements {
  const lastFinal = timeline.finalAts.at(-1);
  const endpoint = timeline.audioEndedAt;
  const residual =
    endpoint !== undefined && lastFinal !== undefined ? lastFinal - endpoint : undefined;
  return {
    ...(residual !== undefined && residual > 0 ? { residualMs: residual } : {}),
    ...(residual !== undefined && residual <= 0 ? { residualInvalid: true as const } : {}),
    ...(timeline.completedAt !== undefined
      ? { totalMs: timeline.completedAt - timeline.requestStartedAt }
      : {}),
    ...(endpoint !== undefined && timeline.firstInterimAt !== undefined
      ? { firstInterimMs: timeline.firstInterimAt - endpoint }
      : {}),
    ...(timeline.audioStartedAt !== undefined && endpoint !== undefined
      ? { audioDurationMs: endpoint - timeline.audioStartedAt }
      : {}),
    finalCount: timeline.finalAts.length,
    retries: timeline.retries,
  };
}

export function createSttRecorder(now: Clock = systemClock) {
  const requestStartedAt = now();
  let audioStartedAt: number | undefined;
  let audioEndedAt: number | undefined;
  let firstInterimAt: number | undefined;
  const finalAts: number[] = [];
  let completedAt: number | undefined;
  let retries = 0;
  let failed: string | undefined;

  return {
    audioStarted() { audioStartedAt ??= now(); },
    /** The endpoint. First write wins — a second call is caller confusion. */
    audioEnded() { audioEndedAt ??= now(); },
    interim() { firstInterimAt ??= now(); },
    /** Records EVERY final. A streaming provider emits one per segment. */
    final() { finalAts.push(now()); },
    completed() { completedAt ??= now(); },
    retried() { retries += 1; },
    fail(reason: string) { failed ??= reason; },
    timeline(): SttTimeline {
      return {
        requestStartedAt,
        ...(audioStartedAt !== undefined ? { audioStartedAt } : {}),
        ...(audioEndedAt !== undefined ? { audioEndedAt } : {}),
        ...(firstInterimAt !== undefined ? { firstInterimAt } : {}),
        finalAts: [...finalAts],
        ...(completedAt !== undefined ? { completedAt } : {}),
        retries,
        ...(failed !== undefined ? { failed } : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TtsTimeline {
  readonly requestStartedAt: number;
  readonly firstByteAt?: number;
  /** First frame carrying non-silent audio, where measurable. */
  readonly firstAudibleAt?: number;
  readonly completedAt?: number;
  /** Duration of the audio produced, not of the request. */
  readonly outputDurationMs?: number;
  readonly bytes: number;
  readonly retries: number;
  readonly failed?: string;
}

export interface TtsMeasurements {
  /** THE gate figure. */
  readonly firstByteMs?: number;
  readonly firstAudibleMs?: number;
  /** Wall clock to full synthesis. Only meaningful when the stream was drained. */
  readonly totalMs?: number;
  readonly outputDurationMs?: number;
  /** Faster than real time is >1. Below 1 means synthesis cannot keep up. */
  readonly realTimeFactor?: number;
  readonly bytes: number;
  readonly retries: number;
}

export function measureTts(timeline: TtsTimeline): TtsMeasurements {
  const totalMs =
    timeline.completedAt !== undefined
      ? timeline.completedAt - timeline.requestStartedAt
      : undefined;
  return {
    ...(timeline.firstByteAt !== undefined
      ? { firstByteMs: timeline.firstByteAt - timeline.requestStartedAt }
      : {}),
    ...(timeline.firstAudibleAt !== undefined
      ? { firstAudibleMs: timeline.firstAudibleAt - timeline.requestStartedAt }
      : {}),
    ...(totalMs !== undefined ? { totalMs } : {}),
    ...(timeline.outputDurationMs !== undefined
      ? { outputDurationMs: timeline.outputDurationMs }
      : {}),
    ...(totalMs !== undefined && totalMs > 0 && timeline.outputDurationMs !== undefined
      ? { realTimeFactor: timeline.outputDurationMs / totalMs }
      : {}),
    bytes: timeline.bytes,
    retries: timeline.retries,
  };
}

export function createTtsRecorder(now: Clock = systemClock) {
  const requestStartedAt = now();
  let firstByteAt: number | undefined;
  let firstAudibleAt: number | undefined;
  let completedAt: number | undefined;
  let outputDurationMs: number | undefined;
  let bytes = 0;
  let retries = 0;
  let failed: string | undefined;

  return {
    firstByte() { firstByteAt ??= now(); },
    firstAudible() { firstAudibleAt ??= now(); },
    chunk(byteLength: number) { bytes += byteLength; },
    completed(durationMs?: number) {
      completedAt ??= now();
      if (durationMs !== undefined) outputDurationMs ??= durationMs;
    },
    retried() { retries += 1; },
    fail(reason: string) { failed ??= reason; },
    timeline(): TtsTimeline {
      return {
        requestStartedAt,
        ...(firstByteAt !== undefined ? { firstByteAt } : {}),
        ...(firstAudibleAt !== undefined ? { firstAudibleAt } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        ...(outputDurationMs !== undefined ? { outputDurationMs } : {}),
        bytes,
        retries,
        ...(failed !== undefined ? { failed } : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Turn-level chain
// ---------------------------------------------------------------------------

export function createTurnRecorder(turnIndex: number, now: Clock = systemClock) {
  const marks: Record<string, number> = {};
  let failure: TurnTimeline['failed'];

  return {
    /** First write wins. A duplicate is caller confusion, not new information. */
    mark(name: keyof Omit<TurnTimeline, 'turnIndex' | 'failed'>): void {
      if (marks[name] === undefined) marks[name] = now();
    },
    /** Last write wins — for stages whose final occurrence is the meaningful one. */
    markLatest(name: keyof Omit<TurnTimeline, 'turnIndex' | 'failed'>): void {
      marks[name] = now();
    },
    at(name: keyof Omit<TurnTimeline, 'turnIndex' | 'failed'>, value: number): void {
      marks[name] = value;
    },
    fail(stage: BenchmarkStage, reason: string): void {
      failure ??= { stage, reason };
    },
    timeline(): TurnTimeline {
      const speechEndedAt = marks['speechEndedAt'];
      if (speechEndedAt === undefined) {
        throw new Error(
          'A turn timeline needs speechEndedAt — it is the origin every stage is measured from.',
        );
      }
      const optional = (key: string) =>
        marks[key] !== undefined ? { [key]: marks[key] } : {};
      return {
        turnIndex,
        speechEndedAt,
        ...optional('speechStartedAt'),
        ...optional('sttFinalAt'),
        ...optional('llmFirstTokenAt'),
        ...optional('llmCompleteAt'),
        ...optional('ttsFirstByteAt'),
        ...optional('audioOutAt'),
        ...(failure ? { failed: failure } : {}),
      } as TurnTimeline;
    },
  };
}

export function stageDurations(timeline: TurnTimeline): StageDurations {
  const out: Record<string, number> = {};

  if (timeline.speechStartedAt !== undefined) {
    out['endpointing'] = timeline.speechEndedAt - timeline.speechStartedAt;
  }
  if (timeline.sttFinalAt !== undefined) {
    out['stt'] = timeline.sttFinalAt - timeline.speechEndedAt;
  }
  if (timeline.llmFirstTokenAt !== undefined && timeline.sttFinalAt !== undefined) {
    out['llm_first_token'] = timeline.llmFirstTokenAt - timeline.sttFinalAt;
  }
  if (timeline.llmCompleteAt !== undefined && timeline.sttFinalAt !== undefined) {
    out['llm_complete'] = timeline.llmCompleteAt - timeline.sttFinalAt;
  }
  if (timeline.ttsFirstByteAt !== undefined && timeline.llmFirstTokenAt !== undefined) {
    // STREAMING: synthesis begins on the first token, and llmCompleteAt lands
    // after the first audio byte — so measure from first token.
    // NON-STREAMING: the platform waits for the full response, so measuring
    // from first token would charge TTS for the LLM's remaining generation.
    // Pick whichever LLM mark actually preceded synthesis.
    const llmStart =
      timeline.llmCompleteAt !== undefined &&
      timeline.llmCompleteAt <= timeline.ttsFirstByteAt
        ? timeline.llmCompleteAt
        : timeline.llmFirstTokenAt;
    out['tts_first_byte'] = timeline.ttsFirstByteAt - llmStart;
  }
  if (timeline.audioOutAt !== undefined && timeline.ttsFirstByteAt !== undefined) {
    out['audio_out'] = timeline.audioOutAt - timeline.ttsFirstByteAt;
  }
  if (timeline.audioOutAt !== undefined) {
    out['total_turn'] = timeline.audioOutAt - timeline.speechEndedAt;
  } else if (timeline.ttsFirstByteAt !== undefined) {
    // OFFLINE DEFINITION, and the only honest one here: there is no carrier, so
    // "first frame handed to the carrier" does not exist. `06_PROVIDER_AND_COST_SPEC`
    // §14 states the budget as "from end of candidate speech to first returned
    // audio byte", which is exactly this measurement.
    //
    // `audioOutAt` is left UNSET rather than being stamped equal to the first
    // TTS byte, so the `audio_out` stage stays absent instead of reporting a
    // fabricated 0 ms, and the report can say the carrier leg is excluded.
    out['total_turn'] = timeline.ttsFirstByteAt - timeline.speechEndedAt;
  }
  return out as StageDurations;
}

/** Nearest rank — never interpolates, so every figure actually occurred. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty sample');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

export function distribution(values: readonly number[]): LatencyDistribution | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
  };
}

/**
 * Failed turns are EXCLUDED from latency and counted separately.
 *
 * `retries` is honoured too, so this agrees with `aggregateStt`/`aggregateTts`/
 * `aggregateE2e`. It used to filter only on `failed`, which meant this helper
 * silently INCLUDED retried turns while every other aggregator excluded them —
 * two different definitions of the same figure living in one package.
 */
export function aggregate(timelines: readonly TurnTimeline[]): {
  stages: { [S in BenchmarkStage]?: LatencyDistribution };
  turnCount: number;
  failedTurnCount: number;
} {
  const succeeded = timelines.filter((t) => !t.failed);
  const buckets = new Map<string, number[]>();
  for (const timeline of succeeded) {
    for (const [stage, ms] of Object.entries(stageDurations(timeline))) {
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
  return {
    stages: stages as { [S in BenchmarkStage]?: LatencyDistribution },
    turnCount: timelines.length,
    failedTurnCount: timelines.length - succeeded.length,
  };
}
