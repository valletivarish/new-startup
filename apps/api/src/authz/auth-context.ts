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
 * The organization id comes exclusively from the server-side session row,
 * or — for `Authorization: Bearer hrv_…` company API keys — from the key's
 * own row. A key acts as its creator in the key's organization: the same
 * user-status and membership checks run on every request, and permissions
 * are narrowed to the key's scopes. No other header, query parameter, or
 * request body is read here.
 */

import {
  sql,
  withActorContext,
  withTenantContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';
import { isPermission, type Permission } from '@platform/permissions';

import { ApiError } from '../errors.js';
import type { BetterAuthInstance } from '../auth/better-auth.js';
import {
  createKeyRateLimiter,
  hashKey,
  type ApiKeyMode,
  type KeyRateLimiter,
} from '../integrations/api-keys.service.js';
import { scopePermissions } from '../integrations/scopes.js';

const BEARER_KEY_RE = /^Bearer (hrv_(live|test)_[A-Za-z0-9]{32})$/;

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
  /** Set when the request authenticated with a company API key; null for cookie sessions. */
  readonly apiKey: { readonly id: string; readonly name: string; readonly mode: ApiKeyMode } | null;
}

export interface AuthContextService {
  /** Resolve a request's cookie/header set into a full context, or null. */
  resolve(headers: Headers): Promise<AuthContext | null>;
}

export function createAuthContextService(
  auth: BetterAuthInstance,
  database: Database,
  keyLimiter: KeyRateLimiter = createKeyRateLimiter(),
): AuthContextService {
  /** Live membership + role permissions, re-validated on every request (ADR-005 rule 3). */
  async function loadOrganization(
    userId: string,
    organizationId: string,
  ): Promise<NonNullable<AuthContext['organization']> | null> {
    const membership = await withActorContext(database.db, userId, async (tx) => {
      const rows = await tx.execute<{
        membership_id: string;
        role_id: string;
        role_key: string;
      }>(sql`
        select m.id as membership_id, m.role_id, r.key as role_key
        from organization_memberships m
        join roles r on r.id = m.role_id
        where m.user_id = ${userId}
          and m.organization_id = ${organizationId}
          and m.status = 'active'
        limit 1
      `);
      return rows[0] ?? null;
    });
    if (!membership) return null;

    const permissionRows = await withoutTenantContext(database.db, async (tx) =>
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
      organizationId,
      membershipId: membership.membership_id,
      roleId: membership.role_id,
      roleKey: membership.role_key,
      permissions,
    };
  }

  async function resolveApiKey(key: string): Promise<AuthContext | null> {
    const found = await withoutTenantContext(database.db, async (tx) => {
      const rows = await tx.execute<{
        id: string;
        organization_id: string;
        created_by_user_id: string;
        mode: ApiKeyMode;
        scopes: string[];
        revoked_at: unknown;
        kind: string;
      }>(sql`select * from resolve_api_key(${hashKey(key)})`);
      return rows[0] ?? null;
    });
    // A publishable (careers-page) key is never a bearer key, whatever its format.
    if (!found || found.revoked_at !== null || found.kind !== 'secret') return null;

    keyLimiter.check(found.id);

    // Same rule as the session path: platform suspension wins; fail closed.
    const user = await withoutTenantContext(database.db, async (tx) => {
      const rows = await tx.execute<{
        email: string;
        name: string;
        email_verified: boolean;
        status: string;
      }>(sql`
        select email, name, email_verified, status
        from users where id = ${found.created_by_user_id}
      `);
      return rows[0] ?? null;
    });
    if (!user || user.status !== 'active') return null;

    const organization = await loadOrganization(
      found.created_by_user_id,
      found.organization_id,
    );
    // Creator removed or suspended: the key dies with the membership.
    if (!organization) return null;

    const allowed = scopePermissions(found.scopes);
    const permissions = new Set(
      [...organization.permissions].filter((p) => allowed.has(p)),
    );

    const name = await withTenantContext(
      database.db,
      { organizationId: found.organization_id, userId: found.created_by_user_id },
      async (tx) => {
        await tx.execute(sql`
          update api_keys set last_used_at = now()
          where id = ${found.id}
            and (last_used_at is null or last_used_at < now() - interval '1 minute')
        `);
        const rows = await tx.execute<{ name: string }>(
          sql`select name from api_keys where id = ${found.id}`,
        );
        return rows[0]?.name ?? '';
      },
    );

    return {
      userId: found.created_by_user_id,
      userEmail: user.email,
      userName: user.name,
      emailVerified: user.email_verified,
      sessionToken: '',
      organization: { ...organization, permissions },
      apiKey: { id: found.id, name, mode: found.mode },
    };
  }

  return {
    async resolve(headers) {
      const bearer = BEARER_KEY_RE.exec(headers.get('authorization') ?? '');
      if (bearer?.[1]) return resolveApiKey(bearer[1]);

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
        apiKey: null,
      };

      if (!activeOrganizationId) {
        return { ...base, organization: null };
      }

      // The session points at an organization the user may no longer act
      // in. Fail closed: authenticated, but with no organization context.
      const organization = await loadOrganization(user.id, activeOrganizationId);
      return { ...base, organization };
    },
  };
}

/** Narrow an AuthContext to one that definitely has an organization. */
export function requireOrganization(
  ctx: AuthContext,
): AuthContext & { organization: NonNullable<AuthContext['organization']> } {
  if (!ctx.organization) {
    throw ApiError.forbidden('Create or open your company first.');
  }
  return ctx as AuthContext & {
    organization: NonNullable<AuthContext['organization']>;
  };
}
