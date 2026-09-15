/**
 * Gemini benchmark LLM adapter — the constant held across every end-to-end run.
 *
 * ⚠ UNVERIFIED AGAINST A LIVE SERVICE. Every field below was checked against
 * Google's own documentation on 2026-08-24, and that check corrected four
 * assumptions that would each have failed on first contact.
 *
 * WHAT THE DOCUMENTATION CHECK CHANGED:
 *
 *  * **Role names are `user` and `model`.** `assistant` appears nowhere in
 *    Google's documentation — it is an OpenAI convention. Our own message type
 *    uses `assistant`, so the mapping happens here rather than being assumed.
 *  * **The system instruction is a Content object**, not a string, and REST
 *    examples spell it `system_instruction`.
 *  * **Auth is the `x-goog-api-key` header.** The `?key=` query form still
 *    appears in one older sample but is not what current documentation shows,
 *    and a key in a URL ends up in logs.
 *  * **A response can contain ZERO candidates.** `promptFeedback.blockReason`
 *    is documented as "the prompt was blocked and no candidates are returned",
 *    so `candidates[0]` must never be indexed blindly. With real speech
 *    transcripts this will fire eventually.
 *
 * WHAT IS NOT DOCUMENTED, and is therefore handled defensively rather than
 * assumed:
 *
 *  * **How the SSE stream terminates.** No `[DONE]` sentinel is shown and
 *    termination is simply not described, so the reader treats connection close
 *    as the end and nothing depends on a sentinel.
 *  * **Whether a chunk may carry no text part.** Not confirmed or denied. Every
 *    hop is optional-chained.
 *  * **Whether the legacy endpoint honours a retention setting.** Retention
 *    control is documented for a different, newer API surface. Sending an
 *    undocumented field to this one could be a 400, so nothing extra is sent —
 *    and the gap is recorded rather than papered over.
 *
 * ⚠ **THIS ENDPOINT IS MARKED "LEGACY".** Google recommends a newer
 * Interactions API for new development, while stating `generateContent` remains
 * fully supported with no shutdown date. It is used here deliberately: it is the
 * surface whose streaming shape is documented well enough to implement without
 * guessing, and the benchmark needs one plain sentence, not the newer API's
 * feature set.
 *
 * ⚠ **DATA RESIDENCY: NONE.** Google documents no processing location and no
 * India region for this API, and its terms say data "may be stored transiently
 * or cached in any country in which Google or its agents maintain facilities."
 * Recorded as unverified, and the consent form must say so in those words.
 */

import type {
  AdapterIdentity, BenchmarkLlmAdapter, LlmMessage,
} from '../types.js';
import { requireEnv } from '../types.js';
import { HttpError, redact } from '../http.js';
import { ProviderRefusedError, ResponseShapeError } from '../../measure/failures.js';

const ADAPTER_VERSION = 'gemini-0.1.0-docverified-unrun';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Cheapest flash-lite that still accepts new API keys (2026-09-15 live check). */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Generous, deliberately.
 *
 * The frozen screening prompt asks for at most 25 words — about 35 tokens — so
 * 120 looked like ample headroom. It is not necessarily: for this model family
 * Google counts THINKING tokens against the same budget, and a completion that
 * spends its allowance reasoning returns `finishReason: MAX_TOKENS` with little
 * or no text. That would look exactly like a slow, unhelpful provider.
 *
 * 512 costs nothing at this volume (the whole benchmark's LLM bill is around
 * ₹0.42) and removes the failure mode. The reply is bounded by the prompt, not
 * by this number.
 */
const MAX_OUTPUT_TOKENS = 512;

interface GeminiPart { readonly text?: string }
interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly GeminiPart[]; readonly role?: string };
  readonly finishReason?: string;
}
interface GeminiChunk {
  readonly candidates?: readonly GeminiCandidate[];
  readonly promptFeedback?: { readonly blockReason?: string };
}

/** Our roles are system/user/assistant; Gemini's are user/model plus a separate field. */
export function toGeminiContents(messages: readonly LlmMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
} {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    }));
  return {
    ...(system.trim() ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
  };
}

export function identity(): AdapterIdentity {
  return {
    id: 'gemini',
    displayName: 'Google Gemini (Developer API, legacy generateContent)',
    adapterVersion: ADAPTER_VERSION,
    model: process.env['GEMINI_MODEL'] ?? DEFAULT_MODEL,
    unverified: true,
    parameters: {
      endpoint: 'streamGenerateContent?alt=sse',
      maxOutputTokens: String(MAX_OUTPUT_TOKENS),
      // Recorded exactly as the documentation leaves it. The speech adapters
      // carry the same field, and the LLM is no less a processor of candidate
      // speech than they are.
      dataResidency: 'NOT DOCUMENTED — no India region; may be processed in any country',
      apiSurface: 'legacy generateContent (Google recommends a newer API for new development)',
      freeTierDataUse:
        'UNPAID TIER TRAINS GOOGLE PRODUCTS AND MAY BE READ BY HUMAN REVIEWERS — use a paid key',
    },
  };
}

export function createGeminiLlm(): BenchmarkLlmAdapter {
  const model = process.env['GEMINI_MODEL'] ?? DEFAULT_MODEL;
  return {
    identity: identity(),
    streaming: true,
    async *complete(request) {
      const [apiKey] = requireEnv('gemini', 'GEMINI_API_KEY');
      const body = {
        ...toGeminiContents(request.messages),
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0 },
      };

      const response = await fetch(
        `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey as string,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          ...(request.signal ? { signal: request.signal } : {}),
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new HttpError(response.status, response.statusText, text);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new ResponseShapeError('Gemini', 'a readable SSE body');

      const decoder = new TextDecoder();
      let buffer = '';
      let sawCandidate = false;
      let blockReason: string | undefined;

      const frames = function* (text: string, flush: boolean): Generator<string> {
        buffer += text;
        for (;;) {
          const split = buffer.indexOf('\n\n');
          if (split === -1) break;
          yield buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
        }
        // A final frame need not be followed by a blank line, and the stream
        // simply closing is how this API is documented to end — which is to say
        // it is not documented at all. Dropping the tail would silently lose
        // the last of the reply.
        if (flush && buffer.trim() !== '') {
          yield buffer;
          buffer = '';
        }
      };

      const handle = (frame: string): string => {
        const payload = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          // One space after the colon is the separator; further leading space
          // is DATA. Trimming both ends would eat a legitimate leading space in
          // the model's text.
          .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
          .join('\n');
        if (payload.trim() === '' || payload.trim() === '[DONE]') return '';

        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(payload) as GeminiChunk;
        } catch {
          throw new ResponseShapeError(
            'Gemini', 'a JSON payload on each SSE data line',
            redact(payload).slice(0, 200),
          );
        }

        blockReason ??= chunk.promptFeedback?.blockReason;
        const candidate = chunk.candidates?.[0];
        if (candidate) sawCandidate = true;
        // Every hop optional: a chunk carrying no text part is not documented
        // as impossible.
        return candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          // NORMALISE LINE ENDINGS. The SSE specification permits LF, CR or
          // CRLF, and splitting on a hard-coded "\n\n" dispatches NO frame at
          // all on a CRLF stream — the whole response would accumulate, be
          // discarded, and report as an adapter defect that costs the entire
          // end-to-end sweep. Google's own client for this endpoint accepts all
          // three, which is the strongest available signal about what the
          // server emits, and this adapter has never met it.
          const text = done ? '' : decoder.decode(value, { stream: true }).replace(/\r\n|\r/g, '\n');
          for (const frame of frames(text, done)) {
            const emitted = handle(frame);
            if (emitted !== '') yield { text: emitted };
          }
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => { /* already closed */ });
      }

      if (!sawCandidate) {
        if (blockReason) {
          // A documented PROVIDER outcome, not our defect: "if set, the prompt
          // was blocked and no candidates are returned". Filing it as an
          // adapter defect would excuse the provider from a refusal it made,
          // and with real speech transcripts this will fire eventually.
          throw new ProviderRefusedError('Gemini', blockReason);
        }
        throw new ResponseShapeError(
          'Gemini', 'at least one candidate',
          'no candidates and no blockReason were returned',
        );
      }
    },
  };
}
