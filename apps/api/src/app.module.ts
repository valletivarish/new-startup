/**
 * The application module — one modular monolith, wired with explicit tokens.
 *
 * Provider adapters and services are bound through the DI container
 * (`07_CODING_RULES` §22); business services never import a concrete
 * provider, only the interface and the token.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Database } from '@platform/db';
import type { JobQueue } from './jobs/queue.js';
import type { NotificationProvider, ObjectStorage } from '@platform/providers';
import type { Logger } from 'pino';

import { runtimeLimitsFrom, type Env } from './config.js';
import type { BetterAuthInstance } from './auth/better-auth.js';
import { createAuthContextService } from './authz/auth-context.js';
import { AuthzGuard } from './authz/authz.guard.js';
import { createAuditService } from './audit/audit.service.js';
import { createSessionService } from './auth/session.service.js';
import { createOrganizationsService } from './organizations/organizations.service.js';
import { createMembersService } from './organizations/members.service.js';
import { createInvitationsService } from './organizations/invitations.service.js';
import { createAgentsService } from './agents/agents.service.js';
import { createSessionsService } from './agents/sessions.service.js';
import { createAgentRuntime } from './agents/runtime.js';
import { createKnowledgeService } from './knowledge/knowledge.service.js';
import { createKnowledgeRetriever } from './knowledge/retriever.js';
import { createDeterministicEmbeddingProvider } from './knowledge/deterministic-embedding-provider.js';
import { createObjectStorage } from './knowledge/create-object-storage.js';
import { createDocumentProcessor } from './knowledge/processor.js';
import { createChunker } from './knowledge/chunker.js';
import { createToolRegistry } from './tools/registry.js';
import { createToolExecutor } from './tools/executor.js';
import { createToolsService } from './tools/tools.service.js';
import { createDeterministicIntelligenceProvider } from './intelligence/deterministic-provider.js';
import { createIntelligenceOrchestrator } from './intelligence/orchestrator.js';
import {
  AUDIT_SERVICE,
  AUTH_CONTEXT_SERVICE,
  BETTER_AUTH,
  DATABASE,
  ENV,
  INVITATIONS_SERVICE,
  LOGGER,
  MEMBERS_SERVICE,
  NOTIFICATIONS,
  ORGANIZATIONS_SERVICE,
} from './tokens.js';
import {
  AGENTS_SERVICE,
  AGENT_RUNTIME,
  INTELLIGENCE_ORCHESTRATOR,
  INTELLIGENCE_PROVIDER,
  KNOWLEDGE_RETRIEVER,
  KNOWLEDGE_SERVICE,
  OBJECT_STORAGE,
  SESSIONS_SERVICE,
  SESSION_SERVICE,
  TOOLS_SERVICE,
  TOOL_EXECUTOR,
  TOOL_REGISTRY,
  VOICE_SESSION_ADAPTER,
  VOICE_SESSION_SERVICE,
  COST_SERVICE,
  OWN_LOOP_SERVICE,
  JOBS_SERVICE,
  CANDIDATES_SERVICE,
  API_KEYS_SERVICE,
  CALL_REQUESTS_SERVICE,
  CANDIDATE_LINKS_SERVICE,
  WEBHOOKS_SERVICE,
  USAGE_SERVICE,
} from './tokens.more.js';
import {
  AuthController,
  CatalogueController,
  HealthController,
  InvitationsController,
  MembersController,
  OrganizationController,
  OrganizationCreateController,
} from './controllers.js';
import {
  AgentsController,
  AgentSessionsController,
} from './agents/agents.controller.js';
import { KnowledgeController } from './knowledge/knowledge.controller.js';
import {
  AgentToolsController,
  ToolExecutionsController,
  ToolsController,
} from './tools/tools.controller.js';
import {
  VoiceDeploymentsController,
  VoiceSessionsController,
  VoiceCallsController,
  TelephonyStatusController,
  VoiceWebhookController,
} from './providers/elevenlabs/voice.controller.js';
import { JobsController } from './hiring/jobs.controller.js';
import { AdminCostsController } from './costs/costs.controller.js';
import { createCostService } from './costs/costs.service.js';
// Aliased at the composition root: the phone line is bound here by DI and
// named for what it is, not for the carrier behind it.
import { createExotelClient as createPhoneLineClient, exotelCarrier as phoneLineCarrier } from './providers/exotel/exotel.js';
import { ExotelWebhookController } from './providers/exotel/exotel-webhook.controller.js';
import { createOwnLoopService } from './providers/own-loop/own-loop.service.js';
import { InternalVoiceController } from './providers/own-loop/internal-voice.controller.js';
import { CandidatesController } from './hiring/candidates.controller.js';
import { createVoiceSessionAdapter, createStubVoiceSessionAdapter } from './providers/elevenlabs/adapter.js';
import { createVoiceSessionService } from './providers/elevenlabs/voice-session.service.js';
import { createJobsService } from './hiring/jobs.service.js';
import { createCandidatesService } from './hiring/candidates.service.js';
import { createApiKeysService } from './integrations/api-keys.service.js';
import { ApiKeysController } from './integrations/api-keys.controller.js';
import { OpenApiController } from './integrations/openapi.controller.js';
import { V1PingController } from './integrations/v1-ping.controller.js';
import { V1JobsController } from './integrations/v1-jobs.controller.js';
import { V1CallsController } from './integrations/v1-calls.controller.js';
import {
  PublicCandidateLinksController,
  V1CandidateLinksController,
} from './integrations/candidate-links.controller.js';
import { createCandidateLinksService } from './integrations/candidate-links.service.js';
import { V1UsageController } from './integrations/v1-usage.controller.js';
import { createUsageService } from './integrations/usage.service.js';
import { V1WebhooksController } from './integrations/v1-webhooks.controller.js';
import { emitCallEvent } from './integrations/events.js';
import { createWebhooksService } from './integrations/webhooks.service.js';
import { createCallRequestsService } from './integrations/call-requests.service.js';
import { CALL_QUEUE, type CallJob } from './jobs/queue.js';

export interface AppDeps {
  readonly env: Env;
  readonly database: Database;
  readonly auth: BetterAuthInstance;
  readonly notifications: NotificationProvider;
  readonly logger: Logger;
  /** Null when jobs are disabled (tests); ingestion then runs inline. */
  readonly jobs: JobQueue | null;
  /**
   * Optional voice session adapter override. When provided, this replaces the
   * adapter that would otherwise be selected based on ELEVENLABS_ENABLED.
   * Used by tests to inject the stub adapter without a real API key.
   */
  readonly voiceAdapter?: ReturnType<typeof createVoiceSessionAdapter>;
}

@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const onCallEnded = (organizationId: string, voiceSessionId: string) =>
      emitCallEvent(deps.database, deps.jobs, organizationId, voiceSessionId, deps.logger, deps.env.API_URL);
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        OrganizationCreateController,
        OrganizationController,
        MembersController,
        InvitationsController,
        CatalogueController,
        AgentsController,
        AgentSessionsController,
        KnowledgeController,
        ToolsController,
        AgentToolsController,
        ToolExecutionsController,
        VoiceDeploymentsController,
        VoiceSessionsController,
        VoiceCallsController,
        TelephonyStatusController,
        VoiceWebhookController,
        JobsController,
        CandidatesController,
        AdminCostsController,
        InternalVoiceController,
        ExotelWebhookController,
        ApiKeysController,
        V1PingController,
        OpenApiController,
        V1JobsController,
        V1CallsController,
        V1UsageController,
        V1CandidateLinksController,
        PublicCandidateLinksController,
        V1WebhooksController,
      ],
      providers: [
        { provide: ENV, useValue: deps.env },
        { provide: DATABASE, useValue: deps.database },
        { provide: BETTER_AUTH, useValue: deps.auth },
        { provide: NOTIFICATIONS, useValue: deps.notifications },
        { provide: LOGGER, useValue: deps.logger },
        {
          provide: AUDIT_SERVICE,
          useFactory: () => createAuditService(deps.database, deps.logger),
        },
        {
          provide: AUTH_CONTEXT_SERVICE,
          useFactory: () => createAuthContextService(deps.auth, deps.database),
        },
        {
          provide: SESSION_SERVICE,
          useFactory: () => createSessionService(deps.database),
        },
        {
          provide: ORGANIZATIONS_SERVICE,
          inject: [AUDIT_SERVICE],
          useFactory: (audit: ReturnType<typeof createAuditService>) =>
            createOrganizationsService(deps.database, audit),
        },
        {
          provide: MEMBERS_SERVICE,
          inject: [AUDIT_SERVICE, SESSION_SERVICE],
          useFactory: (
            audit: ReturnType<typeof createAuditService>,
            sessions: ReturnType<typeof createSessionService>,
          ) => createMembersService(deps.database, audit, sessions),
        },
        {
          provide: INVITATIONS_SERVICE,
          inject: [AUDIT_SERVICE],
          useFactory: (audit: ReturnType<typeof createAuditService>) =>
            createInvitationsService(
              deps.database,
              audit,
              deps.notifications,
              deps.env.WEB_URL,
            ),
        },
        {
          provide: AGENTS_SERVICE,
          inject: [AUDIT_SERVICE],
          useFactory: (audit: ReturnType<typeof createAuditService>) =>
            createAgentsService(deps.database, audit, deps.env.ORG_AGENT_LIMIT),
        },
        {
          provide: SESSIONS_SERVICE,
          inject: [AUDIT_SERVICE],
          useFactory: (audit: ReturnType<typeof createAuditService>) =>
            createSessionsService(deps.database, audit),
        },
        {
          // No production intelligence provider is selected (ADR-006
          // condition). The deterministic one implements the SAME interface,
          // so the orchestration layer is real and fully tested without
          // embedding a vendor choice. Swapping in a real provider is one
          // binding, here.
          provide: INTELLIGENCE_PROVIDER,
          useFactory: () => createDeterministicIntelligenceProvider(),
        },
        {
          provide: TOOL_REGISTRY,
          useFactory: () => createToolRegistry(deps.database),
        },
        {
          provide: TOOL_EXECUTOR,
          inject: [TOOL_REGISTRY, AUDIT_SERVICE],
          useFactory: (
            registry: ReturnType<typeof createToolRegistry>,
            audit: ReturnType<typeof createAuditService>,
          ) => createToolExecutor(deps.database, registry, audit),
        },
        {
          provide: TOOLS_SERVICE,
          inject: [TOOL_REGISTRY, AUDIT_SERVICE],
          useFactory: (
            registry: ReturnType<typeof createToolRegistry>,
            audit: ReturnType<typeof createAuditService>,
          ) => createToolsService(deps.database, registry, audit),
        },
        {
          provide: INTELLIGENCE_ORCHESTRATOR,
          inject: [INTELLIGENCE_PROVIDER, TOOL_EXECUTOR],
          useFactory: (
            provider: ReturnType<typeof createDeterministicIntelligenceProvider>,
            executor: ReturnType<typeof createToolExecutor>,
          ) => createIntelligenceOrchestrator(provider, executor),
        },
        {
          // The runtime loop is unchanged from Phase 2. Intelligence and
          // tools are collaborators it delegates to — the event lifecycle,
          // ordering, idempotency and version pinning are untouched.
          provide: AGENT_RUNTIME,
          inject: [
            SESSIONS_SERVICE,
            KNOWLEDGE_RETRIEVER,
            INTELLIGENCE_ORCHESTRATOR,
            TOOL_REGISTRY,
            AUDIT_SERVICE,
          ],
          useFactory: (
            sessions: ReturnType<typeof createSessionsService>,
            retriever: ReturnType<typeof createKnowledgeRetriever>,
            intelligence: ReturnType<typeof createIntelligenceOrchestrator>,
            tools: ReturnType<typeof createToolRegistry>,
            audit: ReturnType<typeof createAuditService>,
          ) =>
            createAgentRuntime(deps.database, sessions, {
              retriever,
              intelligence,
              tools,
              limits: runtimeLimitsFrom(deps.env),
              audit,
              logger: deps.logger,
            }),
        },
        {
          provide: OBJECT_STORAGE,
          useFactory: () => createObjectStorage(deps.env),
        },
        {
          provide: KNOWLEDGE_SERVICE,
          inject: [AUDIT_SERVICE, OBJECT_STORAGE],
          useFactory: (
            audit: ReturnType<typeof createAuditService>,
            storage: ObjectStorage,
          ) => {
            // The same processor the worker runs. When a worker IS present
            // this is never invoked; when one is not, documents still index.
            const processInline = createDocumentProcessor({
              database: deps.database,
              embeddings: createDeterministicEmbeddingProvider(),
              chunker: createChunker(),
              storage,
              logger: deps.logger,
              onAudit: async (event) => {
                await audit.record({
                  organizationId: event.organizationId,
                  actorUserId: event.actorUserId,
                  eventType: event.eventType,
                  resourceType: 'knowledge_document',
                  resourceId: event.documentId,
                  metadata: event.metadata,
                });
              },
            });
            return createKnowledgeService(
              deps.database,
              audit,
              deps.jobs,
              storage,
              processInline,
            );
          },
        },
        {
          // No embedding provider is selected (ADR-006 condition); the
          // deterministic one implements the same interface so retrieval is
          // real and testable without embedding a vendor choice.
          provide: KNOWLEDGE_RETRIEVER,
          useFactory: () =>
            createKnowledgeRetriever(
              deps.database,
              createDeterministicEmbeddingProvider(),
              deps.logger,
            ),
        },
        { provide: APP_GUARD, useClass: AuthzGuard },
        // MVP-01 ElevenLabs browser-voice
        {
          provide: VOICE_SESSION_ADAPTER,
          useFactory: () =>
            deps.voiceAdapter ??
            (deps.env.ELEVENLABS_ENABLED
              ? createVoiceSessionAdapter(deps.env)
              : createStubVoiceSessionAdapter()),
        },
        {
          provide: COST_SERVICE,
          useFactory: () => createCostService(deps.database, deps.env),
        },
        {
          provide: OWN_LOOP_SERVICE,
          inject: [COST_SERVICE, VOICE_SESSION_SERVICE],
          useFactory: (
            costs: ReturnType<typeof createCostService>,
            voice: ReturnType<typeof createVoiceSessionService>,
          ) => {
            const phoneLine = createPhoneLineClient(deps.env);
            return createOwnLoopService(
              deps.database,
              deps.env,
              costs,
              phoneLine.isConfigured() ? phoneLineCarrier(phoneLine) : null,
              onCallEnded,
              { voice },
            );
          },
        },
        {
          provide: VOICE_SESSION_SERVICE,
          inject: [AUDIT_SERVICE, VOICE_SESSION_ADAPTER, COST_SERVICE],
          useFactory: (
            audit: ReturnType<typeof createAuditService>,
            adapter: ReturnType<typeof createVoiceSessionAdapter>,
            costs: ReturnType<typeof createCostService>,
          ) =>
            createVoiceSessionService(
              deps.database,
              deps.env,
              audit,
              adapter,
              costs,
              createPhoneLineClient(deps.env),
              onCallEnded,
            ),
        },
        {
          provide: WEBHOOKS_SERVICE,
          useFactory: () =>
            createWebhooksService({
              database: deps.database,
              queue: deps.jobs,
              production: deps.env.NODE_ENV === 'production',
            }),
        },
        {
          provide: USAGE_SERVICE,
          useFactory: () => createUsageService(deps.database),
        },
        {
          provide: JOBS_SERVICE,
          useFactory: () => createJobsService(deps.database),
        },
        {
          provide: CANDIDATES_SERVICE,
          useFactory: () => createCandidatesService(deps.database),
        },
        {
          provide: API_KEYS_SERVICE,
          inject: [AUDIT_SERVICE],
          useFactory: (audit: ReturnType<typeof createAuditService>) =>
            createApiKeysService(deps.database, audit),
        },
        {
          provide: CANDIDATE_LINKS_SERVICE,
          inject: [CANDIDATES_SERVICE, CALL_REQUESTS_SERVICE],
          useFactory: (
            candidates: ReturnType<typeof createCandidatesService>,
            calls: ReturnType<typeof createCallRequestsService>,
          ) => createCandidateLinksService({ database: deps.database, candidates, calls }),
        },
        {
          // The API process runs the call worker: placing a call needs the
          // voice service, which lives here. Null queue (tests) → no worker.
          provide: CALL_REQUESTS_SERVICE,
          inject: [VOICE_SESSION_SERVICE, JOBS_SERVICE, OWN_LOOP_SERVICE],
          useFactory: async (
            voice: ReturnType<typeof createVoiceSessionService>,
            jobs: ReturnType<typeof createJobsService>,
            ownLoop: ReturnType<typeof createOwnLoopService>,
          ) => {
            const service = createCallRequestsService({
              database: deps.database,
              voice,
              jobs,
              placeTest: ownLoop.placeTestCall,
              queue: deps.jobs,
              logger: deps.logger,
              apiUrl: deps.env.API_URL,
            });
            if (!deps.jobs) return service;
            await deps.jobs.boss.work<CallJob>(CALL_QUEUE, async (batch) => {
              for (const job of batch) await service.place(job.data);
            });
            // Rows left in `placing` by a crash or deploy: sweep at startup, then every 5 min.
            const sweep = () =>
              service.sweepStuckPlacing(new Date()).catch((err: unknown) => {
                deps.logger.error({ err: (err as Error).message }, 'calls.sweep_failed');
              });
            void sweep();
            const timer = setInterval(() => void sweep(), 5 * 60_000);
            timer.unref();
            return Object.assign(service, { onModuleDestroy: () => clearInterval(timer) });
          },
        },
      ],
    };
  }
}
