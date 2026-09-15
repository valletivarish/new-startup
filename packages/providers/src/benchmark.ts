/**
 * Benchmark measurement contracts (Phase 5C).
 *
 * `06_PROVIDER_AND_COST_SPEC` §16: "Store benchmark results rather than making
 * decisions from vendor marketing claims." These are the shapes those stored
 * results take.
 *
 * Two properties matter more than anything else here:
 *
 *   1. **Every stage is measured separately.** A single "total latency" number
 *      cannot tell you whether to change STT vendor, TTS vendor, or the
 *      endpointing threshold. The whole point is attribution.
 *   2. **The pass/fail rule is pre-registered**, in `BenchmarkThresholds`, and
 *      compared mechanically. A threshold decided after seeing the numbers is
 *      not a threshold, it is a rationalisation.
 *
 * Interfaces only. No provider is named anywhere in this file.
 */

/**
 * The marks that define a conversational turn.
 *
 * All values are milliseconds from a monotonic clock, not wall clock — the
 * differences are what matter and wall clock can step.
 *
 * The chain, in order:
 *
 *   speechEndedAt      candidate stopped talking (VAD decision)
 *     → sttFinalAt     final transcript available
 *     → llmFirstTokenAt first token of the response
 *     → ttsFirstByteAt first synthesised audio byte
 *     → audioOutAt     first frame handed to the carrier
 */
export interface TurnTimeline {
  readonly turnIndex: number;
  /** When the candidate started speaking. Optional — not every turn has it. */
  readonly speechStartedAt?: number;
  readonly speechEndedAt: number;
  readonly sttFinalAt?: number;
  readonly llmFirstTokenAt?: number;
  readonly llmCompleteAt?: number;
  readonly ttsFirstByteAt?: number;
  readonly audioOutAt?: number;
  /** Set when the turn failed, so a failed turn is never silently averaged in. */
  readonly failed?: { readonly stage: BenchmarkStage; readonly reason: string };
}

export type BenchmarkStage =
  | 'endpointing'
  | 'stt'
  | 'llm_first_token'
  | 'llm_complete'
  | 'tts_first_byte'
  | 'audio_out'
  | 'total_turn';

/** Per-stage durations derived from a timeline. Undefined where a mark is absent. */
export type StageDurations = {
  readonly [S in BenchmarkStage]?: number;
};

/**
 * A distribution summary.
 *
 * p50 and p95 are reported, never the mean. A mean hides the tail, and the tail
 * is what a candidate actually experiences as "the agent is slow".
 */
export interface LatencyDistribution {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Transcript accuracy.
 *
 * WER is the standard measure, but it is a poor proxy for screening quality on
 * its own: getting "nine" vs "9" wrong costs a word, and getting the notice
 * period wrong costs the whole screen. `entityAccuracy` measures the second
 * thing, and for this product it is the one that decides usability.
 */
export interface TranscriptAccuracy {
  /** Word error rate, 0..1+ (insertions can push it above 1). */
  readonly wer: number;
  /** Character error rate — more forgiving of transliteration variance. */
  readonly cer: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  readonly referenceWords: number;
  /** Fraction of required facts correctly captured, 0..1. */
  readonly entityAccuracy?: number;
  readonly entitiesExpected?: number;
  readonly entitiesFound?: number;
  /**
   * Facts the transcript got CONFIDENTLY WRONG, as opposed to missed.
   *
   * A missing notice period makes the agent re-ask. A wrong one silently
   * rejects a qualified candidate. Scoring them identically would understate
   * exactly the harm this metric exists to bound.
   */
  readonly entitiesWrong?: number;
}

/** What was under test. Names are recorded, never chosen by this layer. */
export interface BenchmarkSubject {
  readonly telephony?: string;
  readonly stt: string;
  readonly tts: string;
  readonly llm: string;
  /** `en-IN`, `hi-IN`, or `hinglish` for deliberately code-mixed material. */
  readonly language: string;
  /** The audio path the material went through — see `AudioCondition`. */
  readonly condition: AudioCondition;
}

/**
 * The audio condition a case was run under.
 *
 * `narrowband_8k` is the honest default: audio from an Indian mobile has already
 * been through AMR-NB/EVS on the radio leg and narrowband transcoding at the
 * PSTN handoff. Benchmarking on clean 16 kHz studio audio measures something the
 * product will never see.
 */
export type AudioCondition =
  | 'clean_16k'
  | 'narrowband_8k'
  | 'narrowband_8k_noisy'
  | 'live_pstn';

export interface BenchmarkCaseResult {
  readonly caseId: string;
  readonly subject: BenchmarkSubject;
  readonly turns: readonly TurnTimeline[];
  readonly accuracy?: TranscriptAccuracy;
  /** Barge-in: did an interruption actually stop playback, and how fast? */
  readonly bargeIn?: { readonly honoured: boolean; readonly latencyMs?: number };
  readonly errors: readonly string[];
}

/** The pre-registered decision rule. Set BEFORE any run; compared mechanically. */
export interface BenchmarkThresholds {
  /** The headline gate. 1200 ms per `06_PROVIDER_AND_COST_SPEC` §14. */
  readonly totalTurnP50Ms: number;
  readonly totalTurnP95Ms: number;
  readonly sttP50Ms?: number;
  readonly llmFirstTokenP50Ms?: number;
  readonly ttsFirstByteP50Ms?: number;
  /** Maximum acceptable word error rate. */
  readonly maxWer?: number;
  /** Minimum acceptable entity accuracy — the screening-usability gate. */
  readonly minEntityAccuracy?: number;
  /**
   * Hard turn failures permitted, as a COUNT.
   *
   * A count, not a rate, because at 30 turns a 2% rate is unreachable — one
   * transient 429 is 3.3% — so a rate gate fails stacks for network weather
   * rather than provider quality. A turn counts as failed only after its
   * retries are exhausted.
   */
  readonly maxHardFailures?: number;
}

export type BenchmarkVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

export interface BenchmarkRunSummary {
  readonly runId: string;
  /** ISO 8601. Supplied by the caller — this layer does not read the clock. */
  readonly startedAt: string;
  readonly subject: BenchmarkSubject;
  readonly thresholds: BenchmarkThresholds;
  readonly stages: { readonly [S in BenchmarkStage]?: LatencyDistribution };
  readonly accuracy?: TranscriptAccuracy;
  readonly turnCount: number;
  readonly failedTurnCount: number;
  readonly verdict: BenchmarkVerdict;
  /** Every threshold that was not met, in business language. */
  readonly failures: readonly string[];
  /** Why a run is INCOMPLETE rather than PASS/FAIL — e.g. too few samples. */
  readonly incompleteReasons: readonly string[];
  /**
   * Per-stage budget overruns. ADVISORY — these attribute where the time went
   * and never change the verdict, which is decided by the total.
   */
  readonly warnings: readonly string[];
}
