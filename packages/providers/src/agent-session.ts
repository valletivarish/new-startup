/**
 * The agent runtime contract (ADR-007).
 *
 *   ❌ AgentRuntime.handle(message) → response
 *   ✅ AgentSession: inbound event stream → outbound event stream
 *
 * Defined in Phase 1, implemented in Phase 2. Nothing here is built yet.
 *
 * The shape exists now because it is the decision that is free today and a
 * runtime rewrite at Phase 5. A request/response handler has no way to express
 * partial input, a caller interrupting mid-sentence, an utterance arriving as
 * audio frames, a tool call running while audio continues, or a response that
 * begins emitting before it is complete — and `03_SYSTEM_ARCHITECTURE` §10
 * requires all of them.
 *
 * Text chat is the degenerate one-event case of this same loop, not a separate
 * mechanism that voice is later retrofitted onto.
 */

/** Everything that can arrive at a session. */
export type InboundEvent =
  | { readonly kind: 'text'; readonly content: string; readonly final: boolean }
  | { readonly kind: 'audio'; readonly frame: Uint8Array; readonly sequence: number }
  | { readonly kind: 'speech_started' }
  | { readonly kind: 'speech_ended' }
  | { readonly kind: 'dtmf'; readonly digit: string }
  | { readonly kind: 'session_started'; readonly at: Date }
  | { readonly kind: 'session_ended'; readonly reason: SessionEndReason }
  | { readonly kind: 'tool_result'; readonly callId: string; readonly output: unknown }
  | { readonly kind: 'error'; readonly message: string; readonly recoverable: boolean };

/** Everything a session can emit. */
export type OutboundEvent =
  | { readonly kind: 'text_delta'; readonly content: string }
  | { readonly kind: 'text_final'; readonly content: string }
  | { readonly kind: 'audio'; readonly frame: Uint8Array; readonly sequence: number }
  /** Barge-in: discard anything already queued for playback. */
  | { readonly kind: 'interrupt' }
  | {
      readonly kind: 'tool_call';
      readonly callId: string;
      readonly tool: string;
      readonly input: unknown;
    }
  | { readonly kind: 'transfer_to_human'; readonly reason: string }
  | { readonly kind: 'end_session'; readonly reason: SessionEndReason };

export type SessionEndReason =
  | 'completed'
  | 'caller_hangup'
  | 'agent_ended'
  | 'transferred'
  | 'timeout'
  | 'max_duration'
  | 'error'
  | 'cancelled';

/**
 * A live agent conversation.
 *
 * Stateful and long-lived. The implementation owns conversation state for the
 * session's lifetime; it is not reconstructed per turn.
 */
export interface AgentSession {
  readonly sessionId: string;
  readonly organizationId: string;

  /** Push an inbound event. Never blocks on model or provider latency. */
  submit(event: InboundEvent): Promise<void>;

  /** Outbound events, in order, as they are produced. */
  events(): AsyncIterable<OutboundEvent>;

  /**
   * Abort in-flight generation — the barge-in path. Must propagate
   * cancellation through the intelligence layer, not merely stop reading.
   */
  cancel(reason: SessionEndReason): Promise<void>;

  close(): Promise<void>;
}
