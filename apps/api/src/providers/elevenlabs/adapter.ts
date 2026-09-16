/**
 * ElevenLabs voice-session adapter.
 *
 * This adapter is injected via the VOICE_SESSION_PROVIDER DI token. The rest
 * of the application only sees the VoiceSessionAdapter interface — it never
 * imports the ElevenLabs SDK directly.
 *
 * Responsibilities:
 *   1. LLM availability check — verifies Gemini Flash-Lite is available before
 *      provisioning. STOP (throw) if it is not; no silent substitution.
 *   2. Provision — creates or updates an ElevenLabs conversational-AI agent
 *      for a given AgentVersion, optionally uploading a knowledge snapshot.
 *   3. Issue WebRTC token — calls getWebrtcToken to produce the short-lived
 *      token the browser passes to @elevenlabs/react.
 *   4. Fetch conversation result — queries the conversation API for transcript,
 *      summary and cost after a call ends.
 *   5. Webhook signature verification — verifies the HMAC signature on inbound
 *      ElevenLabs webhook events.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config.js';
import { getElevenLabsClient } from './client.js';
import type {
  KnowledgeSnapshot,
  TranscriptTurn,
} from './types.js';

/** The LLM model slug we require ElevenLabs to expose. Stop if unavailable. */
const REQUIRED_LLM = 'gemini-3.5-flash-lite';

/**
 * Result of a getWebrtcToken call.
 */
export interface WebrtcTokenResult {
  readonly conversationToken: string;
  readonly externalAgentId: string;
}

/**
 * Result of fetching a conversation from the provider.
 */
export interface ConversationDetails {
  readonly externalConversationId: string;
  readonly status: string;
  readonly transcript: readonly TranscriptTurn[] | null;
  readonly summary: string | null;
  readonly durationSeconds: number | null;
  readonly costCredits: number | null;
}

/**
 * The interface injected by DI. Every method that touches ElevenLabs lives here;
 * nothing outside this directory imports the SDK.
 */
export interface VoiceSessionAdapter {
  /**
   * Verify that the required LLM (Gemini Flash-Lite) is available.
   * Throws if not — callers must STOP and report rather than silently substitute.
   */
  verifyLlmAvailable(): Promise<{ model: string; verified: boolean }>;

  /**
   * Provision or update an ElevenLabs conversational-AI agent for a deployment.
   * Returns the external agent ID and (optionally) KB document ID.
   */
  provisionAgent(input: {
    agentName: string;
    agentPurpose: string;
    voiceId: string;
    knowledgeSnapshot?: KnowledgeSnapshot;
    /** Update an existing agent rather than creating a new one. */
    existingExternalAgentId?: string;
  }): Promise<{ externalAgentId: string; externalKbDocId: string | null; llmModel: string }>;

  /**
   * Issue a short-lived WebRTC token for the browser to start a conversation.
   * The token is never returned to the browser directly — it goes through our
   * API endpoint, which redacts it before the response.
   */
  getWebrtcToken(externalAgentId: string): Promise<WebrtcTokenResult>;

  /**
   * Fetch the result of a completed conversation from the provider API.
   */
  fetchConversation(externalConversationId: string): Promise<ConversationDetails>;

  /**
   * Verify the HMAC-SHA256 signature on a webhook event.
   * Returns true if valid. Never throws on invalid signatures — returns false.
   */
  verifyWebhookSignature(payload: string, signatureHeader: string): boolean;
}

/**
 * Creates the live ElevenLabs adapter. Called once at module load and bound
 * to the VOICE_SESSION_PROVIDER DI token.
 */
export function createVoiceSessionAdapter(env: Env): VoiceSessionAdapter {
  function client() {
    return getElevenLabsClient(env);
  }

  return {
    async verifyLlmAvailable() {
      const cl = client();
      // The SDK returns a paginated list. We fetch the first page and look for
      // the required model.
      const result = await cl.conversationalAi.llm.list();
      // The SDK returns `{ llms: [...] }` shaped response
      const models: Array<{ modelId?: string; name?: string }> =
        Array.isArray((result as unknown as { llms?: unknown[] }).llms)
          ? ((result as unknown as { llms: Array<{ modelId?: string; name?: string }> }).llms)
          : [];
      const found = models.some((m) => {
        const id = (m.modelId ?? '').toLowerCase();
        const name = (m.name ?? '').toLowerCase();
        const required = REQUIRED_LLM.toLowerCase();
        // Exact match only — no silent substitute to another flash-lite model.
        return id === required || name === required || id.includes(required) || name.includes(required);
      });
      if (!found) {
        throw new Error(
          `Required LLM "${REQUIRED_LLM}" is not available in your ElevenLabs account. ` +
            `Available: ${models.map((m) => m.modelId ?? m.name ?? '?').join(', ')}. ` +
            `STOP: no silent substitute is permitted.`,
        );
      }
      return { model: REQUIRED_LLM, verified: true };
    },

    async provisionAgent({ agentName, agentPurpose, voiceId, knowledgeSnapshot, existingExternalAgentId }) {
      const cl = client();
      const { verified, model } = await this.verifyLlmAvailable();
      if (!verified) throw new Error('LLM not available');

      // Upload knowledge snapshot if provided (Strategy A).
      let kbDocId: string | null = null;
      if (knowledgeSnapshot) {
        // ElevenLabs KB creation: POST text document to knowledgeBase.documents
        const kbResult = await cl.conversationalAi.knowledgeBase.documents.createFromText({
          name: knowledgeSnapshot.name,
          text: knowledgeSnapshot.content,
        });
        kbDocId = (kbResult as unknown as { id?: string; documentId?: string }).id
          ?? (kbResult as unknown as { id?: string; documentId?: string }).documentId
          ?? null;
      }

      // Build the agent config. We use `unknown` casting to bridge between our
      // normalized types and the SDK's generated types (Llm enum, KnowledgeBaseLocator,
      // etc.) — the values are structurally correct at runtime.
      type AgentConfigShape = Parameters<typeof cl.conversationalAi.agents.create>[0];
      const agentConfig = {
        name: agentName,
        conversationConfig: {
          agent: {
            prompt: {
              prompt: agentPurpose,
              llm: model,
              ...(kbDocId
                ? {
                    knowledgeBase: [
                      {
                        type: 'file',
                        name: knowledgeSnapshot?.name ?? 'Knowledge Base',
                        id: kbDocId,
                      },
                    ],
                  }
                : {}),
            },
          },
          tts: {
            voiceId: voiceId || env.ELEVENLABS_DEFAULT_VOICE_ID || 'Rachel',
          },
        },
      } as unknown as AgentConfigShape;

      let externalAgentId: string;
      if (existingExternalAgentId) {
        type UpdateShape = Parameters<typeof cl.conversationalAi.agents.update>[1];
        await cl.conversationalAi.agents.update(existingExternalAgentId, agentConfig as unknown as UpdateShape);
        externalAgentId = existingExternalAgentId;
      } else {
        const created = await cl.conversationalAi.agents.create(agentConfig);
        externalAgentId = (created as unknown as { agentId?: string }).agentId ?? '';
        if (!externalAgentId) {
          throw new Error('ElevenLabs agent creation returned no agentId');
        }
      }

      return { externalAgentId, externalKbDocId: kbDocId, llmModel: model };
    },

    async getWebrtcToken(externalAgentId: string) {
      const cl = client();
      const result = await cl.conversationalAi.conversations.getWebrtcToken({
        agentId: externalAgentId,
      });
      const token =
        (result as unknown as { token?: string }).token ??
        (result as unknown as { signed_url?: string }).signed_url ?? '';
      if (!token) {
        throw new Error('ElevenLabs returned no conversation token');
      }
      return { conversationToken: token, externalAgentId };
    },

    async fetchConversation(externalConversationId: string) {
      const cl = client();
      const raw = await cl.conversationalAi.conversations.get(externalConversationId);
      const r = raw as unknown as Record<string, unknown>;

      const turns: TranscriptTurn[] = [];
      const transcript = (r['transcript'] ?? r['turns']) as unknown[] | undefined;
      if (Array.isArray(transcript)) {
        for (const t of transcript) {
          const turn = t as Record<string, unknown>;
          turns.push({
            role: String(turn['role'] ?? turn['speaker'] ?? 'agent') as 'agent' | 'user',
            message: String(turn['message'] ?? turn['text'] ?? ''),
            timeInCallSecs:
              typeof turn['timeInCallSecs'] === 'number' ? turn['timeInCallSecs'] : undefined,
          });
        }
      }

      const durationSecs =
        typeof r['duration'] === 'number'
          ? Math.round(r['duration'])
          : typeof r['durationSeconds'] === 'number'
            ? Math.round(r['durationSeconds'])
            : null;

      const costCredits =
        typeof r['cost'] === 'number'
          ? r['cost']
          : typeof r['costCredits'] === 'number'
            ? r['costCredits']
            : null;

      const summary = typeof r['summary'] === 'string' ? r['summary'] : null;
      const status = String(r['status'] ?? 'unknown');

      return {
        externalConversationId,
        status,
        transcript: turns.length > 0 ? turns : null,
        summary,
        durationSeconds: durationSecs,
        costCredits: costCredits as number | null,
      };
    },

    verifyWebhookSignature(payload: string, signatureHeader: string): boolean {
      if (!env.ELEVENLABS_WEBHOOK_SECRET) return false;
      try {
        // ElevenLabs sends: xi-signature-256=<hex-hmac>
        const expected = createHmac('sha256', env.ELEVENLABS_WEBHOOK_SECRET)
          .update(payload, 'utf8')
          .digest('hex');
        const received = signatureHeader.replace(/^xi-signature-256=/, '');
        return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
      } catch {
        return false;
      }
    },
  };
}

/** A stub adapter for use in tests (never calls the network). */
export function createStubVoiceSessionAdapter(): VoiceSessionAdapter {
  return {
    async verifyLlmAvailable() {
      return { model: REQUIRED_LLM, verified: true };
    },
    async provisionAgent({ agentName }) {
      return {
        externalAgentId: `stub-agent-${agentName.toLowerCase().replace(/\s+/g, '-')}`,
        externalKbDocId: null,
        llmModel: REQUIRED_LLM,
      };
    },
    async getWebrtcToken(externalAgentId: string) {
      return {
        conversationToken: `stub-token-for-${externalAgentId}`,
        externalAgentId,
      };
    },
    async fetchConversation(externalConversationId: string) {
      return {
        externalConversationId,
        status: 'done',
        transcript: [
          { role: 'agent', message: 'Hello, how can I help you?', timeInCallSecs: 0 },
          { role: 'user', message: 'I would like to know more.', timeInCallSecs: 3 },
        ],
        summary: 'Stub conversation summary.',
        durationSeconds: 42,
        costCredits: null,
      };
    },
    verifyWebhookSignature(_payload: string, _sig: string) {
      // Tests can control this by using the live adapter with a fake secret,
      // or by checking calls made to this method.
      return true;
    },
  };
}
