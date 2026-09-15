/**
 * Execution planning — what a sweep will do, and what it will cost, BEFORE it
 * spends anything.
 *
 * The project is bootstrapping on a strict budget, and the design review caught
 * a 3×3 cross product that would have blown a provider free tier mid-run. So no
 * sweep executes without first printing exactly how many provider calls it will
 * make, how much audio it will send, and how many characters it will synthesise.
 *
 * `estimate()` makes no network calls at all.
 */

import type { AudioCondition } from '@platform/providers';

/** The approved seven-run design. Not a cross product. */
export type RunKind = 'stt' | 'tts' | 'end_to_end';

export interface PlannedRun {
  readonly runId: string;
  readonly kind: RunKind;
  readonly adapterId: string;
  /**
   * The adapters this run uses, by service.
   *
   * Kept structured rather than reconstructed by splitting `adapterId` on '+',
   * which is how the cost estimator used to derive its rate-card keys — a
   * string-parsing step that would silently mis-key any adapter id containing
   * the separator and price the run against the wrong provider.
   */
  readonly adapters: {
    readonly stt?: string;
    readonly llm?: string;
    readonly tts?: string;
  };
  readonly utteranceCount: number;
  /** Provider calls this run will make, before retries. */
  readonly calls: number;
  /** Audio seconds sent (STT) — the thing most providers meter. */
  readonly audioSeconds: number;
  /**
   * Audio seconds split by corpus language.
   *
   * At least one candidate bills code-mixed audio at a higher multilingual
   * rate. A single scalar priced the whole corpus at the monolingual rate and
   * understated the bill by that difference on a third of the utterances.
   */
  readonly audioSecondsByLanguage: Readonly<Record<string, number>>;
  /** Characters synthesised (TTS) — the thing TTS providers meter. */
  readonly characters: number;
  /**
   * Whether the CLI can actually execute this run today.
   *
   * The end-to-end run is part of the approved design but has no runner yet, so
   * it is shown and EXCLUDED from the totals. Counting a run that cannot happen
   * inflated the plan by 50% on a 30-utterance corpus — and a budget estimate
   * that is wrong in the founder's favour is worse than no estimate.
   */
  readonly executable: boolean;
}

export interface SweepPlan {
  readonly profile: string;
  readonly condition: AudioCondition;
  readonly runs: readonly PlannedRun[];
  readonly totalCalls: number;
  readonly totalAudioSeconds: number;
  readonly totalCharacters: number;
  /** Worst case if every call exhausts its retries. */
  readonly worstCaseCalls: number;
  /**
   * Retries re-send the whole utterance and re-synthesise the whole line, so
   * the metered units multiply too. Reporting calls-with-retries next to
   * audio-seconds-without made the two lines a founder actually prices against
   * the only two that ignored retries.
   */
  readonly worstCaseAudioSeconds: number;
  readonly worstCaseCharacters: number;
  readonly warnings: readonly string[];
}

export interface PlanInput {
  readonly profile: string;
  readonly condition: AudioCondition;
  readonly sttAdapters: readonly string[];
  readonly ttsAdapters: readonly string[];
  /**
   * Leading STT + LLM + leading TTS for the single end-to-end validation run.
   *
   * `llm` is optional because no LLM adapter is registered until the founder
   * confirms which model is held constant. Without it the run is planned but
   * marked NOT YET EXECUTABLE, rather than being quietly counted as spend that
   * will happen.
   */
  readonly endToEnd?: { readonly stt: string; readonly tts: string; readonly llm?: string };
  readonly utterances: readonly { id: string; durationMs: number; language?: string }[];
  readonly ttsLines: readonly { id: string; text: string }[];
  readonly maxRetries: number;
  readonly maxCalls: number;
  /** The verdict rule's sample floor, so a plan that cannot conclude says so. */
  readonly minSamplesForVerdict?: number;
}

export function planSweep(input: PlanInput): SweepPlan {
  const runs: PlannedRun[] = [];
  const warnings: string[] = [];

  const audioSeconds = input.utterances.reduce((n, u) => n + u.durationMs / 1000, 0);
  const audioSecondsByLanguage: Record<string, number> = {};
  for (const utterance of input.utterances) {
    const language = utterance.language ?? 'unknown';
    audioSecondsByLanguage[language] = (audioSecondsByLanguage[language] ?? 0) + utterance.durationMs / 1000;
  }
  const characters = input.ttsLines.reduce((n, l) => n + l.text.length, 0);

  for (const adapterId of input.sttAdapters) {
    runs.push({
      runId: `${input.profile}-stt-${adapterId}`,
      kind: 'stt',
      adapterId,
      adapters: { stt: adapterId },
      utteranceCount: input.utterances.length,
      calls: input.utterances.length,
      audioSeconds,
      audioSecondsByLanguage,
      characters: 0,
      executable: true,
    });
  }

  for (const adapterId of input.ttsAdapters) {
    runs.push({
      runId: `${input.profile}-tts-${adapterId}`,
      kind: 'tts',
      adapterId,
      adapters: { tts: adapterId },
      utteranceCount: input.ttsLines.length,
      calls: input.ttsLines.length,
      audioSeconds: 0,
      audioSecondsByLanguage: {},
      characters,
      executable: true,
    });
  }

  if (input.endToEnd) {
    const llm = input.endToEnd.llm;
    runs.push({
      runId: `${input.profile}-e2e-${input.endToEnd.stt}-${llm ?? '<llm>'}-${input.endToEnd.tts}`,
      kind: 'end_to_end',
      adapterId: `${input.endToEnd.stt}+${llm ?? '<llm>'}+${input.endToEnd.tts}`,
      adapters: {
        stt: input.endToEnd.stt,
        tts: input.endToEnd.tts,
        ...(llm ? { llm } : {}),
      },
      utteranceCount: input.utterances.length,
      // Three provider calls per turn: STT, LLM, TTS.
      calls: input.utterances.length * 3,
      audioSeconds,
      audioSecondsByLanguage,
      // Reply length is bounded by the frozen screening prompt at 25 words;
      // ~140 characters is the ceiling that implies, so this is an upper bound
      // rather than a guess at what the model will actually say.
      characters: input.utterances.length * 140,
      executable: llm !== undefined,
    });
    if (llm === undefined) {
      warnings.push(
        'The end-to-end run is implemented but NO LLM ADAPTER IS REGISTERED, so it is listed ' +
          'and EXCLUDED from the totals below. The design holds the LLM constant and proposes ' +
          'gemini-3.5-flash-lite; until the founder confirms a model, total_turn cannot be ' +
          'measured and only the derived component gates apply.',
      );
    }
  }

  const executable = runs.filter((r) => r.executable);
  const totalCalls = executable.reduce((n, r) => n + r.calls, 0);
  const totalAudioSeconds = executable.reduce((n, r) => n + r.audioSeconds, 0);
  const totalCharacters = executable.reduce((n, r) => n + r.characters, 0);
  const retryFactor = 1 + input.maxRetries;
  const worstCaseCalls = totalCalls * retryFactor;

  if (runs.length > 7) {
    warnings.push(
      `Plan has ${runs.length} runs. The approved design is 7 (3 STT + 3 TTS + 1 end-to-end); ` +
        'anything more is duplicated measurement that cannot change the verdict.',
    );
  }
  if (totalCalls > input.maxCalls) {
    warnings.push(
      `Plan makes ${totalCalls} calls, above the --max-calls ceiling of ${input.maxCalls}. ` +
        'Raise the ceiling deliberately or reduce the corpus.',
    );
  }
  if (input.sttAdapters.length * input.ttsAdapters.length > 1 && input.endToEnd === undefined) {
    warnings.push('No end-to-end run planned, so total_turn cannot be measured and the headline gate cannot be applied.');
  }
  const floor = input.minSamplesForVerdict;
  if (floor !== undefined && input.ttsAdapters.length > 0 && input.ttsLines.length < floor) {
    warnings.push(
      `Only ${input.ttsLines.length} TTS lines, but the decision rule needs ${floor} successful ` +
        'samples before a percentile counts as a result. Every TTS run would be INCOMPLETE no ' +
        'matter how much was spent — add lines or do not run TTS.',
    );
  }
  if (floor !== undefined && input.sttAdapters.length > 0 && input.utterances.length < floor) {
    warnings.push(
      `Only ${input.utterances.length} utterances, but the decision rule needs ${floor} successful ` +
        'samples. Every STT run would be INCOMPLETE — record more corpus before spending.',
    );
  }

  return {
    profile: input.profile,
    condition: input.condition,
    runs,
    totalCalls,
    totalAudioSeconds,
    totalCharacters,
    worstCaseCalls,
    worstCaseAudioSeconds: totalAudioSeconds * retryFactor,
    worstCaseCharacters: totalCharacters * retryFactor,
    warnings,
  };
}

/** Human-readable plan, printed before anything is spent. */
export function renderPlan(plan: SweepPlan): string {
  const lines = [
    `Profile:   ${plan.profile}`,
    `Condition: ${plan.condition}`,
    '',
    'Runs:',
  ];
  for (const run of plan.runs) {
    const meter =
      run.kind === 'tts'
        ? `${run.characters.toLocaleString()} chars`
        : `${run.audioSeconds.toFixed(0)} s audio`;
    const note = run.executable ? '' : '   [NOT YET EXECUTABLE — excluded from totals]';
    lines.push(
      `  ${run.runId.padEnd(38)} ${String(run.calls).padStart(5)} calls   ${meter}${note}`,
    );
  }
  lines.push(
    '',
    `TOTAL: ${plan.totalCalls} provider calls ` +
      `(worst case with retries: ${plan.worstCaseCalls})`,
    `       ${plan.totalAudioSeconds.toFixed(0)} s of audio to STT ` +
      `(worst case: ${plan.worstCaseAudioSeconds.toFixed(0)} s)`,
    `       ${plan.totalCharacters.toLocaleString()} characters to TTS ` +
      `(worst case: ${plan.worstCaseCharacters.toLocaleString()})`,
    '',
    'Retries re-send the whole utterance and re-synthesise the whole line, so the worst',
    'case multiplies the metered units too — not just the call count.',
  );
  const notYet = plan.runs.filter((r) => !r.executable);
  if (notYet.length > 0) {
    lines.push(
      '',
      `Excluded from the totals (${notYet.length} run(s) cannot execute yet): ` +
        notYet.map((r) => r.runId).join(', '),
    );
  }
  if (plan.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of plan.warnings) lines.push(`  ! ${warning}`);
  }
  return lines.join('\n');
}
