/**
 * Audit events (`02_BRD` §14, matrix structural invariant 7).
 *
 * Records: authentication events, membership and role changes, permission
 * denials, sensitive-permission use, organization switching, invitation
 * lifecycle.
 *
 * Never logs credentials, tokens, session values, or personal data beyond
 * the acting identifiers (`07_CODING_RULES` §7). Audit writes must never
 * take the request down with them — a failed audit write is logged and
 * swallowed, because a 500 on every action would be worse than a gap in
 * the trail. The pino log line preserves the record either way.
 */

import {
  sql,
  withTenantContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';
import type { Logger } from 'pino';

export interface AuditRecord {
  /** Null for platform-level events with no tenant context (login, register). */
  readonly organizationId: string | null;
  readonly actorUserId: string | null;
  readonly eventType: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditService {
  record(entry: AuditRecord): Promise<void>;
}

export function createAuditService(
  database: Database,
  logger: Logger,
): AuditService {
  return {
    async record(entry) {
      const metadata = entry.metadata ?? {};
      try {
        if (entry.organizationId) {
          // Tenant-scoped write. The actor id doubles as the RLS actor.
          await withTenantContext(
            database.db,
            {
              organizationId: entry.organizationId,
              // System events without an actor still need a valid uuid for
              // the context wrapper; use the nil uuid, stored as NULL below.
              userId: entry.actorUserId ?? '00000000-0000-0000-0000-000000000000',
            },
            async (tx) => {
              await tx.execute(sql`
                insert into audit_events
                  (organization_id, actor_user_id, event_type, resource_type, resource_id, metadata)
                values
                  (${entry.organizationId}, ${entry.actorUserId}, ${entry.eventType},
                   ${entry.resourceType ?? null}, ${entry.resourceId ?? null}, ${JSON.stringify(metadata)})
              `);
            },
          );
        } else {
          // Platform-level event. WITH CHECK permits NULL organization_id.
          await withoutTenantContext(database.db, async (tx) => {
            await tx.execute(sql`
              insert into audit_events
                (organization_id, actor_user_id, event_type, resource_type, resource_id, metadata)
              values
                (null, ${entry.actorUserId}, ${entry.eventType},
                 ${entry.resourceType ?? null}, ${entry.resourceId ?? null}, ${JSON.stringify(metadata)})
            `);
          });
        }
        logger.info(
          { audit: entry.eventType, org: entry.organizationId, actor: entry.actorUserId },
          'audit.recorded',
        );
      } catch (error) {
        // The full entry is preserved in the log so a failed database write
        // never silently loses the record (audit finding — the previous
        // fallback kept only the event type).
        logger.error(
          { audit: entry, err: (error as Error).message },
          'audit.write_failed',
        );
      }
    },
  };
}
