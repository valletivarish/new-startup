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
} from '@nestjs/common';
import { z } from 'zod';
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
  INVITATIONS_SERVICE,
  MEMBERS_SERVICE,
  ORGANIZATIONS_SERVICE,
} from './tokens.js';
import type { OrganizationsService } from './organizations/organizations.service.js';
import type { MembersService } from './organizations/members.service.js';
import type { InvitationsService } from './organizations/invitations.service.js';
import type { AuditService } from './audit/audit.service.js';
import type { SessionService } from './auth/session.service.js';
import { SESSION_SERVICE } from './tokens.more.js';

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
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

// ---------------------------------------------------------------------------

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ORGANIZATIONS_SERVICE) private readonly orgs: OrganizationsService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

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
    // Joining an organization activates it if the session has none.
    if (!ctx.organization) {
      await this.sessions.setActiveOrganization(
        ctx.sessionToken,
        result.organizationId,
      );
    }
    return result;
  }
}

// ---------------------------------------------------------------------------

@Controller()
export class CatalogueController {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

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
    const { limit, cursor } = parse(PaginationQuery, query ?? {});
    const after = cursor ? decodeCursor(cursor) : null;

    const rows = await withTenantContext(
      this.database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) =>
        tx.execute<{
          id: string;
          actor_user_id: string | null;
          event_type: string;
          resource_type: string | null;
          resource_id: string | null;
          metadata: unknown;
          created_at: string;
        }>(sql`
          select id, actor_user_id, event_type, resource_type, resource_id,
                 metadata, created_at::text
          from audit_events
          where organization_id = ${actor.organizationId}
            ${
              after
                ? sql`and (created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                : sql``
            }
          -- id is the tiebreaker: rows sharing a timestamp must not be
          -- skipped or repeated across pages.
          order by created_at desc, id desc
          limit ${limit + 1}
        `),
    );

    const page = toPage(rows, limit);
    return { events: page.items, nextCursor: page.nextCursor };
  }
}
