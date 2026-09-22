/**
 * HTTP surface for Phase 1 (`04_DATABASE_API_SPEC` §5, as amended).
 *
 * Better Auth owns /api/auth/* (register, login, logout, verification,
 * password reset) — mounted in main.ts. Everything here is the platform's
 * own surface, and every route carries exactly one authorization marker.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { sql, withTenantContext, withoutTenantContext, type Database } from '@platform/db';

import { Authenticated, Public, RequirePermission } from './authz/decorators.js';
import { requireOrganization, type AuthContext } from './authz/auth-context.js';
import type { RequestWithAuth } from './authz/authz.guard.js';
import { ApiError } from './errors.js';
import { parse } from './validate.js';
import { PaginationQuery, decodeCursor, toPage } from './pagination.js';
import {
  AUDIT_SERVICE,
  DATABASE,
  ENV,
  INVITATIONS_SERVICE,
  MEMBERS_SERVICE,
  ORGANIZATIONS_SERVICE,
} from './tokens.js';
import type { Env } from './config.js';
import type { OrganizationsService } from './organizations/organizations.service.js';
import type { MembersService } from './organizations/members.service.js';
import type { InvitationsService } from './organizations/invitations.service.js';
import type { AuditService } from './audit/audit.service.js';
import type { SessionService } from './auth/session.service.js';
import { SESSION_SERVICE } from './tokens.more.js';
import { takeConsoleResetLink } from './auth/console-reset-links.js';

/** Recruiter-facing audit event labels for CSV (and UI-adjacent exports). */
function auditEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    'authz.sensitive_access': 'Opened a restricted page',
    'authz.denied': 'Access denied',
    'hiring.candidate_status_changed': 'Stage move',
    'hiring.job_created': 'Created a job',
    'hiring.job_updated': 'Updated a job',
    'hiring.candidate_imported': 'Imported candidates',
    'hiring.call_started': 'Started a phone screen',
    'hiring.call_ended': 'Ended a phone screen',
    'audit.exported': 'Exported audit log',
    'invitation.created': 'Invited a teammate',
    'invitation.accepted': 'Teammate joined',
    'invitation.revoked': 'Invite revoked',
    'org.member_invited': 'Invited a teammate',
    'org.member_joined': 'Teammate joined',
    'org.settings_updated': 'Updated company settings',
  };
  if (eventType in labels) return labels[eventType]!;
  return eventType
    .replace(/^[a-z]+\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pipelineStageLabel(raw: string): string {
  const labels: Record<string, string> = {
    new: 'In queue',
    screening: 'On hold',
    reviewed: 'Moved forward',
  };
  return labels[raw] ?? raw;
}

function ctxOf(req: RequestWithAuth): AuthContext {
  const ctx = req.authContext;
  if (!ctx) throw ApiError.unauthorized();
  return ctx;
}

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(ctxOf(req));
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
    roleKey: ctx.organization.roleKey,
  };
}

const UuidParam = z.string().uuid();

// ---------------------------------------------------------------------------

@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  @Public()
  @Get('health')
  async health() {
    const outboundConfigured = Boolean(
      this.env.ELEVENLABS_ENABLED && this.env.ELEVENLABS_PHONE_NUMBER_ID,
    );

    let jobsBacklog: number | null = null;
    if (this.env.JOBS_ENABLED) {
      try {
        const rows = await withoutTenantContext(this.database.db, async (tx) =>
          tx.execute<{ n: string }>(sql`
            select count(*)::text as n
            from pgboss.job
            where state = 'created'
              and created_on < now() - interval '2 minutes'
          `),
        );
        jobsBacklog = Number(rows[0]?.n ?? 0);
      } catch {
        jobsBacklog = null;
      }
    }

    return {
      status: 'ok',
      readiness: {
        email: this.env.NOTIFICATION_TRANSPORT,
        storage: this.env.STORAGE_BACKEND,
        voiceEnabled: this.env.ELEVENLABS_ENABLED,
        outboundConfigured,
        openOutbound: this.env.TELEPHONY_OPEN_OUTBOUND,
        jobsEnabled: this.env.JOBS_ENABLED,
        jobsBacklog,
      },
    };
  }
}

// ---------------------------------------------------------------------------

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(ORGANIZATIONS_SERVICE) private readonly orgs: OrganizationsService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Staging only (console mail). Returns the one-shot reset URL after
   * request-password-reset, mirroring invite acceptUrl when SMTP is off.
   */
  @Public()
  @Post('password-reset/console-link')
  consoleResetLink(@Body() body: unknown) {
    if (this.env.NOTIFICATION_TRANSPORT !== 'console') {
      throw ApiError.notFound('Reset link');
    }
    const input = parse(
      z.object({ email: z.string().email() }),
      body,
    );
    const url = takeConsoleResetLink(input.email);
    if (!url) throw ApiError.notFound('Reset link');
    return { url };
  }

  @Authenticated()
  @Get('me')
  me(@Req() req: RequestWithAuth) {
    const ctx = ctxOf(req);
    return {
      user: {
        id: ctx.userId,
        name: ctx.userName,
        email: ctx.userEmail,
        emailVerified: ctx.emailVerified,
      },
      activeOrganization: ctx.organization
        ? {
            id: ctx.organization.organizationId,
            role: ctx.organization.roleKey,
            permissions: [...ctx.organization.permissions].sort(),
          }
        : null,
    };
  }

  @Authenticated()
  @Get('organizations')
  async organizations(@Req() req: RequestWithAuth) {
    const ctx = ctxOf(req);
    return { organizations: await this.orgs.listForUser(ctx.userId) };
  }

  @Authenticated()
  @Post('switch-organization')
  async switchOrganization(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const ctx = ctxOf(req);
    const input = parse(
      z.object({ organizationId: z.string().uuid() }),
      body,
    );

    // The ONLY path by which a session's organization changes: validated
    // against a live membership, then written server-side to the session row.
    await this.orgs.validateMembership(ctx.userId, input.organizationId);
    await this.sessions.setActiveOrganization(
      ctx.sessionToken,
      input.organizationId,
    );
    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: ctx.userId,
      eventType: 'session.organization_switched',
    });
    return { activeOrganizationId: input.organizationId };
  }
}

// ---------------------------------------------------------------------------

@Controller('organizations')
export class OrganizationCreateController {
  constructor(
    @Inject(ORGANIZATIONS_SERVICE) private readonly orgs: OrganizationsService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @Authenticated()
  @Post()
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const ctx = ctxOf(req);
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(100),
        slug: z
          .string()
          .trim()
          .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)
          .optional(),
      }),
      body,
    );
    const created = await this.orgs.create({
      userId: ctx.userId,
      name: input.name,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
    });
    // Creating an organization activates it for this session.
    await this.sessions.setActiveOrganization(ctx.sessionToken, created.id);
    return created;
  }

  /**
   * Idempotent bootstrap used by signup: always leaves the session on a
   * company. Safe to retry if the client already created one.
   */
  @Authenticated()
  @Post('ensure')
  async ensure(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const ctx = ctxOf(req);
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(100),
      }),
      body,
    );
    const result = await this.orgs.ensureForUser({
      userId: ctx.userId,
      name: input.name,
    });
    await this.sessions.setActiveOrganization(ctx.sessionToken, result.id);
    return result;
  }
}

// ---------------------------------------------------------------------------

@Controller('organization')
export class OrganizationController {
  constructor(
    @Inject(ORGANIZATIONS_SERVICE) private readonly orgs: OrganizationsService,
  ) {}

  @RequirePermission('organization.read')
  @Get()
  async get(@Req() req: RequestWithAuth) {
    const actor = actorOf(req);
    return this.orgs.get(actor.organizationId);
  }

  @RequirePermission('organization.update')
  @Patch()
  async update(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const actor = actorOf(req);
    const input = parse(
      z.object({ name: z.string().trim().min(2).max(100).optional() }),
      body,
    );
    await this.orgs.update({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      ...(input.name !== undefined ? { name: input.name } : {}),
    });
    return { updated: true };
  }

  @RequirePermission('organization.delete')
  @Delete()
  async remove(@Req() req: RequestWithAuth) {
    const actor = actorOf(req);
    await this.orgs.remove(actor.organizationId, actor.userId);
    return { deleted: true };
  }
}

// ---------------------------------------------------------------------------

@Controller('organization/members')
export class MembersController {
  constructor(
    @Inject(MEMBERS_SERVICE) private readonly members: MembersService,
  ) {}

  @RequirePermission('users.read')
  @Get()
  async list(@Req() req: RequestWithAuth) {
    return { members: await this.members.list(actorOf(req)) };
  }

  @RequirePermission('roles.assign')
  @Patch(':id/role')
  async changeRole(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const membershipId = parse(UuidParam, id);
    const input = parse(z.object({ roleKey: z.string() }), body);
    await this.members.changeRole(actorOf(req), membershipId, input.roleKey);
    return { updated: true };
  }

  @RequirePermission('users.deactivate')
  @Patch(':id/status')
  async changeStatus(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const membershipId = parse(UuidParam, id);
    const input = parse(
      z.object({ status: z.enum(['active', 'suspended']) }),
      body,
    );
    await this.members.changeStatus(actorOf(req), membershipId, input.status);
    return { updated: true };
  }

  @RequirePermission('users.deactivate')
  @Delete(':id')
  async remove(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const membershipId = parse(UuidParam, id);
    await this.members.remove(actorOf(req), membershipId);
    return { removed: true };
  }
}

// ---------------------------------------------------------------------------

@Controller()
export class InvitationsController {
  constructor(
    @Inject(INVITATIONS_SERVICE) private readonly invitations: InvitationsService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @RequirePermission('users.read')
  @Get('organization/invitations')
  async list(@Req() req: RequestWithAuth) {
    return { invitations: await this.invitations.list(actorOf(req)) };
  }

  @RequirePermission('users.invite')
  @Post('organization/invitations')
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const input = parse(
      z.object({ email: z.string().email(), roleKey: z.string() }),
      body,
    );
    return this.invitations.create(actorOf(req), input);
  }

  @RequirePermission('users.invite')
  @Delete('organization/invitations/:id')
  async revoke(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const invitationId = parse(UuidParam, id);
    await this.invitations.revoke(actorOf(req), invitationId);
    return { revoked: true };
  }

  /**
   * Authenticated but organization-less: the token selects the tenant. The
   * caller registers or logs in first; the invitation email must match.
   */
  @Authenticated()
  @Post('invitations/accept')
  async accept(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const ctx = ctxOf(req);
    const input = parse(
      z.object({ token: z.string().min(20).max(200) }),
      body,
    );
    const result = await this.invitations.accept({
      token: input.token,
      userId: ctx.userId,
      userEmail: ctx.userEmail,
    });
    // Accept always switches the session onto the invited company so a
    // personal workspace created at signup does not leave them stranded.
    await this.sessions.setActiveOrganization(
      ctx.sessionToken,
      result.organizationId,
    );
    return result;
  }
}

// ---------------------------------------------------------------------------

@Controller()
export class CatalogueController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_SERVICE) private readonly auditService: AuditService,
  ) {}

  @RequirePermission('roles.read')
  @Get('roles')
  async roles(@Req() req: RequestWithAuth) {
    const actor = actorOf(req);
    const rows = await withTenantContext(
      this.database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) =>
        tx.execute<{ id: string; key: string; name: string; description: string }>(
          sql`select id, key, name, description from roles
              where organization_id is null or organization_id = ${actor.organizationId}
              order by key`,
        ),
    );
    return { roles: rows };
  }

  @RequirePermission('roles.read')
  @Get('permissions')
  async permissions() {
    const rows = await withoutTenantContext(this.database.db, async (tx) =>
      tx.execute<{
        key: string;
        resource: string;
        action: string;
        description: string;
        is_sensitive: boolean;
      }>(
        sql`select key, resource, action, description, is_sensitive
            from permissions order by resource, action`,
      ),
    );
    return { permissions: rows };
  }

  @RequirePermission('audit.read')
  @Get('audit')
  async audit(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const actor = actorOf(req);
    const AuditListQuery = PaginationQuery.extend({
      eventType: z.string().trim().min(1).max(120).optional(),
      from: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Use ISO date or datetime')
        .optional(),
      to: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Use ISO date or datetime')
        .optional(),
    });
    const { limit, cursor, eventType, from, to } = parse(
      AuditListQuery,
      query ?? {},
    );
    const fromDate = from && !from.includes('T') ? from : undefined;
    const toDate = to && !to.includes('T') ? to : undefined;
    const fromTs = from && from.includes('T') ? from : undefined;
    const toTs = to && to.includes('T') ? to : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw ApiError.validation([
        { field: 'to', message: 'Must be on or after from.' },
      ]);
    }
    if (fromTs && toTs && fromTs > toTs) {
      throw ApiError.validation([
        { field: 'to', message: 'Must be on or after from.' },
      ]);
    }
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await withTenantContext(
      this.database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) =>
        tx.execute<{
          id: string;
          actor_user_id: string | null;
          actor_name: string | null;
          event_type: string;
          resource_type: string | null;
          resource_id: string | null;
          metadata: unknown;
          created_at: string;
          subject_name: string | null;
          job_title: string | null;
        }>(sql`
          select e.id, e.actor_user_id, e.event_type, e.resource_type, e.resource_id,
                 e.metadata, e.created_at::text,
                 coalesce(nullif(u.name, ''), u.email) as actor_name,
                 case
                   when e.resource_type = 'candidate' then c.full_name
                   else null
                 end as subject_name,
                 coalesce(j.title, j2.title) as job_title
          from audit_events e
          left join users u on u.id = e.actor_user_id
          left join candidates c
            on e.resource_type = 'candidate'
           and e.resource_id ~ '^[0-9a-fA-F-]{36}$'
           and c.id = e.resource_id::uuid
           and c.organization_id = ${actor.organizationId}
          left join jobs j
            on (e.metadata->>'jobId') ~ '^[0-9a-fA-F-]{36}$'
           and j.id = (e.metadata->>'jobId')::uuid
           and j.organization_id = ${actor.organizationId}
          left join jobs j2
            on j2.id = c.job_id
           and j2.organization_id = ${actor.organizationId}
          where e.organization_id = ${actor.organizationId}
            ${
              eventType
                ? sql`and e.event_type = ${eventType}`
                : sql``
            }
            ${
              fromDate
                ? sql`and e.created_at::date >= ${fromDate}::date`
                : fromTs
                  ? sql`and e.created_at >= ${fromTs}::timestamptz`
                  : sql``
            }
            ${
              toDate
                ? sql`and e.created_at::date <= ${toDate}::date`
                : toTs
                  ? sql`and e.created_at <= ${toTs}::timestamptz`
                  : sql``
            }
            ${
              after
                ? sql`and (e.created_at, e.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                : sql``
            }
          order by e.created_at desc, e.id desc
          limit ${limit + 1}
        `),
    );

    const page = toPage(rows, limit);
    return {
      events: page.items.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        eventType: r.event_type,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        subjectName: r.subject_name,
        jobTitle: r.job_title,
        metadata: r.metadata,
        createdAt: r.created_at,
      })),
      nextCursor: page.nextCursor,
    };
  }

  @RequirePermission('audit.read')
  @Post('audit/export.csv')
  async exportAuditCsv(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: false }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const actor = actorOf(req);
    const ExportBody = z.object({
      eventType: z.string().trim().min(1).max(120).optional(),
      from: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/)
        .optional(),
      to: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/)
        .optional(),
      kind: z.enum(['all', 'stage']).optional(),
    });
    const q = parse(ExportBody, body ?? {});
    const eventType =
      q.kind === 'stage'
        ? 'hiring.candidate_status_changed'
        : q.eventType;
    // Date-only filters compare calendar dates (picker local day), not UTC midnights.
    const fromDate =
      q.from && !q.from.includes('T') ? q.from : undefined;
    const toDate = q.to && !q.to.includes('T') ? q.to : undefined;
    const fromTs =
      q.from && q.from.includes('T') ? q.from : undefined;
    const toTs = q.to && q.to.includes('T') ? q.to : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw ApiError.validation([
        { field: 'to', message: 'Must be on or after from.' },
      ]);
    }
    if (fromTs && toTs && fromTs > toTs) {
      throw ApiError.validation([
        { field: 'to', message: 'Must be on or after from.' },
      ]);
    }

    const filename =
      q.kind === 'stage'
        ? `stage-moves-${new Date().toISOString().slice(0, 10)}.csv`
        : `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    reply.hijack();
    const stageExport = q.kind === 'stage';
    reply.raw.write(
      stageExport
        ? 'created_at,actor,candidate,job,from_stage,to_stage,reason,candidate_id,job_id\n'
        : 'created_at,event,actor,resource_type,resource_id,metadata\n',
    );

    const csvEscape = (value: string) =>
      /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    const parseMeta = (
      metadata: unknown,
    ): Record<string, unknown> => {
      if (metadata == null) return {};
      if (typeof metadata === 'string') {
        try {
          const parsed = JSON.parse(metadata) as unknown;
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
        } catch {
          return {};
        }
      }
      return typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    };

    let cursor: { createdAt: string; id: string } | null = null;
    let count = 0;
    const pageSize = 200;
    const maxPages = 500;
    let truncated = false;

    type AuditExportRow = {
      id: string;
      actor_user_id: string | null;
      actor_name: string | null;
      event_type: string;
      resource_type: string | null;
      resource_id: string | null;
      metadata: unknown;
      created_at: string;
      subject_name: string | null;
      job_title: string | null;
    };

    for (let page = 0; page < maxPages; page += 1) {
      const after: { createdAt: string; id: string } | null = cursor;
      const rows: AuditExportRow[] = await withTenantContext(
        this.database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx): Promise<AuditExportRow[]> =>
          tx.execute<AuditExportRow>(sql`
            select e.id, e.actor_user_id, e.event_type, e.resource_type, e.resource_id,
                   e.metadata, e.created_at::text,
                   coalesce(nullif(u.name, ''), u.email) as actor_name,
                   case
                     when e.resource_type = 'candidate' then c.full_name
                     else null
                   end as subject_name,
                   coalesce(j.title, j2.title) as job_title
            from audit_events e
            left join users u on u.id = e.actor_user_id
            left join candidates c
              on e.resource_type = 'candidate'
             and e.resource_id ~ '^[0-9a-fA-F-]{36}$'
             and c.id = e.resource_id::uuid
             and c.organization_id = ${actor.organizationId}
            left join jobs j
              on (e.metadata->>'jobId') ~ '^[0-9a-fA-F-]{36}$'
             and j.id = (e.metadata->>'jobId')::uuid
             and j.organization_id = ${actor.organizationId}
            left join jobs j2
              on j2.id = c.job_id
             and j2.organization_id = ${actor.organizationId}
            where e.organization_id = ${actor.organizationId}
              ${
                eventType
                  ? sql`and e.event_type = ${eventType}`
                  : sql``
              }
              ${
                fromDate
                  ? sql`and e.created_at::date >= ${fromDate}::date`
                  : fromTs
                    ? sql`and e.created_at >= ${fromTs}::timestamptz`
                    : sql``
              }
              ${
                toDate
                  ? sql`and e.created_at::date <= ${toDate}::date`
                  : toTs
                    ? sql`and e.created_at <= ${toTs}::timestamptz`
                    : sql``
              }
              ${
                after
                  ? sql`and (e.created_at, e.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                  : sql``
              }
            order by e.created_at desc, e.id desc
            limit ${pageSize + 1}
          `),
      );

      const hasMore = rows.length > pageSize;
      const pageRows: AuditExportRow[] = hasMore
        ? rows.slice(0, pageSize)
        : [...rows];
      for (const r of pageRows) {
        if (stageExport) {
          const meta = parseMeta(r.metadata);
          const from =
            typeof meta.from === 'string'
              ? meta.from
              : typeof meta.previous === 'string'
                ? meta.previous
                : '';
          const to =
            typeof meta.to === 'string'
              ? meta.to
              : typeof meta.status === 'string'
                ? meta.status
                : '';
          const reason =
            typeof meta.reason === 'string' ? meta.reason : '';
          const jobId =
            typeof meta.jobId === 'string' ? meta.jobId : '';
          reply.raw.write(
            [
              csvEscape(r.created_at),
              csvEscape(r.actor_name ?? r.actor_user_id ?? ''),
              csvEscape(r.subject_name ?? ''),
              csvEscape(r.job_title ?? ''),
              csvEscape(pipelineStageLabel(from)),
              csvEscape(pipelineStageLabel(to)),
              csvEscape(reason),
              csvEscape(r.resource_id ?? ''),
              csvEscape(jobId),
            ].join(',') + '\n',
          );
        } else {
          const meta =
            typeof r.metadata === 'string'
              ? r.metadata
              : JSON.stringify(r.metadata ?? {});
          reply.raw.write(
            [
              csvEscape(r.created_at),
              csvEscape(auditEventLabel(r.event_type)),
              csvEscape(r.actor_name ?? r.actor_user_id ?? ''),
              csvEscape(r.resource_type ?? ''),
              csvEscape(r.resource_id ?? ''),
              csvEscape(meta),
            ].join(',') + '\n',
          );
        }
        count += 1;
      }
      if (!hasMore || pageRows.length === 0) break;
      const last: AuditExportRow = pageRows[pageRows.length - 1]!;
      cursor = { createdAt: last.created_at, id: last.id };
      if (page === maxPages - 1 && hasMore) {
        truncated = true;
      }
    }

    reply.raw.write(
      `# export_meta count=${count} truncated=${truncated ? 'true' : 'false'}\n`,
    );

    await this.auditService.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'audit.exported',
      resourceType: 'audit',
      metadata: {
        kind: q.kind ?? (eventType ? 'filtered' : 'all'),
        count,
        streamed: true,
        truncated,
      },
    });
    reply.raw.end();
  }

  @RequirePermission('audit.read')
  @Post('audit/exports')
  async recordAuditExport(@Req() req: RequestWithAuth, @Body() body: unknown) {
    // Deprecated: prefer POST audit/export.csv which streams and records export itself.
    // Kept for back-compat but does not write audit.exported (avoids forged export events).
    parse(
      z
        .object({
          kind: z.enum(['all', 'stage']),
          count: z.number().int().min(0).max(100_000),
        })
        .strict(),
      body,
    );
    void req;
    return { recorded: false, deprecated: true };
  }
}
