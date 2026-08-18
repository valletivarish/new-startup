/**
 * Identity tables.
 *
 * These are owned by Better Auth (ADR-002) and hold identity only. They carry
 * no organization scope and are therefore in the RLS-exempt set enumerated in
 * `12_ARCHITECTURE_DECISIONS_FINAL.md` A6 — they must be readable before any
 * tenant context exists, because that is what establishes it.
 *
 * The authorization boundary is absolute: nothing in this file answers
 * "which organization" or "which permission". That lives in `authz.ts` and
 * `membership.ts`.
 *
 * IDs are uuid rather than Better Auth's default random string, so that every
 * foreign key in the system has one consistent type. Better Auth is configured
 * with `advanced.database.generateId` to emit uuids to match.
 */

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './columns.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Globally unique — one identity, many organizations (ADR-005). */
    email: citext('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    image: text('image'),
    /** active | suspended — platform-level, distinct from membership status. */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('users_status_idx').on(t.status)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Opaque session token — not a JWT (ADR-002). Stored so that revocation
     * is immediate when a membership or role changes.
     */
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Set server-side on login and on explicit switch, and re-validated
     * against an active membership on every request. Never read from a
     * header, query parameter, or request body.
     */
    activeOrganizationId: uuid('active_organization_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/** Credential and future OAuth account storage, managed by Better Auth. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Argon2/scrypt hash for the credential provider. Never logged. */
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

/** Email verification and password-reset tokens, managed by Better Auth. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);
