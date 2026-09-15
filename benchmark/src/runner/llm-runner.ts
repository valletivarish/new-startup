/**
 * LLM benchmark runner — one completion, measured.
 *
 * Two marks matter and they are genuinely different:
 *
 *   llm_first_token   when the first NON-EMPTY chunk arrives. This is what the
 *                     turn budget spends, because synthesis can begin here.
 *   llm_complete      when the stream ends. Only this bounds a NON-streaming
 *                     pipeline, where TTS cannot start until the text is whole.
 *
 * An empty opening chunk is not a token. Real streaming APIs commonly send a
 * role or metadata frame first, and counting it would credit every provider
 * with a token it had not produced.
 */

import type { BenchmarkLlmAdapter, LlmMessage } from '../adapters/types.js';
import { systemClock, type Clock } from '../measure/latency.js';
import { withRetries, type FailureCategory } from '../measure/failures.js';
import { realSleep, type Sleep } from './pacing.js';

/**
 * Where the first speakable sentence ends, or undefined if none has yet.
 *
 * Deliberately conservative: a decimal point or an abbreviation must not be
 * mistaken for a sentence end, because synthesising half a number is worse than
 * waiting. Requires terminal punctuation followed by whitespace or end of text,
 * and not preceded by a digit.
 */
export function firstSentenceEnd(text: string): number | undefined {
  const match = /(?<![0-9])[.!?।](\s|$)/u.exec(text);
  if (!match) return undefined;
  return match.index + 1;
}

/** No single completion may hold the sweep open forever. */
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

export interface LlmTurnResult {
  readonly text: string;
  /** Absolute clock reading, comparable with the STT and TTS marks. */
  readonly firstTokenAt?: number;
  readonly completeAt?: number;
  readonly attempts: number;
  readonly recovered: boolean;
  readonly retries: number;
  readonly failure?: { category: FailureCategory; message: string };
}

export interface LlmRunOptions {
  readonly adapter: BenchmarkLlmAdapter;
  /**
   * Called as soon as enough text exists to start synthesising.
   *
   * THIS IS WHAT MAKES `total_turn` MEAN ANYTHING. Awaiting the whole
   * completion before calling TTS measures a SERIAL pipeline, and
   * `stageDurations` then charges the turn for the LLM's entire generation —
   * inflating the one gated figure by however long the model kept talking. The
   * design's own latency chain is `llm_first_token → tts_first_byte`, i.e. a
   * streaming pipeline, which is also what every real voice agent does.
   *
   * The callback fires once, at the first sentence boundary, which is the
   * smallest unit worth speaking.
   */
  readonly onSpeakable?: (text: string) => void;
  readonly maxRetries: number;
  readonly clock?: Clock;
  readonly retrySleep?: Sleep;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export async function runLlmTurn(
  messages: readonly LlmMessage[],
  options: LlmRunOptions,
): Promise<LlmTurnResult> {
  const {
    adapter, maxRetries,
    clock = systemClock, retrySleep = realSleep,
    timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
  } = options;

  let firstTokenAt: number | undefined;
  let completeAt: number | undefined;
  let text = '';
  let retries = 0;

  const attempt = async (): Promise<void> => {
    // Reset per attempt: a retry's marks must replace the failed attempt's, not
    // be merged with them.
    firstTokenAt = undefined;
    completeAt = undefined;
    text = '';

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);

    let announced = false;
    try {
      for await (const chunk of adapter.complete({ messages, signal: controller.signal })) {
        // Whitespace is not a token. Real streams routinely open with a lone
        // space or newline delta, and an identity check on '' let it stamp the
        // first-token mark — crediting the provider with a token it had not
        // produced, on the stage the turn budget is most sensitive to.
        if (chunk.text.trim() === '') { text += chunk.text; continue; }
        firstTokenAt ??= clock();
        text += chunk.text;

        if (!announced && options.onSpeakable) {
          const boundary = firstSentenceEnd(text);
          if (boundary !== undefined) {
            announced = true;
            options.onSpeakable(text.slice(0, boundary).trim());
          }
        }
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      controller.abort();
    }

    if (text.trim() === '') throw new Error('LLM produced an empty response');
    // A reply with no sentence-ending punctuation is still speakable once it is
    // complete; without this a terse answer would never trigger synthesis.
    if (!announced && options.onSpeakable) {
      announced = true;
      options.onSpeakable(text.trim());
    }
    completeAt = clock();
  };

  const outcome = await withRetries(attempt, {
    maxRetries,
    provider: adapter.identity.id,
    onRetry: () => { retries += 1; },
    sleep: retrySleep,
  });

  const base = { text, attempts: outcome.attempts, recovered: outcome.recovered, retries };
  if (outcome.failure) {
    return { ...base, text: '', recovered: false, failure: outcome.failure };
  }
  return {
    ...base,
    ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
    ...(completeAt !== undefined ? { completeAt } : {}),
  };
}

export { type FailureCategory };
