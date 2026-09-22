/**
 * Voice provider deployment and session tables (MVP-01 ElevenLabs).
 *
 * STRUCTURE:
 *   voice_provider_deployments  — maps an AgentVersion to an externally-managed
 *                                 agent + knowledge document at a named provider.
 *                                 Re-provisioning is idempotent via upsert on the
 *                                 unique (agent_version_id, provider, environment) index.
 *
 *   voice_sessions              — maps a local AgentSession to a provider conversation.
 *                                 Holds cost-guard state (status, duration, cost)
 *                                 and reconcilable result fields (transcript, summary,
 *                                 structured_answers).
 *
 * Both tables carry standard tenant RLS (ENABLE + FORCE, same posture as all
 * prior phases). Neither is exempt.
 */

import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { agentVersions } from './agents.js';
import { jobs, candidates } from './hiring.js';

export const voiceProviderDeployments = pgTable(
  'voice_provider_deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentVersionId: uuid('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'restrict' }),
    /** The provider this deployment belongs to. Only 'elevenlabs' for MVP-01. */
    provider: text('provider').notNull().default('elevenlabs'),
    /** 'test' for the test environment; 'production' reserved for later. */
    environment: text('environment').notNull().default('test'),
    /** ElevenLabs conversational-AI agent ID. */
    externalAgentId: text('external_agent_id').notNull(),
    /** ElevenLabs knowledge-base document ID synced to this deployment. */
    externalKbDocId: text('external_kb_doc_id'),
    /** The LLM model slug verified at provision time (e.g. 'gemini-flash-lite'). */
    llmModel: text('llm_model'),
    /** When the LLM availability was last confirmed. NULL = never confirmed. */
    llmVerifiedAt: timestamp('llm_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vpd_version_provider_env_unique').on(
      t.agentVersionId,
      t.provider,
      t.environment,
    ),
    index('vpd_org_agent_version_idx').on(t.organizationId, t.agentVersionId),
  ],
);

export const voiceSessions = pgTable(
  'voice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The local AgentSession this voice session is attached to. */
    sessionId: uuid('session_id').notNull(),
    /** The deployment that was used. */
    deploymentId: uuid('deployment_id').notNull(),
    /** Optional hiring-desk link for screening result review. */
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    candidateId: uuid('candidate_id').references(() => candidates.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull().default('elevenlabs'),
    /** Provider-side conversation ID. NULL until the session actually starts. */
    externalConversationId: text('external_conversation_id'),
    /**
     * Lifecycle: pending → active → ended | failed.
     * 'pending' = created locally but WebRTC handshake not yet complete.
     * 'active'  = WebRTC connected, conversation in progress.
     * 'ended'   = call ended normally; results may or may not be available yet.
     * 'failed'  = error before or during the call.
     */
    status: text('status').notNull().default('pending'),
    /** Full turn-by-turn transcript, as returned by the provider. */
    transcript: jsonb('transcript'),
    /** One-paragraph summary of the conversation. */
    summary: text('summary'),
    /** Structured key-value answers extracted by the agent, if any. */
    structuredAnswers: jsonb('structured_answers'),
    /**
     * Immutable provision config frozen at call start (PO Q2=B).
     * Captures job/agent criteria, language, knowledge ids, and prompt fields
     * actually used for this call so later Job/Agent edits cannot rewrite history.
     */
    provisionSnapshot: jsonb('provision_snapshot'),
    /** Call duration in whole seconds. NULL until the call ends. */
    durationSeconds: integer('duration_seconds'),
    /**
     * Provider-reported cost in their credit unit. Deliberately nullable —
     * cost is an observation, not a guarantee, and may arrive via webhook
     * after the call ends.
     */
    costCredits: numeric('cost_credits', { precision: 12, scale: 6 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    webhookReceivedAt: timestamp('webhook_received_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vs_session_unique').on(t.sessionId),
    index('vs_org_status_idx').on(t.organizationId, t.status),
    index('vs_org_started_idx').on(t.organizationId, t.startedAt),
    index('vs_org_job_candidate_idx').on(
      t.organizationId,
      t.jobId,
      t.candidateId,
    ),
  ],
);
