/**
 * Request authentication/authorization context — OUR layer, never delegated
 * to the authentication library (ADR-002 founder clarification, ADR-004).
 *
 * Per request:
 *   1. Better Auth resolves the opaque cookie to a session + user.
 *   2. If the session names an active organization, the membership is
 *      RE-VALIDATED against `organization_memberships` — every request,
 *      not just at switch time. A removed or suspended membership takes
 *      effect immediately even if session deletion raced.
 *   3. The membership's role resolves to a permission set.
 *
 * The organization id comes exclusively from the server-side session row.
 * Nothing in this file reads a header, query parameter, or request body.
 */

import {
  sql,
  withActorContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';
import { isPermission, type Permission } from '@platform/permissions';

import { ApiError } from '../errors.js';
import type { BetterAuthInstance } from '../auth/better-auth.js';

export interface AuthContext {
  readonly userId: string;
  readonly userEmail: string;
  readonly userName: string;
  readonly emailVerified: boolean;
  readonly sessionToken: string;
  /** Present only when an active organization is set AND the membership is live. */
  readonly organization: {
    readonly organizationId: string;
    readonly membershipId: string;
    readonly roleId: string;
    readonly roleKey: string;
    readonly permissions: ReadonlySet<Permission>;
  } | null;
}

export interface AuthContextService {
  /** Resolve a request's cookie/header set into a full context, or null. */
  resolve(headers: Headers): Promise<AuthContext | null>;
}

export function createAuthContextService(
  auth: BetterAuthInstance,
  database: Database,
): AuthContextService {
  return {
    async resolve(headers) {
      const resolved = await auth.api.getSession({ headers });
      if (!resolved) return null;

      const { user, session } = resolved;

      // Platform-level suspension wins over everything. FAIL CLOSED: if the
      // status field is ever missing (additionalFields config drift), every
      // request is refused loudly rather than every suspension silently
      // ignored (audit finding — the previous default was 'active').
      const status = (user as { status?: string }).status;
      if (status !== 'active') return null;

      const activeOrganizationId =
        (session as { activeOrganizationId?: string | null })
          .activeOrganizationId ?? null;

      const base = {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        emailVerified: user.emailVerified,
        sessionToken: session.token,
      };

      if (!activeOrganizationId) {
        return { ...base, organization: null };
      }

      // Re-validate the membership on every request (ADR-005 rule 3).
      const membership = await withActorContext(
        database.db,
        user.id,
        async (tx) => {
          const rows = await tx.execute<{
            membership_id: string;
            role_id: string;
            role_key: string;
          }>(sql`
            select m.id as membership_id, m.role_id, r.key as role_key
            from organization_memberships m
            join roles r on r.id = m.role_id
            where m.user_id = ${user.id}
              and m.organization_id = ${activeOrganizationId}
              and m.status = 'active'
            limit 1
          `);
          return rows[0] ?? null;
        },
      );

      if (!membership) {
        // The session points at an organization the user can no longer act
        // in. Fail closed: authenticated, but with no organization context.
        return { ...base, organization: null };
      }

      const permissionRows = await withoutTenantContext(
        database.db,
        async (tx) =>
          tx.execute<{ key: string }>(sql`
            select p.key
            from role_permissions rp
            join permissions p on p.id = rp.permission_id
            where rp.role_id = ${membership.role_id}
          `),
      );

      const permissions = new Set<Permission>();
      for (const row of permissionRows) {
        if (isPermission(row.key)) permissions.add(row.key);
      }

      return {
        ...base,
        organization: {
          organizationId: activeOrganizationId,
          membershipId: membership.membership_id,
          roleId: membership.role_id,
          roleKey: membership.role_key,
          permissions,
        },
      };
    },
  };
}

/** Narrow an AuthContext to one that definitely has an organization. */
export function requireOrganization(
  ctx: AuthContext,
): AuthContext & { organization: NonNullable<AuthContext['organization']> } {
  if (!ctx.organization) {
    throw ApiError.forbidden(
      'Select an organization first (POST /auth/switch-organization)',
    );
  }
  return ctx as AuthContext & {
    organization: NonNullable<AuthContext['organization']>;
  };
}
