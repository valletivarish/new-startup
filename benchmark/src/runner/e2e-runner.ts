/**
 * The end-to-end runner — the only run that measures the gate.
 *
 * WHY THIS EXISTS, stated plainly because it was the largest gap in Phase 5C:
 * the pre-registered rule gates on `total_turn` p50 ≤ 1200 ms and p95 ≤ 2000 ms.
 * **Percentiles do not sum.** A p95 total is not the sum of per-stage p95s, so
 * no arithmetic over the six component runs can produce the figure the rule is
 * written against. The derived component gates added in Phase 5C are NECESSARY
 * conditions — a stage that alone cannot fit inside 1200 ms disqualifies the
 * stack — but they are not SUFFICIENT, and treating them as sufficient would
 * mean the headline threshold was never tested at all.
 *
 * WHAT IS MEASURED, and what is deliberately not:
 *
 *   speech_ended  →  stt_final  →  llm_first_token  →  tts_first_byte
 *
 * `total_turn` is end-of-speech to FIRST RETURNED AUDIO BYTE, which is exactly
 * how `06_PROVIDER_AND_COST_SPEC` §14 words the budget. The carrier leg is NOT
 * included and cannot be: there is no phone call here. `audio_out` is left
 * unset rather than stamped 0, and the report says so.
 *
 * `endpointing` is NOT reported. Recorded utterances have pre-cut boundaries,
 * so any figure would be the utterance length printed as if it were a VAD
 * decision. `speechStartedAt` is therefore deliberately never set.
 *
 * THE PIPELINE IS STREAMING, not serial. Synthesis starts at the first sentence
 * boundary rather than after the whole completion. Awaiting the full reply
 * charged `total_turn` for however long the model kept talking — inflating the
 * ONE gated figure by a few hundred milliseconds of generation the product
 * would never wait through. The design's own chain is
 * `llm_first_token → tts_first_byte`, which is a streaming pipeline; measuring
 * a serial one and comparing it against a 1200 ms gate would have failed stacks
 * for a shortcut in the harness.
 *
 * THE TRANSCRIPT IS THE INPUT TO THE LLM, not the reference. An end-to-end run
 * exists to feel the downstream consequences of transcription errors; feeding
 * the ground truth would measure a pipeline that does not exist and would make
 * every STT look identical from the LLM onward.
 */

import type { TranscriptAccuracy } from '@platform/providers';

import type {
  BenchmarkLlmAdapter,
  BenchmarkSttAdapter,
  BenchmarkTtsAdapter,
} from '../adapters/types.js';
import type { EntityExpectationInput } from '../corpus/manifest.js';
import type { CorpusLanguageTag } from '../adapters/types.js';
import {
  createTurnRecorder,
  stageDurations,
  systemClock,
  type Clock,
} from '../measure/latency.js';
import type { BenchmarkStage, StageDurations, TurnTimeline } from '@platform/providers';
import type { EntityResult, NormalisationOptions } from '../measure/accuracy.js';
import type { FailureCategory } from '../measure/failures.js';
import { runSttCase } from './stt-runner.js';
import { runTtsCase } from './tts-runner.js';
import { runLlmTurn } from './llm-runner.js';
import { screeningMessages } from './screen.js';
import { realSleep, type Sleep } from './pacing.js';

export interface E2eTurnCase {
  readonly utteranceId: string;
  readonly conversationId: string;
  readonly turnIndex: number;
  readonly samples: Int16Array;
  readonly sampleRate: 8000 | 16000;
  readonly language: CorpusLanguageTag;
  readonly reference: string;
  readonly entities: readonly EntityExpectationInput[];
  readonly codeMixed: boolean;
}

export interface E2eTurnResult {
  readonly utteranceId: string;
  readonly conversationId: string;
  readonly timeline: TurnTimeline;
  readonly durations: StageDurations;
  readonly transcript: string;
  readonly reply: string;
  readonly accuracy?: TranscriptAccuracy & { entityResults?: readonly EntityResult[] };
  readonly codeMixed: boolean;
  /** Attempts per stage, so a flaky layer is attributable. */
  readonly attempts: { readonly stt: number; readonly llm: number; readonly tts: number };
  readonly recovered: boolean;
  readonly failure?: {
    readonly stage: BenchmarkStage;
    readonly category: FailureCategory;
    readonly message: string;
  };
  /**
   * Characters actually SENT to TTS — the unit a TTS provider meters.
   *
   * Not the reply's length: a streaming pipeline synthesises the first sentence
   * first, and only what was sent was billed. Reporting the whole reply
   * overstated the TTS spend of every end-to-end run.
   */
  readonly replyCharacters: number;
  /** The whole reply, for the record, even though only part was synthesised. */
  readonly replyLength: number;
}

export interface E2eRunOptions {
  readonly stt: BenchmarkSttAdapter;
  readonly llm: BenchmarkLlmAdapter;
  readonly tts: BenchmarkTtsAdapter;
  readonly maxRetries: number;
  readonly normalisation?: NormalisationOptions;
  readonly clock?: Clock;
  readonly sleep?: Sleep;
  readonly retrySleep?: Sleep;
  /**
   * Provider calls still permitted. Consulted BEFORE each turn.
   *
   * A conversation is several turns and each turn is three calls, so a ceiling
   * checked only between conversations is not a ceiling.
   */
  readonly callBudget?: () => number;
  /** Called after each turn with the calls it actually spent. */
  readonly onTurnComplete?: (spent: number) => void;
}

/**
 * One conversation, turn by turn, carrying history.
 *
 * A failed turn does NOT abandon the rest of the conversation. Abandoning would
 * give a provider that failed early a shorter conversation than its peers, and
 * the comparison would then be across different inputs. The turn is recorded as
 * failed, excluded from latency, counted against the failure gate, and the
 * conversation continues with whatever transcript was produced — which is also
 * what would happen on a real call.
 */
export async function runE2eConversation(
  turns: readonly E2eTurnCase[],
  options: E2eRunOptions,
): Promise<E2eTurnResult[]> {
  const {
    stt, llm, tts, maxRetries,
    clock = systemClock, sleep = realSleep, retrySleep = realSleep,
  } = options;

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  const results: E2eTurnResult[] = [];

  for (const turn of turns) {
    // Three calls per turn before retries. Stop before starting one we cannot
    // afford, rather than after having paid for it.
    const remaining = options.callBudget?.() ?? Infinity;
    if (remaining < 3 * (1 + maxRetries)) break;

    const recorder = createTurnRecorder(turn.turnIndex, clock);

    const sttResult = await runSttCase(
      {
        utteranceId: turn.utteranceId,
        samples: turn.samples,
        sampleRate: turn.sampleRate,
        language: turn.language,
        reference: turn.reference,
        entities: turn.entities,
        codeMixed: turn.codeMixed,
      },
      {
        adapter: stt, maxRetries,
        clock, sleep, retrySleep,
        ...(options.normalisation ? { normalisation: options.normalisation } : {}),
      },
    );

    // The endpoint. Absolute reading from the SHARED clock, which is what makes
    // marks recorded inside the three sub-runners comparable on one timeline.
    const endpoint = sttResult.timeline.audioEndedAt;
    if (endpoint === undefined) {
      // Without an endpoint there is no origin to measure from, and a turn
      // timeline that invents one is worse than a missing turn.
      results.push(failedTurn(turn, sttResult.transcript, 'stt', {
        category: 'audio_not_consumed',
        message: 'No endpoint mark was produced, so no turn latency could be measured.',
      }, { stt: sttResult.attempts, llm: 0, tts: 0 }, clock, turn.turnIndex));
      history.push({ role: 'user', content: sttResult.transcript });
      continue;
    }
    recorder.at('speechEndedAt', endpoint);

    const lastFinal = sttResult.timeline.finalAts.at(-1);
    if (lastFinal !== undefined) recorder.at('sttFinalAt', lastFinal);

    if (sttResult.failure) {
      recorder.fail('stt', sttResult.failure.message);
      results.push(finishTurn(turn, recorder, sttResult.transcript, '', sttResult.accuracy,
        { stt: sttResult.attempts, llm: 0, tts: 0 }, false, '',
        { stage: 'stt', ...sttResult.failure }));
      options.onTurnComplete?.(sttResult.attempts);
      history.push({ role: 'user', content: sttResult.transcript });
      continue;
    }

    // Synthesis STARTS at the first sentence, concurrently, while the model is
    // still generating. Capturing the sentence but still awaiting the whole
    // completion before calling TTS would have measured a serial pipeline while
    // claiming to measure a streaming one — the bug this comment replaced.
    let speakable: string | undefined;
    let synthesis: Promise<Awaited<ReturnType<typeof runTtsCase>>> | undefined;
    const startSynthesis = (text: string) => {
      // Once per TURN, not once per LLM attempt: a retried completion must not
      // start a second billed synthesis.
      if (synthesis) return;
      speakable = text;
      synthesis = runTtsCase(
        { lineId: turn.utteranceId, text, language: turn.language, codeMixed: turn.codeMixed },
        { adapter: tts, maxRetries, drain: false, clock, retrySleep },
      );
    };

    let llmResult;
    try {
      llmResult = await runLlmTurn(
        screeningMessages(history, sttResult.transcript),
        { adapter: llm, maxRetries, clock, retrySleep, onSpeakable: startSynthesis },
      );
    } catch (error) {
      // An in-flight synthesis must be settled before the error propagates, or
      // it becomes an unhandled rejection that kills the process mid-sweep.
      await synthesis?.catch(() => undefined);
      throw error;
    }
    if (llmResult.firstTokenAt !== undefined) recorder.at('llmFirstTokenAt', llmResult.firstTokenAt);
    if (llmResult.completeAt !== undefined) recorder.at('llmCompleteAt', llmResult.completeAt);

    if (llmResult.failure) {
      await synthesis?.catch(() => undefined);
      recorder.fail('llm_first_token', llmResult.failure.message);
      results.push(finishTurn(turn, recorder, sttResult.transcript, '', sttResult.accuracy,
        { stt: sttResult.attempts, llm: llmResult.attempts, tts: 0 },
        sttResult.recovered || llmResult.recovered, '',
        { stage: 'llm_first_token', ...llmResult.failure }));
      options.onTurnComplete?.(sttResult.attempts + llmResult.attempts);
      history.push({ role: 'user', content: sttResult.transcript });
      continue;
    }

    // Already running in almost every case; the fallback covers a reply with no
    // sentence-ending punctuation at all.
    if (!synthesis) startSynthesis(llmResult.text);
    const ttsResult = await (synthesis as Promise<Awaited<ReturnType<typeof runTtsCase>>>);
    if (ttsResult.timeline.firstByteAt !== undefined) {
      recorder.at('ttsFirstByteAt', ttsResult.timeline.firstByteAt);
    }

    const attempts = {
      stt: sttResult.attempts, llm: llmResult.attempts, tts: ttsResult.attempts,
    };
    const recovered = sttResult.recovered || llmResult.recovered || ttsResult.recovered;

    if (ttsResult.failure) {
      recorder.fail('tts_first_byte', ttsResult.failure.message);
      results.push(finishTurn(turn, recorder, sttResult.transcript, llmResult.text,
        sttResult.accuracy, attempts, recovered, speakable ?? llmResult.text,
        { stage: 'tts_first_byte', ...ttsResult.failure }));
    } else {
      results.push(finishTurn(turn, recorder, sttResult.transcript, llmResult.text,
        sttResult.accuracy, attempts, recovered, speakable ?? llmResult.text));
    }
    options.onTurnComplete?.(attempts.stt + attempts.llm + attempts.tts);

    // History carries the LLM's reply even when SYNTHESIS failed: the model
    // produced it, and dropping it would give a provider whose TTS failed a
    // different conversation from here on — so the remaining turns would no
    // longer be comparable with any other provider's.
    history.push({ role: 'user', content: sttResult.transcript });
    history.push({ role: 'assistant', content: llmResult.text });
  }

  return results;
}

function finishTurn(
  turn: E2eTurnCase,
  recorder: ReturnType<typeof createTurnRecorder>,
  transcript: string,
  reply: string,
  accuracy: E2eTurnResult['accuracy'],
  attempts: E2eTurnResult['attempts'],
  recovered: boolean,
  synthesised: string,
  failure?: E2eTurnResult['failure'],
): E2eTurnResult {
  const timeline = recorder.timeline();
  return {
    utteranceId: turn.utteranceId,
    conversationId: turn.conversationId,
    timeline,
    durations: stageDurations(timeline),
    transcript,
    reply,
    ...(accuracy ? { accuracy } : {}),
    codeMixed: turn.codeMixed,
    attempts,
    recovered,
    ...(failure ? { failure } : {}),
    replyCharacters: synthesised.length,
    replyLength: reply.length,
  };
}

function failedTurn(
  turn: E2eTurnCase,
  transcript: string,
  stage: BenchmarkStage,
  failure: { category: FailureCategory; message: string },
  attempts: E2eTurnResult['attempts'],
  clock: Clock,
  turnIndex: number,
): E2eTurnResult {
  const recorder = createTurnRecorder(turnIndex, clock);
  recorder.at('speechEndedAt', clock());
  recorder.fail(stage, failure.message);
  const timeline = recorder.timeline();
  return {
    utteranceId: turn.utteranceId,
    conversationId: turn.conversationId,
    timeline,
    durations: {},
    transcript,
    reply: '',
    codeMixed: turn.codeMixed,
    attempts,
    recovered: false,
    failure: { stage, ...failure },
    replyCharacters: 0,
    replyLength: 0,
  };
}
