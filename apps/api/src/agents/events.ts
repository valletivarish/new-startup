/**
 * The generic event taxonomy (ADR-007).
 *
 * A session is an ordered stream of events in and an ordered stream of events
 * out. Everything the platform will ever do to a conversation — text now,
 * audio and interruptions at Phase 5, tool calls at Phase 4 — is expressed as
 * an event in this taxonomy.
 *
 * The taxonomy is deliberately transport-agnostic. Adding voice later means
 * adding event TYPES (`AudioFrameReceived`, `SpeechStarted`), never changing
 * the session model, the ordering guarantee, or the runtime loop. That is the
 * property ADR-007 exists to protect, and the reason none of these names
 * mention text, HTTP, or any provider.
 */

import { z } from 'zod';

/** Which way an event travels relative to the platform. */
export const EventDirection = z.enum(['inbound', 'outbound']);
export type EventDirection = z.infer<typeof EventDirection>;

/**
 * Phase 2 event types.
 *
 * Voice adds to this list; it does not reshape it.
 */
export const EVENT_TYPES = [
  // Lifecycle
  'SessionStarted',
  'SessionEnded',

  // Conversation
  'UserMessageReceived',
  'AgentResponseRequested',
  'AgentResponseGenerated',

  // Tools — contract only in Phase 2; execution arrives with the tool layer.
  'ToolRequested',
  'ToolCompleted',
  'ToolFailed',

  // Human handoff
  'HumanEscalationRequested',

  // Failure
  'ErrorOccurred',
] as const;

export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/** Event types a CLIENT may submit. Everything else is emitted by the runtime. */
export const INBOUND_EVENT_TYPES = [
  'SessionStarted',
  'UserMessageReceived',
  'ToolCompleted',
  'ToolFailed',
  'HumanEscalationRequested',
  'SessionEnded',
] as const satisfies readonly EventType[];

const INBOUND_SET: ReadonlySet<string> = new Set(INBOUND_EVENT_TYPES);

export function isInboundEventType(value: string): boolean {
  return INBOUND_SET.has(value);
}

/**
 * Per-type payload shapes.
 *
 * `.strict()` again: an unrecognised field on an inbound event is rejected,
 * not stored. Event payloads are persisted and later replayed, so accepting
 * unknown data would mean persisting unvalidated client input.
 */
export const EventPayloads = {
  SessionStarted: z.object({}).strict(),
  SessionEnded: z
    .object({
      reason: z
        .enum(['completed', 'caller_hangup', 'agent_ended', 'timeout', 'max_turns', 'error', 'cancelled'])
        .default('completed'),
    })
    .strict(),
  UserMessageReceived: z
    .object({ content: z.string().min(1).max(10_000) })
    .strict(),
  AgentResponseRequested: z.object({}).strict(),
  AgentResponseGenerated: z
    .object({
      content: z.string().max(10_000),
      /** How the response was produced — `deterministic` until Phase 4. */
      strategy: z.string().max(60),
    })
    .strict(),
  ToolRequested: z
    .object({
      toolName: z.string().min(1).max(80),
      callId: z.string().min(1).max(80),
      input: z.unknown(),
    })
    .strict(),
  ToolCompleted: z
    .object({
      callId: z.string().min(1).max(80),
      output: z.unknown(),
    })
    .strict(),
  ToolFailed: z
    .object({
      callId: z.string().min(1).max(80),
      message: z.string().max(2000),
    })
    .strict(),
  HumanEscalationRequested: z
    .object({ reason: z.string().max(500).default('') })
    .strict(),
  ErrorOccurred: z
    .object({
      message: z.string().max(2000),
      recoverable: z.boolean().default(true),
    })
    .strict(),
} as const;

export function payloadSchemaFor(type: EventType): z.ZodTypeAny {
  return EventPayloads[type];
}

/** An inbound event as submitted by a client. */
export const InboundEventInput = z.object({
  type: EventType,
  payload: z.unknown().default({}),
  /**
   * Client-supplied deduplication key. A retry carrying the same key returns
   * the original event rather than appending a second one.
   */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  correlationId: z.string().trim().max(200).optional(),
});

export type InboundEventInput = z.infer<typeof InboundEventInput>;
