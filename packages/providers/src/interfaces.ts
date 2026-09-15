/**
 * Provider interfaces — DEFINITIONS ONLY.
 *
 * `03_SYSTEM_ARCHITECTURE` §9 and `12_ARCHITECTURE_DECISIONS_FINAL` §A9.
 *
 * NO PROVIDER IS SELECTED OR IMPLEMENTED. Twilio, Plivo, Exotel, Sarvam,
 * Deepgram, ElevenLabs, OpenAI, Anthropic, Google and xAI are candidates
 * behind these interfaces, to be chosen on benchmark evidence at their phase.
 *
 * No provider SDK is a dependency of this package, and none may be added
 * ahead of its phase (`07_CODING_RULES` §22).
 *
 *   Interface              defined   implemented
 *   ─────────────────────  ───────   ───────────
 *   NotificationProvider   1         1 (console transport only)
 *   EmbeddingProvider      1         3
 *   KnowledgeStore         1         3
 *   LLMProvider            1         4
 *   VoicePipeline          1         5
 *   TelephonyProvider      1         5
 *   SpeechToTextProvider   1         5
 *   TextToSpeechProvider   1         5
 *   CalendarProvider       1         6
 *   CRMProvider            1         6
 *
 * Every method is organization-scoped at the call site, not here: adapters
 * receive an already-validated tenant context. Adapters must never resolve
 * tenancy themselves.
 */

import type { AgentSession, InboundEvent, OutboundEvent } from './agent-session.js';
import type { MediaStream } from './voice.js';

/** Common shape for anything that reports normalised usage for cost events. */
export interface UsageRecord {
  readonly serviceType:
    | 'llm'
    | 'stt'
    | 'tts'
    | 'telephony'
    | 'embedding'
    | 'knowledge';
  readonly provider: string;
  readonly quantity: number;
  readonly unit: 'tokens' | 'seconds' | 'characters' | 'requests' | 'minutes';
}

// ---------------------------------------------------------------------------
// Intelligence
// ---------------------------------------------------------------------------

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
}

export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema. Validated with Zod before anything is persisted or acted on. */
  readonly inputSchema: unknown;
}

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMToolDefinition[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  /** Business capability, never a model name — customers configure capability. */
  readonly intelligenceTier: 'standard' | 'advanced' | 'premium';
  readonly signal?: AbortSignal;
}

export interface LLMChunk {
  readonly delta: string;
  readonly toolCall?: { readonly name: string; readonly input: unknown };
}

export interface LLMResult {
  readonly content: string;
  readonly toolCalls: readonly { readonly name: string; readonly input: unknown }[];
  readonly usage: UsageRecord;
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResult>;
  /** Streaming is required for conversational latency (§10). */
  stream(request: LLMRequest): AsyncIterable<LLMChunk>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ readonly vectors: readonly (readonly number[])[]; readonly usage: UsageRecord }>;
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export interface KnowledgeChunkRef {
  readonly chunkId: string;
  readonly documentId: string;
  readonly content: string;
  readonly score: number;
}

/**
 * Abstracted so another vector store can replace pgvector later (§8).
 * Implementations MUST scope every operation to `organizationId`; retrieval is
 * additionally protected by row-level security.
 */
export interface KnowledgeStore {
  readonly name: string;
  upsert(
    organizationId: string,
    chunks: readonly {
      readonly chunkId: string;
      readonly documentId: string;
      readonly content: string;
      readonly embedding: readonly number[];
    }[],
  ): Promise<void>;
  search(
    organizationId: string,
    embedding: readonly number[],
    limit: number,
  ): Promise<readonly KnowledgeChunkRef[]>;
  deleteDocument(organizationId: string, documentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Speech and telephony
// ---------------------------------------------------------------------------

export interface SpeechToTextProvider {
  readonly name: string;
  /** Streaming transcription. Partial results drive endpointing. */
  transcribe(
    audio: AsyncIterable<Uint8Array>,
    options: { readonly language: string; readonly signal?: AbortSignal },
  ): AsyncIterable<{
    readonly text: string;
    readonly isFinal: boolean;
    readonly usage?: UsageRecord;
  }>;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(
    text: string,
    options: {
      readonly language: string;
      /** Business capability, never a vendor voice id. */
      readonly voiceTier: 'standard' | 'premium';
      readonly signal?: AbortSignal;
    },
  ): AsyncIterable<{ readonly frame: Uint8Array; readonly usage?: UsageRecord }>;
}

export interface TelephonyCall {
  readonly callId: string;
  readonly externalCallId: string;
  readonly status: 'queued' | 'ringing' | 'answered' | 'completed' | 'failed';
}

export interface TelephonyProvider {
  readonly name: string;
  /**
   * Originate an outbound call. Concurrency and spend caps are checked by the
   * caller BEFORE this is invoked — a call that would exceed a limit is never
   * placed (`06_PROVIDER_AND_COST_SPEC` §12).
   */
  originate(params: {
    readonly organizationId: string;
    readonly to: string;
    readonly from: string;
    readonly maxDurationSeconds: number;
  }): Promise<TelephonyCall>;
  hangup(externalCallId: string): Promise<void>;
  /** Verify a provider webhook's authenticity (§18). */
  verifyWebhook(headers: Readonly<Record<string, string>>, rawBody: string): boolean;
  /**
   * Open the bidirectional media stream for a live call.
   *
   * Added in Phase 5C. This is the seam that keeps carrier audio formats out of
   * the rest of the platform: the adapter speaks whatever its carrier speaks —
   * mu-law 8 kHz for Plivo and TTBS, selectable-rate linear16 for Knowlarity —
   * and returns `NormalizedAudioFrame`s. Nothing downstream can tell which
   * carrier is underneath, which is the property that makes the second source
   * usable at all.
   *
   * Not every carrier attaches media the same way (some dial into an endpoint
   * you host, some expect you to connect). The adapter hides that too.
   */
  openMediaStream(externalCallId: string): Promise<MediaStream>;
}

/**
 * The boundary between the agent runtime and any audio transport (ADR-007).
 *
 * This is the interface that must exist in Phase 1 so the runtime is never
 * shaped as request/response. Phase 5 supplies an implementation; if that
 * requires changing the runtime, the runtime shape was wrong and the fix
 * belongs in Phase 2.
 */
export interface VoicePipeline {
  readonly name: string;
  /** Bind a live call to an agent session, wiring audio both ways. */
  attach(params: {
    readonly session: AgentSession;
    readonly call: TelephonyCall;
    readonly language: string;
    readonly inbound: AsyncIterable<InboundEvent>;
    readonly onOutbound: (event: OutboundEvent) => Promise<void>;
  }): Promise<void>;
  detach(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Business actions
// ---------------------------------------------------------------------------

export interface CalendarProvider {
  readonly name: string;
  /** `idempotencyKey` is required — duplicate scheduling must not book twice (§19). */
  createEvent(params: {
    readonly organizationId: string;
    readonly title: string;
    readonly startsAt: Date;
    readonly durationMinutes: number;
    readonly attendeeEmails: readonly string[];
    readonly idempotencyKey: string;
  }): Promise<{ readonly externalEventId: string }>;
  cancelEvent(organizationId: string, externalEventId: string): Promise<void>;
}

export interface CRMProvider {
  readonly name: string;
  upsertRecord(params: {
    readonly organizationId: string;
    readonly recordType: string;
    readonly externalId?: string;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
  }): Promise<{ readonly externalId: string }>;
}

export interface NotificationProvider {
  readonly name: string;
  sendEmail(params: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
    readonly idempotencyKey?: string;
  }): Promise<void>;
}
