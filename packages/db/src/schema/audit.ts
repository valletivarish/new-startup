/**
 * Audit events.
 *
 * `organization_id` is NULLABLE, which is a deliberate extension of the shape
 * in `04_DATABASE_API_SPEC.md`. Several events that must be audited happen
 * before any organization context exists — registration, login, failed login,
 * password reset, invitation acceptance. Forcing an organization onto them
 * would mean either inventing one or not auditing them at all.
 *
 * Consequence, by design:
 *   * rows with an organization are visible to that organization's auditors
 *     via `GET /audit`, subject to the `audit.read` permission;
 *   * rows with a NULL organization are platform-level and are NOT visible
 *     through the tenant-scoped API at all.
 *
 * Never contains credentials, tokens, session values, or candidate personal
 * data (`07_CODING_RULES` §7). Metadata is validated before it is written.
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './auth.js';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * NULL for platform-level events with no tenant context. SET NULL on org
     * deletion so the trail — including the deletion record itself — is
     * preserved as platform-level history rather than cascading away.
     */
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    /** Retained after membership ends, so the trail survives offboarding. */
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** e.g. `auth.login`, `membership.role_changed`, `authz.denied`. */
    eventType: text('event_type').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_events_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_events_actor_idx').on(t.actorUserId),
    index('audit_events_type_idx').on(t.eventType),
  ],
);
