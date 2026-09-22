/**
 * Normalized types for the ElevenLabs voice-session adapter.
 *
 * These types are the ONLY surface the rest of the application sees. The
 * ElevenLabs SDK types never leak past this directory — callers depend on
 * these normalized shapes, which allows the provider to be swapped without
 * touching domain code.
 */

/** A provisioned ElevenLabs agent deployment, keyed by our agent version. */
export interface VoiceDeployment {
  readonly id: string;
  readonly agentVersionId: string;
  readonly provider: string;
  readonly environment: string;
  readonly externalAgentId: string;
  readonly externalKbDocId: string | null;
  readonly llmModel: string | null;
  readonly llmVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Result of starting a voice session — returned to the browser. */
export interface VoiceSessionToken {
  /** Our internal voice session row ID. */
  readonly voiceSessionId: string;
  /** The token the browser passes to the ElevenLabs React SDK. */
  readonly conversationToken: string;
}

/** Full voice session state including result fields. */
export interface VoiceSessionResult {
  readonly id: string;
  readonly sessionId: string;
  readonly deploymentId: string;
  readonly provider: string;
  readonly externalConversationId: string | null;
  readonly status: 'pending' | 'active' | 'ended' | 'failed';
  readonly transcript: readonly TranscriptTurn[] | null;
  readonly summary: string | null;
  readonly structuredAnswers: Readonly<Record<string, unknown>> | null;
  readonly durationSeconds: number | null;
  readonly costCredits: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly jobId?: string | null;
  readonly candidateId?: string | null;
  readonly agentId?: string | null;
  readonly agentName?: string | null;
  readonly jobTitle?: string | null;
  readonly candidateName?: string | null;
  readonly channel?: 'browser_demo' | 'phone';
}

/** One turn in the conversation transcript. */
export interface TranscriptTurn {
  readonly role: 'agent' | 'user';
  readonly message: string;
  readonly timeInCallSecs?: number;
}

/**
 * Knowledge snapshot sent to ElevenLabs.
 *
 * Strategy A (approved): we sync a small approved text snapshot to ElevenLabs
 * KB rather than exposing a live RAG tool, which keeps the agent self-contained
 * and avoids the latency of real-time retrieval during a voice call.
 */
export interface KnowledgeSnapshot {
  readonly name: string;
  readonly content: string;
}

export type { VoiceProvisionSnapshot } from './provision-snapshot.js';

/** Input for provisioning a deployment. */
export interface ProvisionInput {
  readonly organizationId: string;
  readonly agentVersionId: string;
  readonly agentName: string;
  readonly agentPurpose: string;
  readonly knowledgeSnapshot?: KnowledgeSnapshot;
  readonly voiceId?: string;
  /** 'test' or 'production'. */
  readonly environment?: string;
}

/** Input for starting a voice session. */
export interface StartSessionInput {
  readonly organizationId: string;
  readonly agentVersionId: string;
  readonly localSessionId: string;
  readonly deploymentId: string;
}
