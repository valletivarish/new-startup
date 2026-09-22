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
import { AgentConfiguration } from '../../agents/configuration.js';
import type { VoiceSessionAdapter } from './adapter.js';
import type {
  VoiceDeployment,
  VoiceSessionResult,
  VoiceSessionToken,
  KnowledgeSnapshot,
  VoiceProvisionSnapshot,
} from './types.js';
import { toE164Phone } from './phone-e164.js';
import { buildVoiceProvisionConfig } from './provision-config.js';
import { buildVoiceProvisionSnapshot } from './provision-snapshot.js';

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
  job_id?: string | null;
  candidate_id?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  job_title?: string | null;
  candidate_name?: string | null;
  session_channel?: string | null;
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
    jobId: r.job_id ?? null,
    candidateId: r.candidate_id ?? null,
    agentId: r.agent_id ?? null,
    agentName: r.agent_name ?? null,
    jobTitle: r.job_title ?? null,
    candidateName: r.candidate_name ?? null,
    channel: r.session_channel === 'phone' ? 'phone' : 'browser_demo',
  };
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface VoiceSessionService {
  /**
   * Provision or re-sync an ElevenLabs deployment for the agent's current
   * published version. Idempotent: calling it again updates the external agent.
   * Also returns the provision snapshot that should be frozen onto any
   * VoiceSession started with this provision outcome.
   */
  provisionDeployment(
    actor: Actor,
    agentId: string,
    options?: {
      knowledgeSnapshot?: KnowledgeSnapshot;
      voiceId?: string;
      /** When set, auto-resolve Job JD + must-ask (no picker at call time). */
      jobId?: string;
    },
  ): Promise<{
    deployment: VoiceDeployment;
    provisionSnapshot: VoiceProvisionSnapshot;
  }>;

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
   * Place a live outbound phone screen for a job/candidate pair.
   * Requires outbound phone configuration; never pretends success when blocked.
   */
  startOutboundPhoneCall(
    actor: Actor,
    agentId: string,
    options: { jobId: string; candidateId: string },
  ): Promise<{ voiceSessionId: string; voiceSession: VoiceSessionResult }>;

  /** Whether live outbound dialing is configured for this deployment. */
  isOutboundConfigured(): boolean;

  /**
   * True when the operator has confirmed carrier business verification
   * unlocks any-resume dialing (TELEPHONY_OPEN_OUTBOUND=true).
   */
  isOpenOutbound(): boolean;

  /**
   * Get the current state of a voice session (no token, no internal state).
   */
  getVoiceSession(actor: Actor, voiceSessionId: string): Promise<VoiceSessionResult>;

  /** Recent voice sessions for the company desk (Calls page). */
  listVoiceSessions(
    actor: Actor,
    options?: { limit?: number; candidateId?: string },
  ): Promise<readonly VoiceSessionResult[]>;

  /**
   * Pull the latest result from the provider and write it to the DB.
   * Safe to call multiple times (idempotent for ended sessions).
   */
  reconcileVoiceSession(actor: Actor, voiceSessionId: string): Promise<VoiceSessionResult>;

  /**
   * Mark an active/pending voice session ended so another screen can start.
   * Idempotent when already ended/failed.
   */
  endVoiceSession(actor: Actor, voiceSessionId: string): Promise<VoiceSessionResult>;

  /**
   * Stream the call recording for a voice session (provider audio bytes).
   * Requires an external conversation id; throws notFound when missing.
   */
  getVoiceSessionRecording(
    actor: Actor,
    voiceSessionId: string,
  ): Promise<{ body: Buffer; contentType: string }>;

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
      select vs.id, vs.organization_id, vs.session_id, vs.deployment_id, vs.provider,
             vs.external_conversation_id, vs.status,
             vs.transcript, vs.summary, vs.structured_answers,
             vs.duration_seconds, vs.cost_credits::text,
             vs.started_at::text, vs.ended_at::text, vs.webhook_received_at::text, vs.created_at::text,
             vs.job_id, vs.candidate_id,
             s.agent_id,
             s.channel as session_channel,
             a.name as agent_name,
             j.title as job_title,
             c.full_name as candidate_name
      from voice_sessions vs
      left join agent_sessions s on s.id = vs.session_id
      left join agents a on a.id = s.agent_id
      left join jobs j on j.id = vs.job_id
      left join candidates c on c.id = vs.candidate_id
      where vs.id = ${voiceSessionId}
        and vs.organization_id = ${actor.organizationId}
    `);
    const row = rows[0];
    if (!row) throw ApiError.notFound('VoiceSession');
    return row;
  }

  async function expireStaleVoiceSessions(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    organizationId: string,
  ): Promise<void> {
    const browserGraceMins = env.ELEVENLABS_MAX_TEST_MINUTES + 5;
    const phoneGraceMins = env.ELEVENLABS_MAX_PHONE_MINUTES + 10;
    await tx.execute(sql`
      update voice_sessions vs
      set
        status = 'ended',
        ended_at = coalesce(vs.ended_at, now())
      from agent_sessions s
      where vs.session_id = s.id
        and vs.organization_id = ${organizationId}
        and vs.status in ('active', 'pending')
        and (
          (
            s.channel = 'browser'
            and vs.started_at < now() - make_interval(mins => ${browserGraceMins})
          )
          or (
            s.channel = 'phone'
            and vs.started_at < now() - make_interval(mins => ${phoneGraceMins})
          )
        )
    `);
  }

  async function countVoiceUsage(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    organizationId: string,
  ): Promise<{
    activeBrowser: number;
    activePhone: number;
    todayBrowser: number;
    todayPhone: number;
    todayBrowserMinutes: number;
  }> {
    await expireStaleVoiceSessions(tx, organizationId);
    const rows = await tx.execute<{
      active_browser: string;
      active_phone: string;
      today_browser: string;
      today_phone: string;
      today_browser_minutes: string;
    }>(sql`
      select
        count(*) filter (
          where vs.status in ('active', 'pending') and s.channel = 'browser'
        ) as active_browser,
        count(*) filter (
          where vs.status in ('active', 'pending') and s.channel = 'phone'
        ) as active_phone,
        count(*) filter (
          where vs.started_at >= current_date and s.channel = 'browser'
        ) as today_browser,
        count(*) filter (
          where vs.started_at >= current_date and s.channel = 'phone'
        ) as today_phone,
        coalesce(
          sum(vs.duration_seconds) filter (
            where vs.started_at >= current_date and s.channel = 'browser'
          ),
          0
        ) / 60 as today_browser_minutes
      from voice_sessions vs
      join agent_sessions s on s.id = vs.session_id
      where vs.organization_id = ${organizationId}
    `);
    const r = rows[0]!;
    return {
      activeBrowser: Number(r.active_browser),
      activePhone: Number(r.active_phone),
      todayBrowser: Number(r.today_browser),
      todayPhone: Number(r.today_phone),
      todayBrowserMinutes: Number(r.today_browser_minutes),
    };
  }

  const service: VoiceSessionService = {
    async provisionDeployment(actor, agentId, options = {}) {
      guardEnabled();

      // Resolve the published agent version + its evaluation criteria.
      const agentRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{
            status: string;
            current_version_id: string | null;
            name: string;
            purpose: string;
            type: string;
          }>(sql`
            select status, current_version_id, name, purpose, type
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

      const versionRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{ configuration: unknown }>(sql`
            select configuration
            from agent_versions
            where id = ${versionId}
              and organization_id = ${actor.organizationId}
          `),
      );
      const versionConfig = AgentConfiguration.safeParse(versionRows[0]?.configuration);
      const agentCriteria = versionConfig.success
        ? versionConfig.data.evaluation.criteria
        : [];
      const agentType =
        versionConfig.success ? versionConfig.data.agentType : agent.type;
      const transferPhones = versionConfig.success
        ? versionConfig.data.escalation.transferPhones
        : [];
      const configKnowledgeIds = versionConfig.success
        ? versionConfig.data.knowledge
            .map((k) => k.knowledgeSourceId)
            .filter((id) => typeof id === 'string' && id.length > 0)
        : [];
      const displayName = versionConfig.success
        ? versionConfig.data.identity.displayName
        : agent.name;
      const greeting = versionConfig.success
        ? versionConfig.data.conversation.greeting
        : '';
      let primaryLanguage = versionConfig.success
        ? versionConfig.data.identity.primaryLanguage
        : 'en-IN';

      const orgNameRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{ name: string }>(sql`
            select name
            from organizations
            where id = ${actor.organizationId}
          `),
      );
      const organizationName = (orgNameRows[0]?.name ?? '').trim();

      // Agent knowledge (compat / browser demo without job).
      const agentAttachedRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{ source_id: string }>(sql`
            select a.source_id
            from agent_knowledge_sources a
            join knowledge_sources s
              on s.id = a.source_id and s.organization_id = a.organization_id
            where a.agent_id = ${agentId}
              and a.organization_id = ${actor.organizationId}
              and s.status <> 'archived'
          `),
      );
      const agentKnowledgeSourceIds = [
        ...new Set([
          ...agentAttachedRows.map((r) => r.source_id),
          ...configKnowledgeIds,
        ]),
      ];

      let evaluationCriteria = agentCriteria;
      let knowledgeSourceIds = agentKnowledgeSourceIds;
      let usedJobScreening = false;

      // Job owns JD + must-ask. Call/provision auto-resolves from jobId —
      // never ask HR to pick JD again at call time.
      const jobId = options.jobId;
      if (jobId) {
        const jobCtx = await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) => {
            const jobs = await tx.execute<{
              screening_questions: unknown;
              screening_language: string;
            }>(sql`
              select screening_questions, screening_language
              from jobs
              where id = ${jobId} and organization_id = ${actor.organizationId}
            `);
            const job = jobs[0];
            if (!job) return null;

            const jobKnowledge = await tx.execute<{ source_id: string }>(sql`
              select j.source_id
              from job_knowledge_sources j
              join knowledge_sources s
                on s.id = j.source_id and s.organization_id = j.organization_id
              where j.job_id = ${jobId}
                and j.organization_id = ${actor.organizationId}
                and s.status <> 'archived'
            `);

            const questions: { id: string; label: string; required: boolean }[] =
              [];
            if (Array.isArray(job.screening_questions)) {
              for (const item of job.screening_questions) {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                  continue;
                }
                const row = item as Record<string, unknown>;
                const id = typeof row.id === 'string' ? row.id.trim() : '';
                const label =
                  typeof row.label === 'string' ? row.label.trim() : '';
                if (id && label) {
                  questions.push({ id, label, required: true });
                }
              }
            }

            return {
              questions,
              language: job.screening_language,
              knowledgeSourceIds: jobKnowledge.map((r) => r.source_id),
            };
          },
        );

        if (jobCtx) {
          const hasJobQuestions = jobCtx.questions.length > 0;
          const hasJobKnowledge = jobCtx.knowledgeSourceIds.length > 0;
          if (hasJobQuestions || hasJobKnowledge) {
            usedJobScreening = true;
            if (hasJobQuestions) {
              evaluationCriteria = jobCtx.questions;
            }
            if (hasJobKnowledge) {
              knowledgeSourceIds = jobCtx.knowledgeSourceIds;
            }
            if (jobCtx.language === 'hi') {
              primaryLanguage = 'hi';
            } else if (jobCtx.language === 'en') {
              primaryLanguage = 'en-IN';
            }
          }
        }

        if (!usedJobScreening) {
          // Compat: empty job screening falls back to agent config.
          await audit.record({
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            eventType: 'hiring.screening.fallback_agent',
            resourceType: 'job',
            resourceId: jobId,
            metadata: { agentId, reason: 'empty_job_screening' },
          });
        }
      }

      // Prefer an explicit snapshot from the caller; else pull live chunks
      // from Job (or agent) knowledge so JD/docs reach the phone agent.
      let knowledgeSnapshot = options.knowledgeSnapshot;
      if (!knowledgeSnapshot && knowledgeSourceIds.length > 0) {
        const chunkRows = await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) =>
            tx.execute<{ content: string; document_name: string }>(sql`
              select c.content, d.name as document_name
              from knowledge_chunks c
              join knowledge_documents d
                on d.id = c.document_id
               and d.organization_id = c.organization_id
              where c.organization_id = ${actor.organizationId}
                and d.status = 'ready'
                and d.indexed_version = c.document_version
                and c.source_id in (${sql.join(
                  knowledgeSourceIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})
              order by d.name, c.chunk_index
              limit 80
            `),
        );
        if (chunkRows.length > 0) {
          const parts: string[] = [];
          let total = 0;
          const maxChars = 40_000;
          for (const row of chunkRows) {
            const block = `## ${row.document_name}\n${row.content.trim()}`;
            if (total + block.length > maxChars) break;
            parts.push(block);
            total += block.length;
          }
          if (parts.length > 0) {
            knowledgeSnapshot = {
              name: usedJobScreening
                ? 'Job screening docs'
                : `${agent.name} screening docs`,
              content: parts.join('\n\n'),
            };
          }
        }
      }

      // Check for an existing deployment.
      const existing = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadDeployment(tx, actor, versionId),
      );

      const voiceId =
        (options.voiceId ?? env.ELEVENLABS_DEFAULT_VOICE_ID)?.trim() || null;
      const provisionFields = buildVoiceProvisionConfig({
        agentPurpose: agent.purpose,
        criteria: evaluationCriteria,
        agentType,
        transferPhones,
        displayName,
        organizationName,
        greeting,
        primaryLanguage,
      });
      const snapshotTransferPhones =
        provisionFields.builtInTools.transferToNumber?.params.transfers.map(
          (t) => t.transferDestination.phoneNumber,
        ) ?? [];

      // Provision or re-sync the voice agent (prompt + data_collection + tools).
      const { externalAgentId, externalKbDocId, llmModel } =
        await adapter.provisionAgent({
          agentName: agent.name,
          agentPurpose: agent.purpose,
          voiceId: voiceId ?? undefined,
          knowledgeSnapshot,
          existingExternalAgentId: existing?.external_agent_id,
          evaluationCriteria,
          agentType,
          maxDurationSeconds:
            Math.max(env.ELEVENLABS_MAX_TEST_MINUTES, env.ELEVENLABS_MAX_PHONE_MINUTES) *
            60,
          transferPhones,
          displayName,
          organizationName,
          greeting,
          primaryLanguage,
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

      const screeningLanguage =
        primaryLanguage.toLowerCase().startsWith('hi') ? 'hi' : 'en';

      const provisionSnapshot = buildVoiceProvisionSnapshot({
        jobId: jobId ?? null,
        agentId,
        agentVersionId: versionId,
        usedJobScreening,
        evaluationCriteria,
        screeningLanguage,
        knowledgeSourceIds,
        knowledgeSnapshot: knowledgeSnapshot ?? null,
        agentPrompt: provisionFields.agentPrompt,
        firstMessage: provisionFields.firstMessage,
        transferPhones: snapshotTransferPhones,
        voiceId,
      });

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'voice.deployment.provisioned',
        resourceType: 'voice_provider_deployment',
        resourceId: dep.id,
        metadata: {
          agentId,
          versionId,
          externalAgentId,
          llmModel,
          ...(jobId
            ? {
                jobId,
                usedJobScreening,
                usedAgentFallback: provisionSnapshot.usedAgentFallback,
              }
            : {}),
        },
      });

      return {
        deployment: toDeployment(dep),
        provisionSnapshot,
      };
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

      // Always re-sync deployment so job/agent must-ask → data_collection stays current.
      const { deployment: provisioned, provisionSnapshot } =
        await this.provisionDeployment(actor, agentId, { jobId });
      const deployment = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadDeployment(tx, actor, versionId),
      );
      if (!deployment) throw new Error('Deployment not found after provisioning');
      // Prefer the freshly upserted row; fall back to reload if ids diverge.
      const deploymentId = provisioned.id || deployment.id;
      const snapshotJson = JSON.stringify(provisionSnapshot);

      // ---- Cost guards ----
      const voiceSession = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const counts = await countVoiceUsage(tx, actor.organizationId);

          if (counts.activeBrowser >= 1) {
            throw ApiError.conflict(
              'Another browser demo is already active for this company. ' +
                'End the current session before starting a new one.',
            );
          }
          if (counts.todayBrowser >= env.ELEVENLABS_DAILY_TEST_SESSIONS) {
            throw ApiError.conflict(
              `Daily browser demo limit (${env.ELEVENLABS_DAILY_TEST_SESSIONS}) reached. ` +
                `Try again tomorrow.`,
            );
          }
          if (counts.todayBrowserMinutes >= env.ELEVENLABS_DAILY_TEST_MINUTES) {
            throw ApiError.conflict(
              `Daily browser demo minute limit (${env.ELEVENLABS_DAILY_TEST_MINUTES} min) reached. ` +
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
              where id = ${candidateId}
                and job_id = ${jobId}
                and organization_id = ${actor.organizationId}
            `);
            if (candidateRows.length === 0) {
              throw ApiError.notFound('Job candidate');
            }
          }

          const sessionRows = await tx.execute<{ id: string }>(sql`
            insert into agent_sessions
              (organization_id, agent_id, agent_version_id, channel, started_by_user_id)
            values (
              ${actor.organizationId}, ${agentId}, ${versionId}, 'browser', ${actor.userId}
            )
            returning id
          `);
          const localSessionId = sessionRows[0]?.id;
          if (!localSessionId) throw new Error('AgentSession insert returned no id');

          // Insert the voice_session row (status = pending) with frozen provision snapshot.
          const vsRows = await tx.execute<VoiceSessionRecord>(sql`
            insert into voice_sessions
              (organization_id, session_id, deployment_id, provider, status,
               job_id, candidate_id, provision_snapshot)
            values (
              ${actor.organizationId}, ${localSessionId}, ${deploymentId}, 'elevenlabs', 'pending',
              ${jobId ?? null}, ${candidateId ?? null}, ${snapshotJson}::jsonb
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
      let conversationToken: string;
      try {
        const token = await adapter.getWebrtcToken(deployment.external_agent_id);
        conversationToken = token.conversationToken;
      } catch (err) {
        await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) =>
            tx.execute(sql`
              update voice_sessions
              set status = 'failed', ended_at = now()
              where id = ${voiceSession.id}
                and organization_id = ${actor.organizationId}
            `),
        );
        if (err instanceof ApiError) throw err;
        throw ApiError.conflict(
          'Could not start the browser voice session. Check that voice is enabled, then try again.',
        );
      }

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

    isOutboundConfigured() {
      return adapter.isOutboundConfigured();
    },

    isOpenOutbound() {
      return Boolean(env.TELEPHONY_OPEN_OUTBOUND);
    },

    async startOutboundPhoneCall(actor, agentId, options) {
      guardEnabled();
      if (!adapter.isOutboundConfigured()) {
        throw ApiError.conflict(
          'Live phone calling is not connected for this company yet. Use a browser screen for now, or ask us to connect a phone line.',
        );
      }

      const { jobId, candidateId } = options;

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
      if (agent.status !== 'published' || !agent.current_version_id) {
        throw ApiError.conflict('Publish the hiring agent before placing a phone call.');
      }
      const versionId = agent.current_version_id;

      // Always re-sync so data_collection matches job (or agent) must-ask questions.
      let provisioned;
      let provisionSnapshot: VoiceProvisionSnapshot;
      try {
        const result = await this.provisionDeployment(actor, agentId, { jobId });
        provisioned = result.deployment;
        provisionSnapshot = result.provisionSnapshot;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw ApiError.conflict(
          'Could not prepare the phone line for this agent. Publish again, wait a moment, then retry Call phone.',
        );
      }
      const deployment = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadDeployment(tx, actor, versionId),
      );
      if (!deployment) {
        throw ApiError.conflict(
          'Phone line is not ready for this agent yet. Publish the agent, then try Call phone again.',
        );
      }
      const deploymentId = provisioned.id || deployment.id;
      const snapshotJson = JSON.stringify(provisionSnapshot);

      const prepared = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const counts = await countVoiceUsage(tx, actor.organizationId);
          if (counts.activePhone >= env.ELEVENLABS_MAX_CONCURRENT_PHONE) {
            throw ApiError.conflict(
              `This company already has ${env.ELEVENLABS_MAX_CONCURRENT_PHONE} live phone screens in progress. End one on Calls before starting another.`,
            );
          }
          if (counts.todayPhone >= env.ELEVENLABS_DAILY_PHONE_SESSIONS) {
            throw ApiError.conflict(
              `Daily live phone screen limit (${env.ELEVENLABS_DAILY_PHONE_SESSIONS}) reached. Try again tomorrow.`,
            );
          }

          const jobRows = await tx.execute<{ id: string; agent_id: string | null }>(sql`
            select id, agent_id from jobs
            where id = ${jobId} and organization_id = ${actor.organizationId}
          `);
          const job = jobRows[0];
          if (!job) throw ApiError.notFound('Job');
          if (job.agent_id && job.agent_id !== agentId) {
            throw ApiError.conflict('This job is linked to a different hiring agent.');
          }

          const candidateRows = await tx.execute<{ id: string; phone: string | null }>(sql`
            select id, phone from candidates
            where id = ${candidateId}
              and job_id = ${jobId}
              and organization_id = ${actor.organizationId}
            for update
          `);
          const candidate = candidateRows[0];
          if (!candidate) throw ApiError.notFound('Job candidate');
          if (!candidate.phone) {
            throw ApiError.validation([
              {
                field: 'phone',
                message: 'Add a phone number for this candidate before placing a call.',
              },
            ]);
          }
          const e164 = toE164Phone(candidate.phone);
          if (!e164) {
            throw ApiError.validation([
              {
                field: 'phone',
                message: 'Candidate phone must be a valid mobile number (India 10-digit or +91…).',
              },
            ]);
          }

          const liveForCandidate = await tx.execute<{ id: string }>(sql`
            select vs.id
            from voice_sessions vs
            join agent_sessions s on s.id = vs.session_id
            where vs.organization_id = ${actor.organizationId}
              and vs.candidate_id = ${candidateId}
              and vs.status in ('pending', 'active')
              and s.channel = 'phone'
            limit 1
          `);
          if (liveForCandidate.length > 0) {
            throw ApiError.conflict(
              'A live phone screen is already in progress for this candidate. Wait for it to finish, or end it on Calls.',
            );
          }

          const sessionRows = await tx.execute<{ id: string }>(sql`
            insert into agent_sessions
              (organization_id, agent_id, agent_version_id, channel, started_by_user_id)
            values (
              ${actor.organizationId}, ${agentId}, ${versionId}, 'phone', ${actor.userId}
            )
            returning id
          `);
          const localSessionId = sessionRows[0]?.id;
          if (!localSessionId) throw new Error('AgentSession insert returned no id');

          const vsRows = await tx.execute<VoiceSessionRecord>(sql`
            insert into voice_sessions
              (organization_id, session_id, deployment_id, provider, status,
               job_id, candidate_id, provision_snapshot)
            values (
              ${actor.organizationId}, ${localSessionId}, ${deploymentId}, 'elevenlabs', 'pending',
              ${jobId}, ${candidateId}, ${snapshotJson}::jsonb
            )
            returning id, organization_id, session_id, deployment_id, provider,
                      external_conversation_id, status,
                      transcript, summary, structured_answers,
                      duration_seconds, cost_credits::text,
                      started_at::text, ended_at::text, webhook_received_at::text, created_at::text,
                      job_id, candidate_id
          `);
          const vs = vsRows[0];
          if (!vs) throw new Error('VoiceSession insert returned no row');
          return { vs, e164 };
        },
      );

      let dial;
      try {
        dial = await adapter.startOutboundPhoneCall({
          externalAgentId: deployment.external_agent_id,
          toNumber: prepared.e164,
        });
      } catch (err) {
        await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) =>
            tx.execute(sql`
              update voice_sessions
              set status = 'failed', ended_at = now()
              where id = ${prepared.vs.id}
                and organization_id = ${actor.organizationId}
            `),
        );
        throw err;
      }

      if (!dial.accepted) {
        await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) =>
            tx.execute(sql`
              update voice_sessions
              set status = 'failed', ended_at = now()
              where id = ${prepared.vs.id}
                and organization_id = ${actor.organizationId}
            `),
        );
        await audit.record({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          eventType: 'voice.session.outbound_failed',
          resourceType: 'voice_session',
          resourceId: prepared.vs.id,
          metadata: {
            agentId,
            jobId,
            candidateId,
            channel: 'phone',
            reason: dial.message || 'dial_not_accepted',
          },
        });
        throw ApiError.conflict(
          dial.message ||
            'The phone call could not be started. Check the phone line setup and try again.',
        );
      }

      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute(sql`
            update voice_sessions
            set status = 'active',
                external_conversation_id = ${dial.externalConversationId}
            where id = ${prepared.vs.id}
              and organization_id = ${actor.organizationId}
          `),
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'voice.session.outbound_started',
        resourceType: 'voice_session',
        resourceId: prepared.vs.id,
        metadata: {
          agentId,
          jobId,
          candidateId,
          channel: 'phone',
        },
      });

      return {
        voiceSessionId: prepared.vs.id,
        voiceSession: toSessionResult({
          ...prepared.vs,
          status: 'active',
          external_conversation_id: dial.externalConversationId,
          job_id: jobId,
          candidate_id: candidateId,
          // Outbound inserts agent_sessions.channel='phone'; include it so
          // the immediate response does not look like a browser demo.
          session_channel: 'phone',
        }),
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

    async listVoiceSessions(actor, options = {}) {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
      const candidateId = options.candidateId;
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<VoiceSessionRecord>(sql`
            select vs.id, vs.organization_id, vs.session_id, vs.deployment_id, vs.provider,
                   vs.external_conversation_id, vs.status,
                   vs.transcript, vs.summary, vs.structured_answers,
                   vs.duration_seconds, vs.cost_credits::text,
                   vs.started_at::text, vs.ended_at::text, vs.webhook_received_at::text, vs.created_at::text,
                   vs.job_id, vs.candidate_id,
                   s.agent_id,
                   s.channel as session_channel,
                   a.name as agent_name,
                   j.title as job_title,
                   c.full_name as candidate_name
            from voice_sessions vs
            left join agent_sessions s on s.id = vs.session_id
            left join agents a on a.id = s.agent_id
            left join jobs j on j.id = vs.job_id
            left join candidates c on c.id = vs.candidate_id
            where vs.organization_id = ${actor.organizationId}
              ${
                candidateId
                  ? sql`and vs.candidate_id = ${candidateId}`
                  : sql``
              }
            order by vs.started_at desc
            limit ${limit}
          `),
      );
      return rows.map(toSessionResult);
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

      const hasAnswers =
        vs.structured_answers !== null &&
        typeof vs.structured_answers === 'object' &&
        !Array.isArray(vs.structured_answers) &&
        Object.keys(vs.structured_answers as Record<string, unknown>).length > 0;

      // Fully reconciled: ended with transcript + summary, and either answers
      // arrived or the post-call webhook already ran (no answers expected).
      if (
        vs.status === 'ended' &&
        vs.transcript !== null &&
        vs.summary !== null &&
        (hasAnswers || vs.webhook_received_at !== null)
      ) {
        return toSessionResult(vs);
      }

      const details = await adapter.fetchConversation(vs.external_conversation_id);

      const nowEnded =
        details.status === 'done' ||
        details.status === 'ended' ||
        details.status === 'completed';

      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await tx.execute(sql`
            update voice_sessions set
              status           = ${nowEnded ? 'ended' : vs.status},
              transcript       = coalesce(
                ${details.transcript ? JSON.stringify(details.transcript) : null}::jsonb,
                transcript
              ),
              summary          = coalesce(${details.summary ?? null}, summary),
              structured_answers = coalesce(
                ${
                  details.structuredAnswers
                    ? JSON.stringify(details.structuredAnswers)
                    : null
                }::jsonb,
                structured_answers
              ),
              duration_seconds = coalesce(${details.durationSeconds}, duration_seconds),
              cost_credits     = coalesce(${details.costCredits}, cost_credits),
              ended_at         = ${nowEnded ? sql`coalesce(ended_at, now())` : sql`ended_at`}
            where id = ${voiceSessionId}
              and organization_id = ${actor.organizationId}
          `);
        },
      );

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

      // Reload with joins so channel / names stay correct on the Calls desk.
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => toSessionResult(await loadVoiceSession(tx, actor, voiceSessionId)),
      );
    },

    async endVoiceSession(actor, voiceSessionId) {
      const updated = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const existing = await loadVoiceSession(tx, actor, voiceSessionId);
          if (existing.status === 'ended' || existing.status === 'failed') {
            return existing;
          }
          const rows = await tx.execute<VoiceSessionRecord>(sql`
            update voice_sessions set
              status = 'ended',
              ended_at = coalesce(ended_at, now())
            where id = ${voiceSessionId}
              and organization_id = ${actor.organizationId}
            returning id, organization_id, session_id, deployment_id, provider,
                      external_conversation_id, status,
                      transcript, summary, structured_answers,
                      duration_seconds, cost_credits::text,
                      started_at::text, ended_at::text, webhook_received_at::text, created_at::text,
                      job_id, candidate_id
          `);
          return rows[0] ?? existing;
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'voice.session.ended_by_user',
        resourceType: 'voice_session',
        resourceId: voiceSessionId,
        metadata: { status: updated.status },
      });

          // Pull transcript/summary from the voice provider when the screen ends.
      if (updated.external_conversation_id) {
        try {
          return await service.reconcileVoiceSession(actor, voiceSessionId);
        } catch {
          return toSessionResult(updated);
        }
      }

      return toSessionResult(updated);
    },

    async getVoiceSessionRecording(actor, voiceSessionId) {
      const vs = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadVoiceSession(tx, actor, voiceSessionId),
      );
      if (!vs.external_conversation_id) {
        throw ApiError.notFound('Call recording');
      }
      try {
        return await adapter.fetchConversationAudio(vs.external_conversation_id);
      } catch {
        throw ApiError.notFound('Call recording');
      }
    },

    async handleWebhookEvent(organizationId, event) {
      // Find the voice session by external conversation ID (no tenant context:
      // the webhook does not know which org it belongs to — we look it up).
      if (!event.conversationId) return;

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

      const endedTypes = new Set([
        'post_call_transcription',
        'conversation.ended',
        'call.ended',
        'conversation_ended',
      ]);
      const failedTypes = new Set(['call_initiation_failure']);
      const startedTypes = new Set([
        'conversation.started',
        'call.started',
        'conversation_started',
      ]);

      if (endedTypes.has(event.type)) {
        const details = extractWebhookConversationDetails(event.data);
        await database.db.execute(sql`
          update voice_sessions set
            status              = 'ended',
            ended_at            = coalesce(ended_at, now()),
            webhook_received_at = now(),
            transcript          = coalesce(
              ${details.transcript ? JSON.stringify(details.transcript) : null}::jsonb,
              transcript
            ),
            summary             = coalesce(${details.summary}, summary),
            structured_answers  = coalesce(
              ${
                details.structuredAnswers
                  ? JSON.stringify(details.structuredAnswers)
                  : null
              }::jsonb,
              structured_answers
            ),
            duration_seconds    = coalesce(${details.durationSeconds}, duration_seconds),
            cost_credits        = coalesce(${details.costCredits}, cost_credits)
          where id = ${vs.id}
        `);
        await audit.record({
          organizationId: vs.organization_id,
          actorUserId: null,
          eventType: 'voice.session.webhook_ended',
          resourceType: 'voice_session',
          resourceId: vs.id,
          metadata: {
            conversationId: event.conversationId,
            eventType: event.type,
            hasTranscript: Boolean(details.transcript),
          },
        });
        return;
      }

      if (failedTypes.has(event.type)) {
        const data =
          event.data && typeof event.data === 'object'
            ? (event.data as Record<string, unknown>)
            : {};
        await database.db.execute(sql`
          update voice_sessions set
            status              = 'failed',
            ended_at            = coalesce(ended_at, now()),
            webhook_received_at = now()
          where id = ${vs.id}
            and status <> 'ended'
        `);
        await audit.record({
          organizationId: vs.organization_id,
          actorUserId: null,
          eventType: 'voice.session.webhook_failed',
          resourceType: 'voice_session',
          resourceId: vs.id,
          metadata: {
            conversationId: event.conversationId,
            failureReason: String(data['failure_reason'] ?? 'unknown'),
          },
        });
        return;
      }

      if (startedTypes.has(event.type)) {
        await database.db.execute(sql`
          update voice_sessions set
            status              = 'active',
            webhook_received_at = now()
          where id = ${vs.id}
            and status = 'pending'
        `);
        return;
      }

      await audit.record({
        organizationId: vs.organization_id,
        actorUserId: null,
        eventType: 'voice.session.webhook_ignored',
        resourceType: 'voice_session',
        resourceId: vs.id,
        metadata: {
          conversationId: event.conversationId,
          eventType: event.type || 'unknown',
        },
      });
    },
  };

  return service;
}

/** Pull transcript / summary / answers from a post_call_transcription data blob. */
function extractWebhookConversationDetails(data: unknown): {
  transcript: ReadonlyArray<{ role: string; message: string }> | null;
  summary: string | null;
  structuredAnswers: Record<string, unknown> | null;
  durationSeconds: number | null;
  costCredits: number | null;
} {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      transcript: null,
      summary: null,
      structuredAnswers: null,
      durationSeconds: null,
      costCredits: null,
    };
  }
  const r = data as Record<string, unknown>;
  const meta = (r['metadata'] as Record<string, unknown> | undefined) ?? {};
  const analysis = (r['analysis'] as Record<string, unknown> | undefined) ?? {};

  const turns: { role: string; message: string }[] = [];
  const transcript = (r['transcript'] ?? r['turns']) as unknown[] | undefined;
  if (Array.isArray(transcript)) {
    for (const t of transcript) {
      if (!t || typeof t !== 'object') continue;
      const turn = t as Record<string, unknown>;
      turns.push({
        role: String(turn['role'] ?? turn['speaker'] ?? 'agent'),
        message: String(turn['message'] ?? turn['text'] ?? ''),
      });
    }
  }

  const structuredAnswers: Record<string, unknown> = {};
  const rawCollection = analysis['data_collection_results'];
  if (rawCollection && typeof rawCollection === 'object' && !Array.isArray(rawCollection)) {
    for (const [key, value] of Object.entries(rawCollection as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entry = value as Record<string, unknown>;
        structuredAnswers[key] =
          entry['value'] ?? entry['answer'] ?? entry['result'] ?? value;
      } else {
        structuredAnswers[key] = value;
      }
    }
  }

  const durationSeconds =
    typeof meta['call_duration_secs'] === 'number'
      ? Math.round(meta['call_duration_secs'] as number)
      : typeof r['call_duration_secs'] === 'number'
        ? Math.round(r['call_duration_secs'] as number)
        : null;
  const costCredits =
    typeof meta['cost'] === 'number'
      ? (meta['cost'] as number)
      : typeof r['cost'] === 'number'
        ? (r['cost'] as number)
        : null;
  const summary =
    typeof analysis['transcript_summary'] === 'string'
      ? (analysis['transcript_summary'] as string)
      : typeof r['summary'] === 'string'
        ? (r['summary'] as string)
        : null;

  return {
    transcript: turns.length > 0 ? turns : null,
    summary,
    structuredAnswers:
      Object.keys(structuredAnswers).length > 0 ? structuredAnswers : null,
    durationSeconds,
    costCredits,
  };
}
