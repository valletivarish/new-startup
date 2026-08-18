/**
 * Direct session-table operations that Better Auth does not own:
 * organization switching and security-driven invalidation.
 *
 * Sessions are opaque server-side rows, so revocation is a DELETE and takes
 * effect on the very next request (ADR-002 — the reason JWT was rejected).
 */

import { sql, withoutTenantContext, type Database } from '@platform/db';

export interface SessionService {
  /** Point a session at a new active organization (already validated). */
  setActiveOrganization(sessionToken: string, organizationId: string | null): Promise<void>;

  /**
   * Revoke every session a user holds in a given organization. Called on
   * membership removal, suspension, and role change — a demoted Agent
   * Manager must not keep deploy rights for even one more request.
   */
  invalidateForUserInOrganization(userId: string, organizationId: string): Promise<number>;

  /** Revoke everything the user holds (platform-level deactivation). */
  invalidateAllForUser(userId: string): Promise<number>;
}

export function createSessionService(database: Database): SessionService {
  return {
    async setActiveOrganization(sessionToken, organizationId) {
      await withoutTenantContext(database.db, async (tx) => {
        await tx.execute(sql`
          update sessions
          set active_organization_id = ${organizationId}, updated_at = now()
          where token = ${sessionToken}
        `);
      });
    },

    async invalidateForUserInOrganization(userId, organizationId) {
      return withoutTenantContext(database.db, async (tx) => {
        const result = await tx.execute(sql`
          delete from sessions
          where user_id = ${userId}
            and active_organization_id = ${organizationId}
        `);
        return result.count ?? 0;
      });
    },

    async invalidateAllForUser(userId) {
      return withoutTenantContext(database.db, async (tx) => {
        const result = await tx.execute(
          sql`delete from sessions where user_id = ${userId}`,
        );
        return result.count ?? 0;
      });
    },
  };
}
