/**
 * Tenant context — the single place where a request's organization scope is
 * bound to a database transaction.
 *
 * ADR-003, and the engineering rule elevated by the founder:
 *
 *     "No cross-tenant data access, even accidentally."
 *
 * Every organization-scoped database access in the platform goes through one
 * of the functions in this file. There is no other way to reach the database
 * with a tenant context, and there is deliberately NO escape hatch that
 * disables row-level security.
 *
 * Rules enforced here:
 *
 *   1. Context is set with `set_config(..., is_local => true)`, which is the
 *      parameterised equivalent of SET LOCAL. It is scoped to the surrounding
 *      transaction and is discarded on commit or rollback — so a pooled
 *      connection can never carry a stale organization into the next request.
 *
 *   2. Every call opens an EXPLICIT transaction. `SET LOCAL` outside a
 *      transaction is a silent no-op that would leave policies evaluating a
 *      NULL organization, and with transaction-mode pooling a session-level
 *      `SET` would leak across requests. Both are the classic footgun ADR-003
 *      names by name.
 *
 *   3. The identifiers are passed as bind parameters, never interpolated.
 *
 *   4. Callers supply values taken from the authenticated server-side session.
 *      Nothing here reads a header, query parameter, or request body — the
 *      types make it awkward to do otherwise, and the API layer validates the
 *      membership before calling in.
 *
 * TWO DOCUMENTED EXCEPTIONS to rule 4, both bootstrap cases where the caller
 * provably owns the organization but no membership exists yet to validate
 * against. Any third case is a bug, not a precedent:
 *
 *   a. Organization creation — the org row and the creator's Owner membership
 *      are written in ONE transaction under the new organization's context.
 *      The id was generated microseconds earlier by this same request.
 *
 *   b. Invitation acceptance — the organization is selected by the invitation
 *      token, which the caller proved possession of, and whose email must
 *      match the authenticated session.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

/** A tenant-scoped transaction handle. */
export type TenantTransaction = Parameters<
  Parameters<PostgresJsDatabase<Record<string, never>>['transaction']>[0]
>[0];

export interface TenantContext {
  /** The session's validated active organization. */
  readonly organizationId: string;
  /** The authenticated user acting in that organization. */
  readonly userId: string;
}

// Shape only, no version/variant constraint: the nil uuid is a legitimate
// sentinel for system actors, and Postgres accepts any hex layout.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Defence in depth. These values are already derived from the session, but a
 * malformed one would make `NULLIF(...)::uuid` raise inside policy evaluation
 * on every row — a confusing failure a long way from its cause. Reject early.
 */
function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`tenant context: ${field} is not a uuid`);
  }
}

/**
 * Run `fn` with full tenant context. This is the default for every
 * organization-scoped operation.
 *
 * Row-level security restricts the transaction to `organizationId`. The
 * application layer must STILL filter by `organization_id` in its queries —
 * RLS is the backstop, not the primary mechanism (ADR-003, three layers).
 */
export async function withTenantContext<T>(
  db: PostgresJsDatabase<Record<string, never>>,
  ctx: TenantContext,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertUuid(ctx.organizationId, 'organizationId');
  assertUuid(ctx.userId, 'userId');

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org_id', ${ctx.organizationId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.current_user_id', ${ctx.userId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Run `fn` with an authenticated user but NO organization.
 *
 * This is the login and organization-switching path: listing the caller's
 * memberships, and creating a new organization. The membership policy's
 * `OR user_id = current_actor_id()` clause makes exactly the caller's own
 * membership rows visible and nothing else.
 *
 * Every genuinely organization-owned table stays empty in this context,
 * because `current_org_id()` is NULL — which is the fail-closed behaviour.
 */
export async function withActorContext<T>(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertUuid(userId, 'userId');

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Run `fn` with only an invitation token hash in scope.
 *
 * Used by the public invitation-acceptance route, which has no session and no
 * organization. Knowledge of the unguessable token is the credential; the
 * policy exposes exactly the one invitation row whose hash matches.
 *
 * Note this grants no write authority: the invitation policy's WITH CHECK
 * still requires a matching `organization_id`, so accepting an invitation is
 * completed in a second, properly scoped transaction.
 */
export async function withInvitationContext<T>(
  db: PostgresJsDatabase<Record<string, never>>,
  tokenHash: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
    throw new Error('tenant context: invitation token hash must be sha-256 hex');
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.invitation_token_hash', ${tokenHash}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Run `fn` with NO tenant context at all.
 *
 * Reaches only the RLS-exempt identity tables (`users`, `sessions`,
 * `accounts`, `verifications`, `organizations`, `permissions`,
 * `role_permissions`). Every organization-owned table returns zero rows.
 *
 * This is NOT a bypass — it is the absence of context, and it is what the
 * authentication layer uses before an identity is established. There is no
 * function in this module that disables row-level security, and none should
 * ever be added: `platform_app` has no DDL and no BYPASSRLS, so the database
 * would refuse anyway.
 */
export async function withoutTenantContext<T>(
  db: PostgresJsDatabase<Record<string, never>>,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}
