/**
 * Zoho Recruit connector (migration 0037). Plain tenant RLS on every table.
 * secrets_sealed is AES-256-GCM sealed by the API; it never holds a readable token.
 */

import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations.js';
import { users } from './auth.js';
import { jobs, candidates } from './hiring.js';
import { voiceSessions } from './voice.js';

const orgId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const zohoConnections = pgTable(
  'zoho_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId().unique(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('connected'),
    accountsServer: text('accounts_server').notNull(),
    recruitBase: text('recruit_base').notNull(),
    secretsSealed: text('secrets_sealed').notNull(),
    consentConfirmedAt: tstz('consent_confirmed_at').notNull(),
    syncCursor: tstz('sync_cursor'),
    syncLeaseUntil: tstz('sync_lease_until'),
    lastSyncAt: tstz('last_sync_at'),
    lastError: text('last_error'),
    pausedUntil: tstz('paused_until'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('zoho_connections_status_check', sql`${t.status} in ('connected', 'needs_attention')`)],
);

export const zohoOauthStates = pgTable(
  'zoho_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    organizationId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeVerifier: text('code_verifier').notNull(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [index('zoho_oauth_states_org_idx').on(t.organizationId)],
);

export const zohoJobLinks = pgTable(
  'zoho_job_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => zohoConnections.id, { onDelete: 'cascade' }),
    zohoJobId: text('zoho_job_id').notNull(),
    zohoJobTitle: text('zoho_job_title').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    autoCall: boolean('auto_call').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.connectionId, t.zohoJobId), index('zoho_job_links_org_idx').on(t.organizationId)],
);

export const zohoApplicants = pgTable(
  'zoho_applicants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => zohoConnections.id, { onDelete: 'cascade' }),
    zohoApplicationId: text('zoho_application_id').notNull(),
    zohoCandidateId: text('zoho_candidate_id'),
    zohoJobId: text('zoho_job_id').notNull(),
    fullName: text('full_name').notNull(),
    candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'set null' }),
    closed: boolean('closed').notNull().default(false),
    skipReason: text('skip_reason'),
    modifiedTime: tstz('modified_time').notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.connectionId, t.zohoApplicationId),
    index('zoho_applicants_candidate_idx').on(t.organizationId, t.candidateId),
    check(
      'zoho_applicants_skip_reason_check',
      sql`${t.skipReason} is null or ${t.skipReason} in ('closed_in_zoho', 'no_phone', 'invalid_phone', 'duplicate_phone')`,
    ),
  ],
);

export const zohoNotes = pgTable(
  'zoho_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => zohoConnections.id, { onDelete: 'cascade' }),
    voiceSessionId: uuid('voice_session_id')
      .notNull()
      .references(() => voiceSessions.id, { onDelete: 'cascade' }),
    zohoCandidateId: text('zoho_candidate_id').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
  },
  (t) => [
    unique().on(t.connectionId, t.voiceSessionId),
    index('zoho_notes_org_status_idx').on(t.organizationId, t.status),
    check('zoho_notes_status_check', sql`${t.status} in ('pending', 'sent', 'failed')`),
  ],
);
