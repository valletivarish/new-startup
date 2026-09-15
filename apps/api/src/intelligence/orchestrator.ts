/**
 * The intelligence runtime loop.
 *
 * This is where the phase's governing sentence becomes code: **the LLM is a
 * component, not the application.** The loop below decides what happens. The
 * model only contributes text and requests, and every request it makes is
 * re-decided by application code before anything occurs.
 *
 *   assemble context (trust-labelled, bounded)
 *     → call the provider (bounded retries, only on retryable faults)
 *       → if it asked for tools: AUTHORIZE each one independently, execute
 *         the authorized ones, feed the results back as fenced data
 *       → if it produced text: return it as a typed outcome
 *
 * Every exit is a typed `RuntimeOutcome`. Nothing here returns a bare string,
 * because "the provider failed", "the model refused", "the output was
 * invalid" and "here is an answer" must never be indistinguishable to the
 * caller — that is exactly how a failure ends up presented to a customer as
 * though it were an answer.
 *
 * HARD LIMITS ARE ENFORCED HERE, NOT ASKED OF THE MODEL. Tool calls per turn,
 * model↔tool iterations, retries, context size and wall-clock duration are all
 * counted by this loop. A model that never stops asking for tools is stopped
 * by the counter, not by its own good judgement.
 */

import type {
  Citation,
  IntelligenceProvider,
  LLMToolCall,
  LLMToolSpec,
  LLMUsage,
  NormalizedLLMResponse,
  RetrievalOutcome,
  RetrievedChunk,
  RuntimeLimits,
  RuntimeOutcome,
} from '@platform/providers';
import { LLMProviderError } from '@platform/providers';
import { z } from 'zod';

import type { Actor } from '../agents/agents.service.js';
import type { AgentConfiguration } from '../agents/configuration.js';
import type { EventType } from '../agents/events.js';
import type { ToolExecutor } from '../tools/executor.js';
import type { ToolRecord } from '../tools/registry.js';
import { assembleContext, type HistoryMessage } from './context-builder.js';
import { validateStructured } from './structured-output.js';

/**
 * The shape a tool call must have before the platform will look at it.
 *
 * Model output is untrusted input, and that includes its STRUCTURE. A call
 * with no name, or with a name shaped like a path, is rejected here — before
 * the registry is queried, before anything is recorded as a request, and long
 * before anything runs.
 */
const ModelToolCall = z
  .object({
    callId: z.string().trim().min(1).max(80),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/, 'must be a plain tool name'),
    input: z.unknown(),
  })
  .strict();

export interface IntelligenceTurnInput {
  readonly actor: Actor;
  readonly sessionId: string;
  /** The PINNED version's configuration. Never the agent's current one. */
  readonly configuration: AgentConfiguration;
  readonly history: readonly HistoryMessage[];
  readonly userMessage: string;
  readonly knowledge?: {
    readonly outcome: RetrievalOutcome;
    readonly chunks: readonly RetrievedChunk[];
  };
  /** Tools this agent has been granted. Offered to the model WITHOUT permissions. */
  readonly availableTools: readonly ToolRecord[];
  /** Server-resolved permissions of the acting membership. */
  readonly grantedPermissions: ReadonlySet<string>;
  /**
   * Whether an answer must be backed by something.
   *
   * Set when the agent has knowledge configured AND `refuseWhenNoKnowledge`
   * is on. It gates the FINAL ANSWER, not the turn: the model may still run,
   * request tools, and decline — it simply may not present an answer that
   * rests on neither approved knowledge nor a tool result.
   */
  readonly requireGrounding?: boolean;
  readonly limits: RuntimeLimits;
  /** Appends an event to the session stream as it happens. */
  readonly emit: (event: {
    type: EventType;
    payload: unknown;
  }) => Promise<void>;
}

export interface IntelligenceTurnResult {
  readonly outcome: RuntimeOutcome;
  /** One entry per provider call. Metadata only — no prompts, no content. */
  readonly usage: readonly LLMUsage[];
}

export interface IntelligenceOrchestrator {
  readonly providerName: string;
  run(input: IntelligenceTurnInput): Promise<IntelligenceTurnResult>;
}

/**
 * What the model is told about a tool.
 *
 * Note what is NOT here: `requiredPermission`. The model is never shown the
 * authorization rules, so it cannot reason about them, argue with them, or
 * report them to a user who is probing for the boundary.
 */
function toSpec(tool: ToolRecord): LLMToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

export function createIntelligenceOrchestrator(
  provider: IntelligenceProvider,
  executor: ToolExecutor,
): IntelligenceOrchestrator {
  /**
   * One provider call with a bounded retry policy.
   *
   * Retries happen ONLY for faults the provider itself marked retryable. A
   * refusal, a validation failure or a malformed response is never retried:
   * repeating an identical request that produced bad output is how a bounded
   * loop turns into an unbounded bill.
   */
  async function callProvider(
    request: Parameters<IntelligenceProvider['complete']>[0],
    limits: RuntimeLimits,
    usage: LLMUsage[],
  ): Promise<
    | { ok: true; response: NormalizedLLMResponse }
    | { ok: false; outcome: RuntimeOutcome }
  > {
    let attempt = 0;
    for (;;) {
      try {
        const response = await provider.complete(request);
        usage.push(response.usage);
        return { ok: true, response };
      } catch (error) {
        const failure =
          error instanceof LLMProviderError
            ? error.failure
            : {
                kind: 'unknown' as const,
                message: 'The intelligence provider failed.',
                retryable: false,
              };

        if (!failure.retryable || attempt >= limits.maxRetries) {
          return { ok: false, outcome: { kind: 'ProviderFailure', failure } };
        }
        attempt += 1;
      }
    }
  }

  return {
    providerName: provider.name,

    async run(input) {
      const {
        actor,
        sessionId,
        configuration,
        limits,
        grantedPermissions,
        emit,
      } = input;

      const deadline = Date.now() + limits.maxDurationMs;
      const usage: LLMUsage[] = [];

      // The agent's own guardrail narrows the platform default; it can never
      // widen it. A configuration asking for 20 tool calls on a runtime that
      // permits 3 gets 3.
      const maxToolCalls = Math.min(
        configuration.guardrails.maxToolCallsPerTurn,
        limits.maxToolCallsPerTurn,
      );

      const toolResults: {
        callId: string;
        toolName: string;
        output: string;
      }[] = [];
      let citations: readonly Citation[] = [];
      let iterations = 0;
      let totalToolCalls = 0;

      async function emitAndExecute(call: LLMToolCall): Promise<void> {
        await emit({
          type: 'ToolRequested',
          payload: {
            toolName: call.name,
            callId: call.callId,
            input: call.input,
          },
        });

        const outcome = await executor.execute({
          actor,
          sessionId,
          call: { callId: call.callId, toolName: call.name, input: call.input },
          grantedPermissions,
          limits,
        });

        if (outcome.status === 'completed') {
          await emit({
            type: 'ToolCompleted',
            payload: { callId: call.callId, output: outcome.output },
          });
        } else {
          // A denial and a failure are both `ToolFailed` on the stream, but
          // the execution record keeps them distinct, and the message the
          // model sees says which it was.
          await emit({
            type: 'ToolFailed',
            payload: { callId: call.callId, message: outcome.message },
          });
        }

        toolResults.push({
          callId: call.callId,
          toolName: call.name,
          output: outcome.outputText,
        });
      }

      for (;;) {
        if (Date.now() > deadline) {
          return {
            outcome: { kind: 'LimitExceeded', limit: 'max_duration_ms' },
            usage,
          };
        }

        // ---- Assemble ----------------------------------------------------
        const context = assembleContext({
          configuration,
          history: input.history,
          userMessage: input.userMessage,
          knowledge: input.knowledge?.chunks ?? [],
          toolResults,
          limits,
        });
        citations = context.citations;

        if (context.totalChars > limits.maxContextChars) {
          // Dropping history silently would change what the model sees
          // without anyone knowing. Refuse the turn instead and say why.
          return {
            outcome: { kind: 'LimitExceeded', limit: 'max_context_chars' },
            usage,
          };
        }

        // ---- Call --------------------------------------------------------
        const called = await callProvider(
          {
            messages: context.messages,
            tools: input.availableTools.map(toSpec),
            intelligenceTier: configuration.capabilities.intelligenceTier,
            maxOutputTokens: 2048,
            timeoutMs: Math.max(1, deadline - Date.now()),
          },
          limits,
          usage,
        );
        if (!called.ok) return { outcome: called.outcome, usage };
        const response = called.response;

        // ---- Refusal -----------------------------------------------------
        // Distinct from an empty response and from a failure. A refusal is a
        // real answer about what the model would not do.
        if (response.refusal) {
          return { outcome: { kind: 'Refusal', reason: response.refusal }, usage };
        }

        // ---- Tool requests -----------------------------------------------
        if (response.toolCalls.length > 0) {
          // Validate the STRUCTURE of what the model produced before treating
          // any of it as a request. One malformed call fails the whole batch:
          // partially acting on output we have already found to be untrustworthy
          // would be the worst of both readings.
          const errors: string[] = [];
          for (const call of response.toolCalls) {
            const checked = validateStructured(ModelToolCall, call);
            if (!checked.ok) errors.push(...checked.errors);
          }
          if (errors.length > 0) {
            return { outcome: { kind: 'ValidationFailure', errors }, usage };
          }

          // Iterations first: a model that will not stop asking is the failure
          // mode this bound exists for, and naming it precisely is what makes
          // the event stream readable afterwards.
          iterations += 1;
          if (iterations > limits.maxToolIterations) {
            return {
              outcome: { kind: 'LimitExceeded', limit: 'max_tool_iterations' },
              usage,
            };
          }
          if (totalToolCalls + response.toolCalls.length > maxToolCalls) {
            return {
              outcome: { kind: 'LimitExceeded', limit: 'max_tool_calls_per_turn' },
              usage,
            };
          }

          // Sequential and in order, so the event stream reads the way the
          // conversation actually happened and two calls cannot interleave
          // their records.
          for (const call of response.toolCalls) {
            totalToolCalls += 1;
            await emitAndExecute(call);
          }
          continue;
        }

        // ---- Final response ----------------------------------------------
        const content = response.content.trim();
        if (content.length === 0) {
          // An empty answer is a failure, not an answer. Returning it would
          // show a customer a blank reply and call it success.
          return {
            outcome: { kind: 'RuntimeFailure', reason: 'empty_response' },
            usage,
          };
        }

        // An answer grounded in NOTHING is exactly what the guardrail exists
        // to prevent. Knowledge or a tool result both count as grounding; the
        // agent's own instructions do not, because inventing organization
        // facts is precisely the failure being guarded against (`02_BRD` §7).
        if (
          input.requireGrounding === true &&
          citations.length === 0 &&
          toolResults.length === 0
        ) {
          const detail =
            input.knowledge?.outcome === 'below_threshold'
              ? 'below_threshold'
              : 'no_knowledge';
          return { outcome: { kind: 'KnowledgeInsufficient', detail }, usage };
        }

        return {
          outcome: { kind: 'FinalResponse', content, citations },
          usage,
        };
      }

    },
  };
}
