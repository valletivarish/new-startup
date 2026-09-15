/**
 * Normalized intelligence contracts (Phase 4).
 *
 * The governing idea, from the phase brief: **the LLM is a component, not the
 * application.** Everything that decides what may happen — authorization,
 * tenant scope, tool permissions, state transitions, safety limits — lives in
 * application code. The model contributes text and *requests*; it never
 * contributes authority.
 *
 * These types are a normalized internal contract, deliberately not shaped
 * after any vendor's API. An adapter maps a provider onto this; the runtime
 * never sees a provider-specific structure, so swapping providers changes one
 * adapter and nothing else (ADR-001, §15 of the provider spec).
 */

/** Where a piece of context came from, and therefore how far to trust it. */
export type ContentTrust =
  /** Platform-authored policy. The highest authority in the prompt. */
  | 'platform'
  /** Organization-authored agent instructions. Trusted, but below platform. */
  | 'agent'
  /** Retrieved organization knowledge. DATA — never instructions. */
  | 'knowledge'
  /** End-user input. DATA. */
  | 'user'
  /** Tool output. DATA, and possibly shaped by an external system. */
  | 'tool';

export interface NormalizedMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Trust label, used by the context builder to fence untrusted content. */
  readonly trust: ContentTrust;
  /** Set on tool-result messages so the model can correlate. */
  readonly toolCallId?: string;
}

/** A tool as offered TO the model. Carries no permission information. */
export interface LLMToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema. */
  readonly inputSchema: unknown;
}

export interface NormalizedLLMRequest {
  readonly messages: readonly NormalizedMessage[];
  readonly tools?: readonly LLMToolSpec[];
  /**
   * Business capability, never a model name. The routing layer maps a tier
   * onto a concrete model, so dashboard users never configure a vendor.
   */
  readonly intelligenceTier: 'standard' | 'advanced' | 'premium';
  /** JSON Schema the response must satisfy, when structured output is wanted. */
  readonly responseSchema?: unknown;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Correlates provider calls with platform events. */
  readonly correlationId?: string;
}

/** Why generation stopped. Normalized across providers. */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'timeout';

export interface LLMToolCall {
  /** Provider-supplied or adapter-generated; unique within the response. */
  readonly callId: string;
  readonly name: string;
  /** RAW model output. Untrusted until validated against the tool's schema. */
  readonly input: unknown;
}

/** Usage metadata for the future cost layer. No billing is built here. */
export interface LLMUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly model: string;
  readonly provider: string;
  readonly latencyMs: number;
  readonly requestId: string | null;
}

export interface NormalizedLLMResponse {
  readonly content: string;
  readonly toolCalls: readonly LLMToolCall[];
  readonly finishReason: FinishReason;
  readonly usage: LLMUsage;
  /** Present when `responseSchema` was requested. Untrusted until validated. */
  readonly structured?: unknown;
  /** The model declined. Distinct from an empty response. */
  readonly refusal?: string;
}

/** Incremental events, so a voice transport can consume the same contract. */
export type LLMStreamEvent =
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'tool_call'; readonly call: LLMToolCall }
  | { readonly kind: 'done'; readonly response: NormalizedLLMResponse }
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean };

/**
 * A provider failure the runtime can reason about.
 *
 * `retryable` is what a bounded retry policy keys on — the runtime never
 * retries a validation failure or a refusal, only a transient fault.
 */
export interface ProviderFailure {
  readonly kind: 'timeout' | 'unavailable' | 'rate_limited' | 'invalid_response' | 'unknown';
  readonly message: string;
  readonly retryable: boolean;
}

export class LLMProviderError extends Error {
  readonly failure: ProviderFailure;
  constructor(failure: ProviderFailure) {
    super(failure.message);
    this.name = 'LLMProviderError';
    this.failure = failure;
  }
}

/**
 * The intelligence provider.
 *
 * `complete` and `stream` share one contract, so streaming cannot bypass
 * validation, authorization, or tenant scope — a streamed response still
 * terminates in the same `NormalizedLLMResponse` everything else validates.
 */
export interface IntelligenceProvider {
  readonly name: string;
  /** Model identifier resolved for a tier. Reported, never user-configured. */
  modelFor(tier: NormalizedLLMRequest['intelligenceTier']): string;
  complete(request: NormalizedLLMRequest): Promise<NormalizedLLMResponse>;
  stream(request: NormalizedLLMRequest): AsyncIterable<LLMStreamEvent>;
}

// ---------------------------------------------------------------------------
// Runtime outcomes
// ---------------------------------------------------------------------------

/**
 * Typed runtime outcomes.
 *
 * Deliberately a discriminated union rather than parsed strings: the runtime
 * must be able to branch on "the provider failed" versus "the model produced
 * something invalid" versus "we have no knowledge" without inspecting prose.
 */
export type RuntimeOutcome =
  | { readonly kind: 'FinalResponse'; readonly content: string; readonly citations: readonly Citation[] }
  | { readonly kind: 'ToolRequest'; readonly calls: readonly LLMToolCall[] }
  | { readonly kind: 'Refusal'; readonly reason: string }
  | { readonly kind: 'KnowledgeInsufficient'; readonly detail: 'no_knowledge' | 'below_threshold' }
  | { readonly kind: 'ProviderFailure'; readonly failure: ProviderFailure }
  | { readonly kind: 'ValidationFailure'; readonly errors: readonly string[] }
  | { readonly kind: 'RuntimeFailure'; readonly reason: string }
  | { readonly kind: 'HumanEscalation'; readonly reason: string }
  | { readonly kind: 'LimitExceeded'; readonly limit: RuntimeLimitName };

export type RuntimeLimitName =
  | 'max_turns'
  | 'max_tool_calls_per_turn'
  | 'max_tool_iterations'
  | 'max_retries'
  | 'max_context_chars'
  | 'max_duration_ms'
  | 'max_tool_output_chars';

/**
 * Where an answer came from.
 *
 * Carried internally so the platform can say honestly whether a response was
 * grounded. A response with no citations must never be presented as grounded.
 */
export interface Citation {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly sourceId: string;
  readonly similarity: number;
}

/** Hard safety limits. Enforced by application code, never by the model. */
export interface RuntimeLimits {
  readonly maxToolCallsPerTurn: number;
  readonly maxToolIterations: number;
  readonly maxRetries: number;
  readonly maxContextChars: number;
  readonly maxToolOutputChars: number;
  readonly maxDurationMs: number;
  readonly maxHistoryMessages: number;
}

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  maxToolCallsPerTurn: 3,
  /** Model → tool → model cycles. Bounds the classic runaway loop. */
  maxToolIterations: 3,
  maxRetries: 2,
  maxContextChars: 60_000,
  maxToolOutputChars: 8_000,
  maxDurationMs: 30_000,
  maxHistoryMessages: 40,
};
