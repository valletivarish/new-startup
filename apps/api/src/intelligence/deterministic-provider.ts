/**
 * Deterministic IntelligenceProvider.
 *
 * NOT a model, and not pretending to be one. No production provider is
 * selected (ADR-006 condition), and installing one now would embed a vendor
 * choice the architecture exists to defer.
 *
 * What it IS: a real implementation of the real interface whose behaviour is
 * driven by explicit scenarios, so every path the runtime must survive —
 * tool requests, malformed structured output, refusals, timeouts, provider
 * failures, empty responses — is reachable and asserted EXACTLY, with no
 * paid API call and no flakiness.
 *
 * Scenarios are selected by markers in the last user message. That keeps the
 * fake honest: it reacts to its input like a model would, rather than being
 * puppeted by out-of-band test state.
 */

import { randomUUID } from 'node:crypto';
import {
  LLMProviderError,
  type IntelligenceProvider,
  type LLMToolCall,
  type NormalizedLLMRequest,
  type NormalizedLLMResponse,
} from '@platform/providers';

/** Markers a test (or the live demo) can place in a user message. */
export const SCENARIO_MARKERS = {
  toolCall: '[[tool:',
  malformedStructured: '[[malformed]]',
  refusal: '[[refuse]]',
  providerError: '[[fail]]',
  timeout: '[[timeout]]',
  empty: '[[empty]]',
  /** Requests a tool repeatedly, to exercise the iteration bound. */
  loop: '[[loop]]',
  /** Requests more tools in ONE response than the per-turn budget allows. */
  multiTool: '[[multitool]]',
  /** Emits a structurally invalid tool call. */
  badCall: '[[badcall]]',
} as const;

const MODEL_BY_TIER: Record<NormalizedLLMRequest['intelligenceTier'], string> = {
  standard: 'deterministic-small',
  advanced: 'deterministic-medium',
  premium: 'deterministic-large',
};

/** Crude but stable token estimate, so usage metadata is populated. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Strips the context builder's fence markers.
 *
 * A real model reads the CONTENT inside the fence and answers about it; it
 * does not quote the markers back. Doing the same here keeps this fake's
 * output shaped like a real one, so tests assert against realistic text.
 */
function unfence(content: string): string {
  return content
    .replace(/^<<<UNTRUSTED_DATA[^\n]*\n?/gm, '')
    .replace(/END_UNTRUSTED_DATA>>>/g, '')
    .trim();
}

function lastUserText(request: NormalizedLLMRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const m = request.messages[i];
    if (m?.role === 'user') return unfence(m.content);
  }
  return '';
}

/** Did a tool already run this turn? Used by the loop scenario. */
function toolResultCount(request: NormalizedLLMRequest): number {
  return request.messages.filter((m) => m.role === 'tool').length;
}

/**
 * Text that reached the model from UNTRUSTED sources — retrieved documents
 * and tool output.
 *
 * This fake deliberately obeys scenario markers found in that text. That is
 * not a bug and it is not laziness: an injection test in which the model
 * dutifully ignores the injected instruction proves nothing about the
 * platform. Assuming the model is FULLY subverted is the only way to test
 * that authorization, which lives outside the model, still refuses.
 */
/**
 * Finds the `]]` that closes a marker, ignoring any that sit inside the JSON
 * argument object.
 *
 * Needed because the interesting adversarial case is precisely a marker
 * nested inside another one's arguments — an attacker's instruction carried
 * as data through a tool call. A naive scan for the first `]]` would split
 * that payload in half and the attack would never reach the layer being
 * tested.
 */
function findSpecEnd(rest: string): number {
  let depth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const char = rest[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === ']' && rest[i + 1] === ']' && depth === 0) return i;
  }
  return -1;
}

function injectedText(request: NormalizedLLMRequest): string {
  return request.messages
    .filter((m) => m.trust === 'knowledge' || m.trust === 'tool')
    .map((m) => unfence(m.content))
    .join('\n');
}

export function createDeterministicIntelligenceProvider(): IntelligenceProvider {
  function modelFor(tier: NormalizedLLMRequest['intelligenceTier']): string {
    return MODEL_BY_TIER[tier];
  }

  async function complete(
    request: NormalizedLLMRequest,
  ): Promise<NormalizedLLMResponse> {
    const startedAt = Date.now();
    const text = lastUserText(request);
    const model = modelFor(request.intelligenceTier);

    const usage = (content: string) => ({
      inputTokens: estimateTokens(
        request.messages.map((m) => m.content).join(' '),
      ),
      outputTokens: estimateTokens(content),
      totalTokens:
        estimateTokens(request.messages.map((m) => m.content).join(' ')) +
        estimateTokens(content),
      model,
      provider: 'deterministic',
      latencyMs: Math.max(1, Date.now() - startedAt),
      requestId: randomUUID(),
    });

    // ---- Failure scenarios ------------------------------------------------

    if (text.includes(SCENARIO_MARKERS.timeout)) {
      throw new LLMProviderError({
        kind: 'timeout',
        message: 'The model did not respond in time',
        retryable: true,
      });
    }

    if (text.includes(SCENARIO_MARKERS.providerError)) {
      throw new LLMProviderError({
        kind: 'unavailable',
        message: 'The model provider is unavailable',
        retryable: true,
      });
    }

    if (text.includes(SCENARIO_MARKERS.refusal)) {
      return {
        content: '',
        toolCalls: [],
        finishReason: 'content_filter',
        usage: usage(''),
        refusal: 'The model declined to answer this request.',
      };
    }

    if (text.includes(SCENARIO_MARKERS.empty)) {
      return {
        content: '',
        toolCalls: [],
        finishReason: 'stop',
        usage: usage(''),
      };
    }

    // ---- Structured output ------------------------------------------------

    if (request.responseSchema) {
      if (text.includes(SCENARIO_MARKERS.malformedStructured)) {
        // Shape that will FAIL schema validation — the point is to prove the
        // runtime rejects it rather than acting on it.
        return {
          content: '{"unexpected": true}',
          toolCalls: [],
          finishReason: 'stop',
          usage: usage('{"unexpected": true}'),
          structured: { unexpected: true },
        };
      }
      const structured = { answer: text.slice(0, 200), confidence: 'medium' };
      const content = JSON.stringify(structured);
      return {
        content,
        toolCalls: [],
        finishReason: 'stop',
        usage: usage(content),
        structured,
      };
    }

    // ---- Tool requests ----------------------------------------------------

    // `[[loop]]` keeps asking for a tool no matter how many results it has
    // already seen. A model that never stops is exactly what the iteration
    // bound exists for.
    if (text.includes(SCENARIO_MARKERS.loop)) {
      const call: LLMToolCall = {
        callId: `loop-${toolResultCount(request)}-${randomUUID().slice(0, 8)}`,
        name: 'test_echo',
        input: { value: 'again' },
      };
      return {
        content: '',
        toolCalls: [call],
        finishReason: 'tool_calls',
        usage: usage(''),
      };
    }

    if (
      text.includes(SCENARIO_MARKERS.multiTool) &&
      toolResultCount(request) === 0
    ) {
      const calls: LLMToolCall[] = Array.from({ length: 4 }, (_, i) => ({
        callId: `multi-${i}`,
        name: 'test_echo',
        input: { value: `call ${i}` },
      }));
      return {
        content: '',
        toolCalls: calls,
        finishReason: 'tool_calls',
        usage: usage(''),
      };
    }

    if (text.includes(SCENARIO_MARKERS.badCall) && toolResultCount(request) === 0) {
      // A structurally invalid call: no name at all. The runtime must reject
      // this as model output that failed validation, not pass it onward.
      return {
        content: '',
        toolCalls: [{ callId: '', name: '', input: null }],
        finishReason: 'tool_calls',
        usage: usage(''),
      };
    }

    // A tool request may come from the user's own message OR from injected
    // text. The user's own request fires once, at the start of the turn; an
    // injected one fires while at most one tool has already run. Both are
    // bounded so a subverted turn still terminates on its own — the platform
    // limits are tested separately, and must not be the only thing that stops
    // this fake.
    const priorResults = toolResultCount(request);
    const injected = injectedText(request);
    const candidate =
      priorResults === 0 && text.includes(SCENARIO_MARKERS.toolCall)
        ? text
        : priorResults <= 1 && injected.includes(SCENARIO_MARKERS.toolCall)
          ? injected
          : '';
    const toolMarker = candidate.indexOf(SCENARIO_MARKERS.toolCall);
    if (toolMarker !== -1) {
      // `[[tool:name:{json}]]`
      const rest = candidate.slice(toolMarker + SCENARIO_MARKERS.toolCall.length);
      const end = findSpecEnd(rest);
      const spec = end === -1 ? rest : rest.slice(0, end);
      const separator = spec.indexOf(':');
      const name = (separator === -1 ? spec : spec.slice(0, separator)).trim();
      const rawInput = separator === -1 ? '{}' : spec.slice(separator + 1);

      let input: unknown = {};
      try {
        input = JSON.parse(rawInput);
      } catch {
        // A model emitting unparseable arguments is a real failure mode; pass
        // the raw string through so schema validation rejects it downstream.
        input = rawInput;
      }

      const call: LLMToolCall = {
        callId: `call-${randomUUID().slice(0, 8)}`,
        name,
        input,
      };
      return {
        content: '',
        toolCalls: [call],
        finishReason: 'tool_calls',
        usage: usage(''),
      };
    }

    // ---- Ordinary and grounded responses ----------------------------------

    // If knowledge was supplied, echo a marker of it so tests can assert the
    // model actually received grounded context rather than assuming it did.
    const knowledge = request.messages.find((m) => m.trust === 'knowledge');
    const results = request.messages.filter((m) => m.role === 'tool');

    let content: string;
    if (results.length > 0) {
      content = `Using the tool result: ${results
        .map((r) => unfence(r.content))
        .join(' | ')
        .slice(0, 400)}`;
    } else if (knowledge) {
      content = `Based on the approved knowledge: ${unfence(knowledge.content)
        .replace(/\s+/g, ' ')
        .slice(0, 300)}`;
    } else {
      content = `Acknowledged: ${text.slice(0, 200)}`;
    }

    return {
      content,
      toolCalls: [],
      finishReason: 'stop',
      usage: usage(content),
    };
  }

  return {
    name: 'deterministic',
    modelFor,
    complete,

    /**
     * Streaming over the same contract. It chunks the completed response
     * rather than generating incrementally — enough to prove the streaming
     * interface exists and terminates in the SAME validated response, which
     * is what stops streaming becoming a way around validation.
     */
    async *stream(request) {
      let response: NormalizedLLMResponse;
      try {
        response = await complete(request);
      } catch (error) {
        const failure =
          error instanceof LLMProviderError
            ? error.failure
            : { kind: 'unknown' as const, message: 'Provider error', retryable: false };
        yield { kind: 'error', message: failure.message, retryable: failure.retryable };
        return;
      }

      for (const call of response.toolCalls) {
        yield { kind: 'tool_call', call };
      }
      const size = 24;
      for (let i = 0; i < response.content.length; i += size) {
        yield { kind: 'delta', text: response.content.slice(i, i + size) };
      }
      yield { kind: 'done', response };
    },
  };
}
