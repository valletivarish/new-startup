/**
 * Runtime contracts (Phase 2, ADR-007).
 *
 * Interfaces only — no implementation, no dependencies. These are the seams
 * that later phases plug into WITHOUT reshaping the session/event core:
 *
 *   ExecutionStrategy  → deterministic now, LLM-backed at Phase 4
 *   MemoryProvider     → conversation state now, business memory later
 *   ToolRegistry       → contract now, execution at Phase 4
 *   ToolExecutor       → contract now, real tools at Phase 4/6
 *
 * `03_SYSTEM_ARCHITECTURE` §13 requires conversation memory, structured
 * business memory and organization knowledge to stay DISTINCT rather than
 * collapse into one store, so they are separate interfaces here even though
 * only the first has an implementation.
 */

import type { RetrievalOutcome } from './knowledge.js';

/** Conversation state — the working memory of one session. */
export interface ConversationState {
  readonly sessionId: string;
  readonly turnCount: number;
  readonly lastUserMessage: string | null;
}

/** What the runtime decided to do this turn. */
export type RuntimeDecision =
  | { readonly kind: 'reply'; readonly content: string }
  | { readonly kind: 'escalate'; readonly reason: string }
  | { readonly kind: 'end'; readonly reason: string }
  /**
   * No DETERMINISTIC decision applies — hand the turn to the intelligence
   * layer (Phase 4).
   *
   * Deliberately a distinct outcome rather than an empty reply. Guardrails,
   * turn ceilings and operator rules are decided before a model is consulted
   * and can never be overridden by one; `defer` is the explicit statement
   * that none of them applied, so a reader can see exactly where application
   * authority ends and generation begins. When no intelligence layer is
   * wired, the runtime turns this back into an acknowledgement.
   */
  | { readonly kind: 'defer' };

export interface StrategyInput {
  /** The PINNED version's configuration — never the agent's current one. */
  readonly configuration: unknown;
  readonly turnCount: number;
  readonly lastUserMessage: string | null;
  /**
   * What the knowledge layer found, when a retriever is wired.
   *
   * The OUTCOME is what matters to a strategy without an LLM: it can refuse
   * honestly rather than answer from nothing. A grounded answer built from
   * the chunks themselves arrives with the intelligence layer.
   */
  readonly knowledge?: {
    readonly outcome: RetrievalOutcome;
    readonly chunkCount: number;
  };
}

/**
 * How a turn is decided.
 *
 * The single seam between the runtime loop and intelligence. Phase 4 supplies
 * an implementation backed by `LLMProvider`; nothing else changes.
 */
export interface ExecutionStrategy {
  readonly name: string;
  decide(input: StrategyInput): Promise<RuntimeDecision>;
}

/** An event as persisted, returned to callers of the runtime. */
export interface RuntimeEvent {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly direction: string;
  readonly payload: unknown;
}

export interface AgentRuntimeResult {
  readonly inboundEvent: RuntimeEvent;
  readonly outboundEvents: readonly RuntimeEvent[];
  /** True when the inbound event was a duplicate and was NOT reprocessed. */
  readonly deduplicated: boolean;
}

export interface InboundRuntimeEvent {
  readonly type: string;
  readonly payload: unknown;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
}

/**
 * The runtime.
 *
 * Deliberately NOT `handle(message) → response`: it consumes one inbound
 * event and emits zero or more outbound events, which is the shape that
 * survives contact with streaming audio, interruptions and tool calls.
 */
export interface AgentRuntime {
  readonly strategyName: string;
  process(
    actor: { readonly organizationId: string; readonly userId: string },
    sessionId: string,
    inbound: InboundRuntimeEvent,
  ): Promise<AgentRuntimeResult>;
}

/** Agent context assembled for a turn. Populated further in later phases. */
export interface AgentContext {
  readonly organizationId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly configuration: unknown;
  readonly conversation: ConversationState;
}

/**
 * Memory. Three KINDS, deliberately not interchangeable (§13):
 * conversation state, structured business memory, organization knowledge
 * (the last being `KnowledgeStore`, defined separately).
 */
export interface MemoryProvider {
  readonly name: string;
  loadConversationState(sessionId: string): Promise<ConversationState>;
  /** Durable per-organization business facts. Phase 6 and later. */
  loadBusinessMemory(
    organizationId: string,
    subjectId: string,
  ): Promise<Readonly<Record<string, unknown>>>;
  saveBusinessMemory(
    organizationId: string,
    subjectId: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

/**
 * A tool an agent may be permitted to call.
 *
 * `requiredPermission` is the link to the authorization layer: the runtime
 * must check it before execution, so a prompt cannot talk an agent into an
 * action the initiating membership lacks (`07_CODING_RULES` §12).
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema. Validated before execution and before persistence. */
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly requiredPermission: string;
  readonly organizationId: string;
  readonly enabled: boolean;
}

export interface ToolRegistry {
  list(organizationId: string): Promise<readonly ToolDefinition[]>;
  get(organizationId: string, name: string): Promise<ToolDefinition | null>;
}

export interface ToolExecutionRequest {
  readonly organizationId: string;
  readonly sessionId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
  /** Permissions of the membership on whose behalf the agent is acting. */
  readonly grantedPermissions: readonly string[];
  /** Duplicate execution must not produce a duplicate business outcome (§19). */
  readonly idempotencyKey: string;
}

export interface ToolExecutionResult {
  readonly callId: string;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: string;
}

export interface ToolExecutor {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
}
