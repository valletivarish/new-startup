/**
 * The pre-registered decision rule.
 *
 * Thresholds are supplied BEFORE a run and compared mechanically here. A
 * threshold chosen after seeing numbers is not a threshold, it is a
 * justification. Keeping the comparison in one small pure function means the
 * rule cannot quietly drift into prose elsewhere.
 *
 * FOUR PROPERTIES THAT ARE EASY TO GET WRONG:
 *
 *  * Stage budgets are ADVISORY ATTRIBUTION. They say where the time SHOULD go
 *    and sum to 1100 ms; gating on all of them at once would silently impose a
 *    budget tighter than the 1200 ms actually pre-registered.
 *  * A COMPONENT GATE is not a stage budget. A component run measures one stage
 *    and has no total by construction, so it is gated at the point past which
 *    that stage ALONE cannot fit inside the pre-registered total even if every
 *    other stage hits its budget exactly:
 *
 *        stt gate  = totalTurn − (llmFirstToken + ttsFirstByte) = 1200 − 800 = 400 ms
 *        tts gate  = totalTurn − (stt + llmFirstToken)          = 1200 − 800 = 400 ms
 *
 *    That is derived from the total, imposes nothing tighter than it, and is
 *    BINDING. Without it a provider with a 5 s residual and one with 150 ms
 *    received the same verdict — which was the state of this file until the
 *    adversarial review found it.
 *  * Hard failures are a COUNT, not a rate. At 30 turns a 2% rate is
 *    unreachable — one transient 429 is 3.3%.
 *  * INCOMPLETE is a first-class outcome. A run with too few samples has not
 *    earned a PASS. It can still earn a FAIL: a breach already observed does
 *    not un-happen with more data.
 */

import type {
  BenchmarkStage,
  BenchmarkThresholds,
  BenchmarkVerdict,
  LatencyDistribution,
  TranscriptAccuracy,
} from '@platform/providers';

/** Below this many successful samples, a percentile is not a result. */
export const MIN_SAMPLES_FOR_VERDICT = 20;

/** The Phase 5C thresholds, as approved. Exported so runs cannot drift. */
export const PHASE_5C_THRESHOLDS: BenchmarkThresholds = {
  totalTurnP50Ms: 1200,
  totalTurnP95Ms: 2000,
  sttP50Ms: 300,
  llmFirstTokenP50Ms: 500,
  ttsFirstByteP50Ms: 300,
  maxWer: 0.25,
  minEntityAccuracy: 0.9,
  maxHardFailures: 1,
};

/**
 * An STT run measures transcript accuracy, so it carries the full rule.
 */
export const STT_THRESHOLDS: BenchmarkThresholds = PHASE_5C_THRESHOLDS;

/**
 * A TTS run cannot measure transcript accuracy — there is no transcript.
 *
 * Handing it the accuracy gates made every TTS run INCOMPLETE for a reason that
 * could never be satisfied, so no TTS provider could ever pass no matter how
 * much was spent. The gates are dropped rather than faked.
 */
export const TTS_THRESHOLDS: BenchmarkThresholds = (() => {
  const { maxWer: _wer, minEntityAccuracy: _entity, ...rest } = PHASE_5C_THRESHOLDS;
  return rest;
})();

/** The Hinglish sub-gate, applied to the code-mixed subset only. */
export const HINGLISH_MIN_ENTITY_ACCURACY = 0.85;

/**
 * The binding ceiling for a run that measures ONE stage.
 *
 * Derived from the pre-registered total minus the other stages' budgets, so a
 * component gate can never impose a total tighter than `totalTurnP50Ms`.
 * Returns undefined when the budgets needed for the derivation are absent.
 */
export function componentGate(
  stage: BenchmarkStage,
  thresholds: BenchmarkThresholds,
): { readonly p50: number; readonly p95: number; readonly others: number } | undefined {
  const stt = thresholds.sttP50Ms;
  const llm = thresholds.llmFirstTokenP50Ms;
  const tts = thresholds.ttsFirstByteP50Ms;

  let others: number | undefined;
  if (stage === 'stt') others = llm !== undefined && tts !== undefined ? llm + tts : undefined;
  else if (stage === 'tts_first_byte') {
    others = stt !== undefined && llm !== undefined ? stt + llm : undefined;
  }
  if (others === undefined) return undefined;

  const p50 = thresholds.totalTurnP50Ms - others;
  const p95 = thresholds.totalTurnP95Ms - others;
  if (p50 <= 0 || p95 <= 0) return undefined;
  return { p50, p95, others };
}

const STAGE_LABEL: Readonly<Record<string, string>> = {
  stt: 'Speech-to-text post-endpoint residual',
  tts_first_byte: 'TTS time to first byte',
  llm_first_token: 'LLM time to first token',
  total_turn: 'Total turn',
};

export interface VerdictInput {
  readonly stages: { readonly [S in BenchmarkStage]?: LatencyDistribution };
  readonly accuracy?: TranscriptAccuracy;
  /** Accuracy over the code-mixed subset only. */
  readonly hinglishAccuracy?: TranscriptAccuracy;
  readonly sampleCount: number;
  readonly hardFailureCount: number;
  /**
   * Failures caused by OUR adapter, not by the provider.
   *
   * A 4xx from a wrong request shape says nothing about provider quality, so it
   * must not be counted against the provider. It makes the run INCOMPLETE —
   * this run did not measure the provider.
   */
  readonly adapterDefectCount?: number;
  /** Samples that succeeded only after a retry. Reported, never silently free. */
  readonly recoveredCount?: number;
  /**
   * Whether the headline figure is comparable with the gate at all.
   *
   * A TTS adapter that buffers the whole response before yielding does not have
   * a "time to first byte" in the sense the 400 ms component gate means — its
   * first byte IS full synthesis. Applying the same gate would rank a transport
   * choice OUR adapter made as if it were the provider's speed, and would FAIL
   * a provider whose streaming endpoint we chose not to implement.
   *
   * When false the figure is reported and the run is INCOMPLETE for that gate.
   */
  readonly headlineComparable?: boolean;
  /** Why not, in one sentence, for the report. */
  readonly headlineIncomparableReason?: string;
  readonly thresholds: BenchmarkThresholds;
  /**
   * Which distribution the headline gate applies to.
   *
   * `total_turn` for an end-to-end run; `stt` or `tts_first_byte` for the
   * component runs, which have no total by construction and are gated at the
   * derived component ceiling instead.
   */
  readonly headlineStage?: BenchmarkStage;
}

export interface VerdictResult {
  readonly verdict: BenchmarkVerdict;
  readonly failures: readonly string[];
  readonly incompleteReasons: readonly string[];
  readonly warnings: readonly string[];
}

export function evaluate(input: VerdictInput): VerdictResult {
  const {
    stages, accuracy, hinglishAccuracy,
    sampleCount, hardFailureCount, thresholds,
    adapterDefectCount = 0, recoveredCount = 0,
    headlineComparable = true, headlineIncomparableReason,
    headlineStage = 'total_turn',
  } = input;

  const failures: string[] = [];
  const incomplete: string[] = [];
  const warnings: string[] = [];

  if (sampleCount < MIN_SAMPLES_FOR_VERDICT) {
    incomplete.push(
      `Only ${sampleCount} successful samples; ${MIN_SAMPLES_FOR_VERDICT} are needed before a percentile is reported as a result.`,
    );
  }

  // ---- Headline gate -------------------------------------------------------
  const headline = stages[headlineStage];
  const label = STAGE_LABEL[headlineStage] ?? headlineStage;
  if (!headline) {
    incomplete.push(`No samples for ${headlineStage}, so the headline gate could not be applied.`);
  } else if (headlineStage === 'total_turn') {
    if (headline.p50 > thresholds.totalTurnP50Ms) {
      failures.push(
        `Total turn p50 ${Math.round(headline.p50)} ms exceeds the ${thresholds.totalTurnP50Ms} ms gate.`,
      );
    }
    if (headline.p95 > thresholds.totalTurnP95Ms) {
      failures.push(
        `Total turn p95 ${Math.round(headline.p95)} ms exceeds the ${thresholds.totalTurnP95Ms} ms limit.`,
      );
    }
  } else if (!headlineComparable) {
    incomplete.push(
      headlineIncomparableReason ??
        `The ${label} figure is not comparable with the component gate for this adapter, so the ` +
          'gate was not applied. Reporting it as a pass or a fail would rank our transport ' +
          'choice as if it were the provider.',
    );
  } else {
    const gate = componentGate(headlineStage, thresholds);
    if (!gate) {
      incomplete.push(
        `No component gate could be derived for ${headlineStage}, so this run's latency was not gated.`,
      );
    } else {
      if (headline.p50 > gate.p50) {
        failures.push(
          `${label} p50 ${Math.round(headline.p50)} ms exceeds the ${gate.p50} ms component gate ` +
            `(${thresholds.totalTurnP50Ms} ms total minus ${gate.others} ms for the other stages) — ` +
            'this stage alone cannot fit inside the pre-registered turn budget.',
        );
      }
      if (headline.p95 > gate.p95) {
        failures.push(
          `${label} p95 ${Math.round(headline.p95)} ms exceeds the ${gate.p95} ms component limit ` +
            `(${thresholds.totalTurnP95Ms} ms total p95 minus ${gate.others} ms for the other stages).`,
        );
      }
    }
  }

  // ---- Advisory stage budgets ---------------------------------------------
  // Attribution only. The headline stage is deliberately skipped: it is already
  // gated above, and reporting the same figure twice reads as two problems.
  const budget = (stage: BenchmarkStage, limit: number | undefined, name: string) => {
    if (limit === undefined || stage === headlineStage) return;
    const d = stages[stage];
    if (!d) {
      // Only an end-to-end run is expected to carry every stage. A component
      // run legitimately has none of the others, and warning about them is
      // noise that trains the reader to skip warnings.
      if (headlineStage === 'total_turn') {
        warnings.push(`${name} has no samples, so its budget could not be checked.`);
      }
      return;
    }
    if (d.p50 > limit) {
      warnings.push(
        `${name} p50 ${Math.round(d.p50)} ms is over its ${limit} ms budget — this is where the time went.`,
      );
    }
  };
  budget('stt', thresholds.sttP50Ms, 'Speech-to-text');
  budget('llm_first_token', thresholds.llmFirstTokenP50Ms, 'LLM time to first token');
  budget('tts_first_byte', thresholds.ttsFirstByteP50Ms, 'TTS time to first byte');

  // The headline stage still gets its attribution line, as a warning, when it
  // is inside the binding gate but over the budget it was designed to hit.
  if (headline && headlineStage !== 'total_turn') {
    const stageBudget =
      headlineStage === 'stt' ? thresholds.sttP50Ms
      : headlineStage === 'tts_first_byte' ? thresholds.ttsFirstByteP50Ms
      : undefined;
    if (stageBudget !== undefined && headline.p50 > stageBudget) {
      warnings.push(
        `${label} p50 ${Math.round(headline.p50)} ms is over its ${stageBudget} ms design budget, ` +
          'so the rest of the turn has less room than the budget assumed.',
      );
    }
  }

  // ---- Accuracy ------------------------------------------------------------
  if (thresholds.maxWer !== undefined) {
    if (!accuracy) {
      incomplete.push('No transcript accuracy was measured, so the WER gate could not be applied.');
    } else if (accuracy.wer > thresholds.maxWer) {
      failures.push(
        `Word error rate ${(accuracy.wer * 100).toFixed(1)}% exceeds ${(thresholds.maxWer * 100).toFixed(1)}%.`,
      );
    }
  }

  if (thresholds.minEntityAccuracy !== undefined) {
    if (!accuracy || accuracy.entityAccuracy === undefined) {
      incomplete.push(
        'No entity accuracy was measured, so the screening-usability gate could not be applied.',
      );
    } else if (accuracy.entityAccuracy < thresholds.minEntityAccuracy) {
      failures.push(
        `Entity accuracy ${(accuracy.entityAccuracy * 100).toFixed(1)}% is below the required ${(thresholds.minEntityAccuracy * 100).toFixed(1)}% — the facts a screen exists to collect are not surviving transcription.`,
      );
    }
    if (accuracy?.entitiesWrong !== undefined && accuracy.entitiesWrong > 0) {
      warnings.push(
        `${accuracy.entitiesWrong} fact(s) were heard CONFIDENTLY WRONG rather than missed. A wrong notice period rejects a qualified candidate silently.`,
      );
    }

    // ---- Hinglish sub-gate -------------------------------------------------
    // Pooled accuracy can pass at 91% while the code-mixed third sits at 78%.
    // Since code-mixing is the linguistic reality of Indian recruitment calls,
    // pooling alone would hide the strongest reason to run this benchmark.
    //
    // Its ABSENCE is INCOMPLETE, not a warning — consistent with every other
    // missing measurement. A run that never tested code-mixed speech has not
    // earned a PASS on Indian recruitment audio.
    if (hinglishAccuracy?.entityAccuracy === undefined) {
      incomplete.push(
        'No code-mixed (Hinglish) subset was measured, so the sub-gate could not be applied. ' +
          'Code-mixing is the linguistic reality of these calls; a pooled figure can pass while it fails.',
      );
    } else if (hinglishAccuracy.entityAccuracy < HINGLISH_MIN_ENTITY_ACCURACY) {
      failures.push(
        `Hinglish entity accuracy ${(hinglishAccuracy.entityAccuracy * 100).toFixed(1)}% is below the ${(HINGLISH_MIN_ENTITY_ACCURACY * 100).toFixed(0)}% sub-gate, even if pooled accuracy passes.`,
      );
    }
  }

  // ---- Failures ------------------------------------------------------------
  if (adapterDefectCount > 0) {
    incomplete.push(
      `${adapterDefectCount} call(s) failed with a client-side request error (4xx). That is OUR ` +
        'adapter being wrong, not the provider being slow or inaccurate, so it is not counted ' +
        'against the provider — and this run did not measure them.',
    );
  }

  const providerFailures = Math.max(0, hardFailureCount - adapterDefectCount);
  if (thresholds.maxHardFailures !== undefined && providerFailures > thresholds.maxHardFailures) {
    failures.push(
      `${providerFailures} hard failures exceeds the limit of ${thresholds.maxHardFailures}. (A turn counts as failed only after its retries are exhausted.)`,
    );
  }

  if (recoveredCount > 0) {
    warnings.push(
      `${recoveredCount} sample(s) succeeded only after a retry. Their latency is excluded from the ` +
        'distribution, so flakiness does not flatter the figures — but it is real and a candidate ' +
        'on a live call gets no retry.',
    );
  }

  const verdict: BenchmarkVerdict =
    failures.length > 0 ? 'FAIL' : incomplete.length > 0 ? 'INCOMPLETE' : 'PASS';

  return { verdict, failures, incompleteReasons: incomplete, warnings };
}
