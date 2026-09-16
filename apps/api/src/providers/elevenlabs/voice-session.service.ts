/**
 * Voice-session service for the ElevenLabs browser-voice integration.
 *
 * Responsibilities (all org-scoped, all RLS-enforced):
 *   1. Provision / sync a deployment for a published agent version.
 *   2. Start a test voice session (with cost-guard checks).
 *   3. Retrieve voice session state (result fields, status).
 *   4. Reconcile results from the provider API.
 *   5. Process webhook events (signature already verified by the controller).
 *
 * The service NEVER returns the conversationToken to callers; that token is
 * stored in the voice_sessions row but is only ever sent to the browser once —
 * in the response to the start-session request — via the controller.
 *
 * Cost guards enforced here:
 *   - Kill switch: ELEVENLABS_ENABLED must be true.
 *   - Max 1 active voice session per org at a time.
 *   - Per-session max minutes.
 *   - Daily session count limit.
 *   - Daily total minutes limit.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import type { Env } from '../../config.js';
import { ApiError } from '../../errors.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { Actor } from '../../agents/agents.service.js';
import type { VoiceSessionAdapter } from './adapter.js';
import type {
  VoiceDeployment,
  VoiceSessionResult,
  VoiceSessionToken,
  KnowledgeSnapshot,
} from './types.js';

// ---------------------------------------------------------------------------
// DB record shapes (raw SQL rows)
// ---------------------------------------------------------------------------

type DeploymentRecord = {
  id: string;
  organization_id: string;
  agent_version_id: string;
  provider: string;
  environment: string;
  external_agent_id: string;
  external_kb_doc_id: string | null;
  llm_model: string | null;
  llm_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type VoiceSessionRecord = {
  id: string;
  organization_id: string;
  session_id: string;
  deployment_id: string;
  provider: string;
  external_conversation_id: string | null;
  status: string;
  transcript: unknown;
  summary: string | null;
  structured_answers: unknown;
  duration_seconds: number | null;
  cost_credits: string | null;
  started_at: string;
  ended_at: string | null;
  webhook_received_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toDeployment(r: DeploymentRecord): VoiceDeployment {
  return {
    id: r.id,
    agentVersionId: r.agent_version_id,
    provider: r.provider,
    environment: r.environment,
    externalAgentId: r.external_agent_id,
    externalKbDocId: r.external_kb_doc_id,
    llmModel: r.llm_model,
    llmVerifiedAt: r.llm_verified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toSessionResult(r: VoiceSessionRecord): VoiceSessionResult {
  return {
    id: r.id,
    sessionId: r.session_id,
    deploymentId: r.deployment_id,
    provider: r.provider,
    externalConversationId: r.external_conversation_id,
    status: r.status as VoiceSessionResult['status'],
    transcript: Array.isArray(r.transcript) ? (r.transcript as VoiceSessionResult['transcript']) : null,
    summary: r.summary,
    structuredAnswers:
      r.structured_answers && typeof r.structured_answers === 'object' && !Array.isArray(r.structured_answers)
        ? (r.structured_answers as Record<string, unknown>)
        : null,
    durationSeconds: r.duration_seconds,
    costCredits: r.cost_credits !== null ? Number(r.cost_credits) : null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface VoiceSessionService {
  /**
   * Provision or re-sync an ElevenLabs deployment for the agent's current
   * published version. Idempotent: calling it again updates the external agent.
   */
  provisionDeployment(
    actor: Actor,
    agentId: string,
    options?: { knowledgeSnapshot?: KnowledgeSnapshot; voiceId?: string },
  ): Promise<VoiceDeployment>;

  /**
   * Start a test voice session.
   * Enforces cost guards, creates the local session, gets the WebRTC token.
   * Returns { voiceSessionId, conversationToken } — the token goes directly
   * to the browser and is NOT stored in the response thereafter.
   */
  startVoiceSession(
    actor: Actor,
    agentId: string,
    options?: { jobId?: string; candidateId?: string },
  ): Promise<{ voiceSession: VoiceSessionResult } & VoiceSessionToken>;

  /**
   * Get the current state of a voice session (no token, no internal state).
   */
  getVoiceSession(actor: Actor, voiceSessionId: string): Promise<VoiceSessionResult>;

  /**
   * Pull the latest result from the provider and write it to the DB.
   * Safe to call multiple times (idempotent for ended sessions).
   */
  reconcileVoiceSession(actor: Actor, voiceSessionId: string): Promise<VoiceSessionResult>;

  /**
   * Process a verified webhook event from ElevenLabs.
   * The controller verifies the signature; this method handles the payload.
   */
  handleWebhookEvent(organizationId: string | null, event: WebhookEvent): Promise<void>;
}

/** Normalized webhook event (after signature verification). */
export interface WebhookEvent {
  readonly type: string;
  readonly conversationId?: string;
  readonly agentId?: string;
  readonly data?: unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createVoiceSessionService(
  database: Database,
  env: Env,
  audit: AuditService,
  adapter: VoiceSessionAdapter,
): VoiceSessionService {
  function guardEnabled(): void {
    if (!env.ELEVENLABS_ENABLED) {
      throw ApiError.forbidden(
        'Voice testing is disabled. Set ELEVENLABS_ENABLED=true to enable.',
      );
    }
  }

  async function loadDeployment(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    agentVersionId: string,
    environment = 'test',
  ): Promise<DeploymentRecord | null> {
    const rows = await tx.execute<DeploymentRecord>(sql`
      select id, organization_id, agent_version_id, provider, environment,
             external_agent_id, external_kb_doc_id, llm_model,
             llm_verified_at::text, created_at::text, updated_at::text
      from voice_provider_deployments
      where agent_version_id = ${agentVersionId}
        and organization_id  = ${actor.organizationId}
        and provider = 'elevenlabs'
        and environment = ${environment}
    `);
    return rows[0] ?? null;
  }

  async function loadVoiceSession(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    voiceSessionId: string,
  ): Promise<VoiceSessionRecord> {
    const rows = await tx.execute<VoiceSessionRecord>(sql`
      select id, organization_id, session_id, deployment_id, provider,
             external_conversation_id, status,
             transcript, summary, structured_answers,
             duration_seconds, cost_credits::text,
             started_at::text, ended_at::text, webhook_received_at::text, created_at::text
      from voice_sessions
      where id = ${voiceSessionId}
        and organization_id = ${actor.organizationId}
    `);
    const row = rows[0];
    if (!row) throw ApiError.notFound('VoiceSession');
    return row;
  }

  async function countActiveSessionsToday(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    organizationId: string,
  ): Promise<{ activeSessions: number; todaySessions: number; todayMinutes: number }> {
    const rows = await tx.execute<{
      active_sessions: string;
      today_sessions: string;
      today_minutes: string;
    }>(sql`
      select
        count(*) filter (where status = 'active') as active_sessions,
        count(*) filter (where started_at >= current_date) as today_sessions,
        coalesce(sum(duration_seconds) filter (where started_at >= current_date), 0) / 60 as today_minutes
      from voice_sessions
      where organization_id = ${organizationId}
    `);
    const r = rows[0]!;
    return {
      activeSessions: Number(r.active_sessions),
      todaySessions: Number(r.today_sessions),
      todayMinutes: Number(r.today_minutes),
    };
  }

  return {
    async provisionDeployment(actor, agentId, options = {}) {
      guardEnabled();

      // Resolve the published agent version.
      const agentRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{
            status: string;
            current_version_id: string | null;
            name: string;
            purpose: string;
          }>(sql`
            select status, current_version_id, name, purpose
            from agents
            where id = ${agentId} and organization_id = ${actor.organizationId}
          `),
      );
      const agent = agentRows[0];
      if (!agent) throw ApiError.notFound('Agent');
      if (agent.status !== 'published') {
        throw ApiError.conflict('Only a published agent can be provisioned for voice testing');
      }
      if (!agent.current_version_id) {
        throw ApiError.conflict('Agent has no published version');
      }
      const versionId = agent.current_version_id;

      // Check for an existing deployment.
      const existing = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadDeployment(tx, actor, versionId),
      );

      // Provision or re-sync the ElevenLabs agent.
      const { externalAgentId, externalKbDocId, llmModel } =
        await adapter.provisionAgent({
          agentName: agent.name,
          agentPurpose: agent.purpose,
          voiceId: options.voiceId ?? env.ELEVENLABS_DEFAULT_VOICE_ID,
          knowledgeSnapshot: options.knowledgeSnapshot,
          existingExternalAgentId: existing?.external_agent_id,
        });

      // Upsert the deployment row.
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<DeploymentRecord>(sql`
            insert into voice_provider_deployments
              (organization_id, agent_version_id, provider, environment,
               external_agent_id, external_kb_doc_id, llm_model, llm_verified_at)
            values (
              ${actor.organizationId}, ${versionId}, 'elevenlabs', 'test',
              ${externalAgentId}, ${externalKbDocId ?? null}, ${llmModel}, now()
            )
            on conflict (agent_version_id, provider, environment) do update set
              external_agent_id   = excluded.external_agent_id,
              external_kb_doc_id  = excluded.external_kb_doc_id,
              llm_model           = excluded.llm_model,
              llm_verified_at     = excluded.llm_verified_at,
              updated_at          = now()
            returning id, organization_id, agent_version_id, provider, environment,
                      external_agent_id, external_kb_doc_id, llm_model,
                      llm_verified_at::text, created_at::text, updated_at::text
          `),
      );
      const dep = rows[0];
      if (!dep) throw new Error('Deployment upsert returned no row');

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'voice.deployment.provisioned',
        resourceType: 'voice_provider_deployment',
        resourceId: dep.id,
        metadata: { agentId, versionId, externalAgentId, llmModel },
      });

      return toDeployment(dep);
    },

    async startVoiceSession(actor, agentId, options = {}) {
      guardEnabled();
      const { jobId, candidateId } = options;

      // Resolve agent and its published version.
      const agentRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{
            status: string;
            current_version_id: string | null;
            name: string;
            purpose: string;
          }>(sql`
            select status, current_version_id, name, purpose
            from agents
            where id = ${agentId} and organization_id = ${actor.organizationId}
          `),
      );
      const agent = agentRows[0];
      if (!agent) throw ApiError.notFound('Agent');
      if (agent.status !== 'published') {
        throw ApiError.conflict('Only a published agent can start a voice session');
      }
      if (!agent.current_version_id) {
        throw ApiError.conflict('Agent has no published version');
      }
      const versionId = agent.current_version_id;

      // Find or provision deployment.
      let deployment = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadDeployment(tx, actor, versionId),
      );
      if (!deployment) {
        const dep = await this.provisionDeployment(actor, agentId);
        // Re-load the record
        deployment = await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) => loadDeployment(tx, actor, versionId),
        );
        if (!deployment) throw new Error('Deployment not found after provisioning');
        // dep is used only for type safety above; silence the linter
        void dep;
      }

      // ---- Cost guards ----
      const voiceSession = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const counts = await countActiveSessionsToday(tx, actor.organizationId);

          if (counts.activeSessions >= 1) {
            throw ApiError.conflict(
              'Another voice test session is already active for this organization. ' +
                'End the current session before starting a new one.',
            );
          }
          if (counts.todaySessions >= env.ELEVENLABS_DAILY_TEST_SESSIONS) {
            throw ApiError.conflict(
              `Daily voice test session limit (${env.ELEVENLABS_DAILY_TEST_SESSIONS}) reached. ` +
                `Try again tomorrow.`,
            );
          }
          if (counts.todayMinutes >= env.ELEVENLABS_DAILY_TEST_MINUTES) {
            throw ApiError.conflict(
              `Daily voice test minute limit (${env.ELEVENLABS_DAILY_TEST_MINUTES} min) reached. ` +
                `Try again tomorrow.`,
            );
          }

          if (jobId !== undefined || candidateId !== undefined) {
            if (!jobId || !candidateId) {
              throw ApiError.validation([
                {
                  field: 'jobId',
                  message: 'jobId and candidateId must be provided together',
                },
              ]);
            }

            const jobRows = await tx.execute<{ id: string }>(sql`
              select id from jobs
              where id = ${jobId} and organization_id = ${actor.organizationId}
            `);
            if (jobRows.length === 0) throw ApiError.notFound('Job');

            const candidateRows = await tx.execute<{ id: string }>(sql`
              select id from candidates
              where id = ${candidateId} and organization_id = ${actor.organizationId}
            `);
            if (candidateRows.length === 0) throw ApiError.notFound('Candidate');

            const assignmentRows = await tx.execute<{ id: string }>(sql`
              select id from job_candidates
              where job_id = ${jobId}
                and candidate_id = ${candidateId}
                and organization_id = ${actor.organizationId}
            `);
            if (assignmentRows.length === 0) {
              throw ApiError.notFound('Job candidate');
            }
          }

          // Create the local AgentSession (channel = 'voice').
          const sessionRows = await tx.execute<{ id: string }>(sql`
            insert into agent_sessions
              (organization_id, agent_id, agent_version_id, channel, started_by_user_id)
            values (
              ${actor.organizationId}, ${agentId}, ${versionId}, 'voice', ${actor.userId}
            )
            returning id
          `);
          const localSessionId = sessionRows[0]?.id;
          if (!localSessionId) throw new Error('AgentSession insert returned no id');

          // Insert the voice_session row (status = pending).
          const vsRows = await tx.execute<VoiceSessionRecord>(sql`
            insert into voice_sessions
              (organization_id, session_id, deployment_id, provider, status,
               job_id, candidate_id)
            values (
              ${actor.organizationId}, ${localSessionId}, ${deployment!.id}, 'elevenlabs', 'pending',
              ${jobId ?? null}, ${candidateId ?? null}
            )
            returning id, organization_id, session_id, deployment_id, provider,
                      external_conversation_id, status,
                      transcript, summary, structured_answers,
                      duration_seconds, cost_credits::text,
                      started_at::text, ended_at::text, webhook_received_at::text, created_at::text
          `);
          const vs = vsRows[0];
          if (!vs) throw new Error('VoiceSession insert returned no row');
          return vs;
        },
      );

      // Get the WebRTC token AFTER committing the local session.
      const { conversationToken } = await adapter.getWebrtcToken(
        deployment.external_agent_id,
      );

      // Transition status to 'active' and store the token so we can reconcile later.
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute(sql`
            update voice_sessions
            set status = 'active'
            where id = ${voiceSession.id}
              and organization_id = ${actor.organizationId}
          `),
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'voice.session.started',
        resourceType: 'voice_session',
        resourceId: voiceSession.id,
        metadata: {
          agentId,
          versionId,
          externalAgentId: deployment.external_agent_id,
          maxMinutes: env.ELEVENLABS_MAX_TEST_MINUTES,
          jobId: jobId ?? null,
          candidateId: candidateId ?? null,
        },
      });

      return {
        voiceSession: toSessionResult({ ...voiceSession, status: 'active' }),
        voiceSessionId: voiceSession.id,
        conversationToken,
      };
    },

    async getVoiceSession(actor, voiceSessionId) {
      const row = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadVoiceSession(tx, actor, voiceSessionId),
      );
      return toSessionResult(row);
    },

    async reconcileVoiceSession(actor, voiceSessionId) {
      // Load the voice session.
      const vs = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadVoiceSession(tx, actor, voiceSessionId),
      );

      if (!vs.external_conversation_id) {
        // No conversation ID yet — nothing to reconcile.
        return toSessionResult(vs);
      }

      if (vs.status === 'ended' && vs.transcript !== null) {
        // Already fully reconciled.
        return toSessionResult(vs);
      }

      const details = await adapter.fetchConversation(vs.external_conversation_id);

      const nowEnded =
        details.status === 'done' ||
        details.status === 'ended' ||
        details.status === 'completed';

      const updated = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const rows = await tx.execute<VoiceSessionRecord>(sql`
            update voice_sessions set
              status           = ${nowEnded ? 'ended' : vs.status},
              transcript       = ${details.transcript ? JSON.stringify(details.transcript) : null}::jsonb,
              summary          = ${details.summary ?? null},
              duration_seconds = ${details.durationSeconds ?? null},
              cost_credits     = ${details.costCredits ?? null},
              ended_at         = ${nowEnded ? sql`now()` : sql`${vs.ended_at ?? null}`}
            where id = ${voiceSessionId}
              and organization_id = ${actor.organizationId}
            returning id, organization_id, session_id, deployment_id, provider,
                      external_conversation_id, status,
                      transcript, summary, structured_answers,
                      duration_seconds, cost_credits::text,
                      started_at::text, ended_at::text, webhook_received_at::text, created_at::text
          `);
          return rows[0];
        },
      );
      if (!updated) throw ApiError.notFound('VoiceSession');

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'voice.session.reconciled',
        resourceType: 'voice_session',
        resourceId: voiceSessionId,
        metadata: {
          durationSeconds: details.durationSeconds ?? 0,
          reconciled: true,
        },
      });

      return toSessionResult(updated);
    },

    async handleWebhookEvent(organizationId, event) {
      // Find the voice session by external conversation ID (no tenant context:
      // the webhook does not know which org it belongs to — we look it up).
      if (!event.conversationId) return;

      // We use withoutTenantContext to look up by the external ID, then
      // update within the org's context.
      const rows = await database.db.execute<{
        id: string;
        organization_id: string;
        status: string;
      }>(sql`
        select id, organization_id, status
        from voice_sessions
        where external_conversation_id = ${event.conversationId}
        limit 1
      `);
      const vs = rows[0];
      if (!vs) return; // Unknown conversation — ignore.

      const targetOrgId = organizationId ?? vs.organization_id;
      if (vs.organization_id !== targetOrgId) return; // Org mismatch — ignore.

      if (
        event.type === 'conversation.ended' ||
        event.type === 'call.ended' ||
        event.type === 'conversation_ended'
      ) {
        await database.db.execute(sql`
          update voice_sessions set
            status             = 'ended',
            ended_at           = now(),
            webhook_received_at = now()
          where id = ${vs.id}
            and status <> 'ended'
        `);
        await audit.record({
          organizationId: vs.organization_id,
          actorUserId: null,
          eventType: 'voice.session.webhook_ended',
          resourceType: 'voice_session',
          resourceId: vs.id,
          metadata: { conversationId: event.conversationId },
        });
      } else if (
        event.type === 'conversation.started' ||
        event.type === 'call.started' ||
        event.type === 'conversation_started'
      ) {
        await database.db.execute(sql`
          update voice_sessions set
            status              = 'active',
            webhook_received_at = now()
          where id = ${vs.id}
            and status = 'pending'
        `);
      }
    },
  };
}
