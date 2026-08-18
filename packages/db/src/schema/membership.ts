/**
 * The user ↔ organization relationship (ADR-005).
 *
 *   User ──< OrganizationMembership >── Organization
 *
 * The role lives on the *membership*, never on the user: the same person may
 * be an Owner in one organization and a Viewer in another.
 *
 * Both tables are organization-owned and carry RLS, but neither can use the
 * plain `organization_id = current_org_id()` policy, because both must be
 * readable *before* a tenant context exists:
 *
 *   memberships  — login must answer "which organizations is this user in?"
 *                  and every request re-validates `active_organization_id`.
 *                  Policy adds `OR user_id = current_actor_id()`: you may
 *                  always read your own membership rows.
 *
 *   invitations  — acceptance is a public route reached from an email link,
 *                  with no session and no organization.
 *                  Policy adds `OR token_hash = current_invitation_token_hash()`:
 *                  presenting the token is the authorization, and it exposes
 *                  exactly the one matching row.
 *
 * In both cases WITH CHECK stays strict on `organization_id`, so no widening
 * of *write* authority occurs. See the Phase 1 report — this resolves a
 * genuine contradiction in the approved architecture.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './columns.js';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations.js';
import { roles } from './authz.js';
import { users } from './auth.js';

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /** active | suspended */
    status: text('status').notNull().default('active'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('organization_memberships_user_org_unique').on(
      t.userId,
      t.organizationId,
    ),
    index('organization_memberships_org_role_idx').on(
      t.organizationId,
      t.roleId,
    ),
    index('organization_memberships_user_idx').on(t.userId),
  ],
);

export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /**
     * SHA-256 of the invitation token. The plaintext token is emailed and
     * never stored, so a database read cannot be replayed as an acceptance.
     */
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** pending | accepted | revoked | expired */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // At most one outstanding invitation per email per organization.
    uniqueIndex('organization_invitations_pending_unique')
      .on(t.organizationId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index('organization_invitations_org_idx').on(t.organizationId),
    index('organization_invitations_email_idx').on(t.email),
  ],
);
