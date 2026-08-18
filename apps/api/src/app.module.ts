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

export interface AppDeps {
  readonly env: Env;
  readonly database: Database;
  readonly auth: BetterAuthInstance;
  readonly notifications: NotificationProvider;
  readonly logger: Logger;
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
          inject: [SESSIONS_SERVICE],
          useFactory: (sessions: ReturnType<typeof createSessionsService>) =>
            createAgentRuntime(deps.database, sessions),
        },
        { provide: APP_GUARD, useClass: AuthzGuard },
      ],
    };
  }
}
