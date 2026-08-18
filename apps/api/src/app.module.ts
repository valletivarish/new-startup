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
import type { NotificationProvider } from '@platform/providers';
import type { Logger } from 'pino';

import type { Env } from './config.js';
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
import { createLocalObjectStorage } from './knowledge/local-object-storage.js';
import { createDocumentProcessor } from './knowledge/processor.js';
import { createChunker } from './knowledge/chunker.js';
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
  KNOWLEDGE_RETRIEVER,
  KNOWLEDGE_SERVICE,
  OBJECT_STORAGE,
  SESSIONS_SERVICE,
  SESSION_SERVICE,
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

export interface AppDeps {
  readonly env: Env;
  readonly database: Database;
  readonly auth: BetterAuthInstance;
  readonly notifications: NotificationProvider;
  readonly logger: Logger;
  /** Null when jobs are disabled (tests); ingestion then runs inline. */
  readonly jobs: JobQueue | null;
}

@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
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
            createAgentsService(deps.database, audit),
        },
        {
          provide: SESSIONS_SERVICE,
          inject: [AUDIT_SERVICE],
          useFactory: (audit: ReturnType<typeof createAuditService>) =>
            createSessionsService(deps.database, audit),
        },
        {
          // Phase 2 uses the deterministic strategy. Phase 4 swaps in an
          // LLM-backed one here and nothing else changes.
          provide: AGENT_RUNTIME,
          inject: [SESSIONS_SERVICE, KNOWLEDGE_RETRIEVER],
          useFactory: (
            sessions: ReturnType<typeof createSessionsService>,
            retriever: ReturnType<typeof createKnowledgeRetriever>,
          ) =>
            createAgentRuntime(
              deps.database,
              sessions,
              undefined,
              retriever,
            ),
        },
        {
          provide: OBJECT_STORAGE,
          useFactory: () => createLocalObjectStorage(deps.env.STORAGE_ROOT),
        },
        {
          provide: KNOWLEDGE_SERVICE,
          inject: [AUDIT_SERVICE, OBJECT_STORAGE],
          useFactory: (
            audit: ReturnType<typeof createAuditService>,
            storage: ReturnType<typeof createLocalObjectStorage>,
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
      ],
    };
  }
}
