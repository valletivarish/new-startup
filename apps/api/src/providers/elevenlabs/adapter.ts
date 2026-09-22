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
import pino from 'pino';
import type { Env } from '../../config.js';
import { getElevenLabsClient } from './client.js';
import { publicOutboundDialMessage } from './outbound-dial-message.js';
import {
  buildVoiceProvisionConfig,
  type EvaluationCriterion,
} from './provision-config.js';
import type {
  KnowledgeSnapshot,
  TranscriptTurn,
} from './types.js';

const logger = pino({ base: { service: 'voice-adapter' } });

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
  readonly structuredAnswers: Readonly<Record<string, unknown>> | null;
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
    voiceId?: string;
    knowledgeSnapshot?: KnowledgeSnapshot;
    /** Update an existing agent rather than creating a new one. */
    existingExternalAgentId?: string;
    /** Must-ask / evaluation criteria → provider data_collection + prompt. */
    evaluationCriteria?: readonly EvaluationCriterion[];
    agentType?: string;
    /** Hard cap on conversation length (seconds) enforced by the provider. */
    maxDurationSeconds?: number;
    /** Human transfer numbers from agent escalation config. */
    transferPhones?: readonly string[];
    displayName?: string;
    /** Company name from registration — spoken hiring identity. */
    organizationName?: string;
    greeting?: string;
    primaryLanguage?: string;
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
   * Fetch the call recording audio for a completed conversation.
   * Returns raw bytes + content type for authenticated playback.
   */
  fetchConversationAudio(
    externalConversationId: string,
  ): Promise<{ body: Buffer; contentType: string }>;

  /**
   * Verify the HMAC-SHA256 signature on a webhook event.
   * Returns true if valid. Never throws on invalid signatures — returns false.
   */
  verifyWebhookSignature(payload: string, signatureHeader: string): boolean;

  /**
   * Place a live outbound phone call to `toNumber` (E.164) for a provisioned agent.
   * Returns the provider conversation id when the dial was accepted.
   */
  startOutboundPhoneCall(input: {
    externalAgentId: string;
    toNumber: string;
  }): Promise<{ externalConversationId: string | null; accepted: boolean; message: string }>;

  /** Whether live outbound is configured (phone number id present). */
  isOutboundConfigured(): boolean;
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
      // Live API shape: `{ llms: [{ llm: "gemini-3.5-flash-lite", ... }] }`.
      // Older SDK typings may expose modelId/name — accept all known keys.
      const models: Array<{ llm?: string; modelId?: string; name?: string; id?: string }> =
        Array.isArray((result as unknown as { llms?: unknown[] }).llms)
          ? ((result as unknown as {
              llms: Array<{ llm?: string; modelId?: string; name?: string; id?: string }>;
            }).llms)
          : Array.isArray(result)
            ? (result as Array<{ llm?: string; modelId?: string; name?: string; id?: string }>)
            : [];
      const modelLabel = (m: {
        llm?: string;
        modelId?: string;
        name?: string;
        id?: string;
      }) => m.llm ?? m.modelId ?? m.name ?? m.id ?? '';
      const found = models.some((m) => {
        const id = modelLabel(m).toLowerCase();
        const required = REQUIRED_LLM.toLowerCase();
        // Exact match only — no silent substitute to another flash-lite model.
        return id === required;
      });
      if (!found) {
        const available = models.map(modelLabel).filter(Boolean);
        throw new Error(
          `Required LLM "${REQUIRED_LLM}" is not available in your ElevenLabs account. ` +
            `Available: ${available.slice(0, 40).join(', ') || '(none returned)'}` +
            `${available.length > 40 ? `, …(+${available.length - 40} more)` : ''}. ` +
            `STOP: no silent substitute is permitted.`,
        );
      }
      return { model: REQUIRED_LLM, verified: true };
    },

    async provisionAgent({
      agentName,
      agentPurpose,
      voiceId,
      knowledgeSnapshot,
      existingExternalAgentId,
      evaluationCriteria,
      agentType,
      maxDurationSeconds,
      transferPhones,
      displayName,
      organizationName,
      greeting,
      primaryLanguage,
    }) {
      const cl = client();
      const { verified, model } = await this.verifyLlmAvailable();
      if (!verified) throw new Error('LLM not available');

      const provision = buildVoiceProvisionConfig({
        agentPurpose,
        criteria: evaluationCriteria,
        agentType,
        transferPhones,
        displayName: displayName ?? agentName,
        organizationName,
        greeting,
        primaryLanguage,
      });

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

      const durationSecs =
        typeof maxDurationSeconds === 'number' && maxDurationSeconds > 0
          ? Math.min(Math.max(Math.round(maxDurationSeconds), 60), 1800)
          : Math.max(env.ELEVENLABS_MAX_TEST_MINUTES, env.ELEVENLABS_MAX_PHONE_MINUTES) *
            60;

      // Build the agent config. We use `unknown` casting to bridge between our
      // normalized types and the SDK's generated types (Llm enum, KnowledgeBaseLocator,
      // etc.) — the values are structurally correct at runtime.
      type AgentConfigShape = Parameters<typeof cl.conversationalAi.agents.create>[0];
      const agentConfig = {
        name: agentName,
        conversationConfig: {
          agent: {
            firstMessage: provision.firstMessage,
            language: provision.language,
            prompt: {
              prompt: provision.agentPrompt,
              llm: model,
              builtInTools: provision.builtInTools,
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
          conversation: {
            maxDurationSeconds: durationSecs,
          },
        },
        ...(provision.dataCollection
          ? {
              platformSettings: {
                dataCollection: provision.dataCollection,
              },
            }
          : {}),
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
      // Prefer REST over the SDK so analysis.summary / metadata.duration map
      // the same way as the provider dashboard (SDK field names drift).
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations/${externalConversationId}`,
        { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY } },
      );
      if (!res.ok) {
        throw new Error(`Conversation fetch failed HTTP ${res.status}`);
      }
      const r = (await res.json()) as Record<string, unknown>;
      const meta = (r['metadata'] as Record<string, unknown> | undefined) ?? {};
      const analysis = (r['analysis'] as Record<string, unknown> | undefined) ?? {};

      const turns: TranscriptTurn[] = [];
      const transcript = (r['transcript'] ?? r['turns']) as unknown[] | undefined;
      if (Array.isArray(transcript)) {
        for (const t of transcript) {
          const turn = t as Record<string, unknown>;
          turns.push({
            role: String(turn['role'] ?? turn['speaker'] ?? 'agent') as 'agent' | 'user',
            message: String(turn['message'] ?? turn['text'] ?? ''),
            timeInCallSecs:
              typeof turn['time_in_call_secs'] === 'number'
                ? turn['time_in_call_secs']
                : typeof turn['timeInCallSecs'] === 'number'
                  ? turn['timeInCallSecs']
                  : undefined,
          });
        }
      }

      const durationSecs =
        typeof meta['call_duration_secs'] === 'number'
          ? Math.round(meta['call_duration_secs'] as number)
          : typeof r['call_duration_secs'] === 'number'
            ? Math.round(r['call_duration_secs'] as number)
            : null;

      const costCredits =
        typeof meta['cost'] === 'number'
          ? (meta['cost'] as number)
          : typeof r['cost'] === 'number'
            ? r['cost']
            : null;

      const summary =
        typeof analysis['transcript_summary'] === 'string'
          ? (analysis['transcript_summary'] as string)
          : typeof r['summary'] === 'string'
            ? r['summary']
            : null;
      const status = String(r['status'] ?? 'unknown');

      // Flatten data-collection results into plain key → value answers.
      const structuredAnswers: Record<string, unknown> = {};
      const rawCollection = analysis['data_collection_results'];
      if (rawCollection && typeof rawCollection === 'object' && !Array.isArray(rawCollection)) {
        for (const [key, value] of Object.entries(rawCollection as Record<string, unknown>)) {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const row = value as Record<string, unknown>;
            structuredAnswers[key] =
              row['value'] ?? row['result'] ?? row['answer'] ?? row['rationale'] ?? value;
          } else if (value != null && value !== '') {
            structuredAnswers[key] = value;
          }
        }
      }

      return {
        externalConversationId,
        status,
        transcript: turns.length > 0 ? turns : null,
        summary,
        durationSeconds: durationSecs,
        costCredits: costCredits as number | null,
        structuredAnswers:
          Object.keys(structuredAnswers).length > 0 ? structuredAnswers : null,
      };
    },

    async fetchConversationAudio(externalConversationId: string) {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations/${externalConversationId}/audio`,
        { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY } },
      );
      if (!res.ok) {
        throw new Error(`Conversation audio fetch failed HTTP ${res.status}`);
      }
      const contentType =
        res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg';
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0) {
        throw new Error('Conversation audio was empty');
      }
      return { body, contentType };
    },

    verifyWebhookSignature(payload: string, signatureHeader: string): boolean {
      if (!env.ELEVENLABS_WEBHOOK_SECRET || !signatureHeader.trim()) return false;
      try {
        // Production header: ElevenLabs-Signature: t=<unix>,v0=<hex>[,v0=...]
        // Signed payload is `${timestamp}.${rawBody}` (docs / SDK constructEvent).
        if (/\bt=\d+/.test(signatureHeader) && /\bv0=/.test(signatureHeader)) {
          const timestamp = signatureHeader
            .split(',')
            .map((p) => p.trim())
            .find((p) => p.startsWith('t='))
            ?.slice(2);
          const candidates = signatureHeader
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.startsWith('v0='))
            .map((p) => p.slice(3));
          if (!timestamp || candidates.length === 0) return false;
          const ageSecs = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
          if (!Number.isFinite(Number(timestamp)) || ageSecs > 30 * 60) return false;
          const expected = createHmac('sha256', env.ELEVENLABS_WEBHOOK_SECRET)
            .update(`${timestamp}.${payload}`, 'utf8')
            .digest('hex');
          const expectedBuf = Buffer.from(expected, 'hex');
          for (const received of candidates) {
            const receivedBuf = Buffer.from(received, 'hex');
            if (
              expectedBuf.length === receivedBuf.length &&
              timingSafeEqual(expectedBuf, receivedBuf)
            ) {
              return true;
            }
          }
          return false;
        }

        // Test / legacy harness: xi-signature-256=<hex> of the raw body alone.
        const expected = createHmac('sha256', env.ELEVENLABS_WEBHOOK_SECRET)
          .update(payload, 'utf8')
          .digest('hex');
        const received = signatureHeader.replace(/^xi-signature-256=/i, '');
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(received, 'hex');
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
      } catch {
        return false;
      }
    },

    isOutboundConfigured() {
      return Boolean(env.ELEVENLABS_ENABLED && env.ELEVENLABS_PHONE_NUMBER_ID.trim());
    },

    async startOutboundPhoneCall({ externalAgentId, toNumber }) {
      const phoneNumberId = env.ELEVENLABS_PHONE_NUMBER_ID.trim();
      if (!phoneNumberId) {
        return {
          externalConversationId: null,
          accepted: false,
          message: 'Live phone calling is not connected for this company yet.',
        };
      }

      const cl = client();
      const body = {
        agentId: externalAgentId,
        agentPhoneNumberId: phoneNumberId,
        toNumber,
      };

      // Carrier choice stays inside this adapter. `india` → Exotel path; else Twilio.
      const useIndiaPath = env.ELEVENLABS_OUTBOUND_PROVIDER === 'india';
      const path = useIndiaPath ? 'india' : 'primary';
      try {
        const result = useIndiaPath
          ? await cl.conversationalAi.exotel.outboundCall(body)
          : await cl.conversationalAi.twilio.outboundCall(body);

        const accepted = Boolean(result.success);
        if (!accepted) {
          const raw = (result.message || '').slice(0, 800);
          logger.warn(
            { path, raw, toLast4: toNumber.slice(-4) },
            'voice.outbound_dial_failed',
          );
        }

        return {
          externalConversationId: result.conversationId ?? null,
          accepted,
          message: publicOutboundDialMessage({
            success: accepted,
            rawMessage: result.message || '',
          }),
        };
      } catch (err) {
        const raw = (err instanceof Error ? err.message : String(err)).slice(0, 800);
        logger.warn(
          { path, raw, toLast4: toNumber.slice(-4) },
          'voice.outbound_dial_failed',
        );
        return {
          externalConversationId: null,
          accepted: false,
          message: publicOutboundDialMessage({ success: false, rawMessage: raw }),
        };
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
        structuredAnswers: { experience_years: '2', notice_period: '30 days' },
      };
    },
    async fetchConversationAudio(_externalConversationId: string) {
      // Minimal valid-ish MPEG frame header bytes for tests (not playable music).
      return {
        body: Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]),
        contentType: 'audio/mpeg',
      };
    },
    verifyWebhookSignature(_payload: string, _sig: string) {
      // Tests can control this by using the live adapter with a fake secret,
      // or by checking calls made to this method.
      return true;
    },
    isOutboundConfigured() {
      return true;
    },
    async startOutboundPhoneCall({ externalAgentId, toNumber }) {
      return {
        externalConversationId: `stub-outbound-${externalAgentId}-${toNumber.replace(/\D/g, '').slice(-4)}`,
        accepted: true,
        message: 'Stub outbound accepted.',
      };
    },
  };
}
