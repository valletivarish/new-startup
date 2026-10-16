/**
 * Client integrations (migration 0032): API keys, idempotency, call requests,
 * per-company limits, outbound webhooks and candidate links.
 * Plain tenant RLS; api_keys and candidate_links also have hash-lookup
 * policies reached through resolve_api_key() / resolve_candidate_link().
 */

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    mode: text('mode').notNull(),
    scopes: text('scopes').array().notNull(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('api_keys_mode_check', sql`${t.mode} in ('live', 'test')`),
    index('api_keys_org_idx').on(t.organizationId, t.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    organizationId: orgId(),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    body: jsonb('body'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.key, t.method, t.path] }),
    index('idempotency_keys_created_idx').on(t.createdAt),
  ],
);

export const callRequests = pgTable(
  'call_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    status: text('status').notNull().default('queued'),
    reason: text('reason'),
    notBefore: tstz('not_before'),
    voiceSessionId: uuid('voice_session_id').references(() => voiceSessions.id, {
      onDelete: 'set null',
    }),
    isTest: boolean('is_test').notNull().default(false),
    createdByKeyId: uuid('created_by_key_id').references(() => apiKeys.id, {
      onDelete: 'set null',
    }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('call_requests_source_check', sql`${t.source} in ('api', 'dashboard', 'link')`),
    check(
      'call_requests_status_check',
      sql`${t.status} in ('queued', 'scheduled', 'placing', 'placed', 'skipped', 'failed')`,
    ),
    index('call_requests_org_status_idx').on(t.organizationId, t.status, t.notBefore),
    index('call_requests_org_candidate_idx').on(t.organizationId, t.candidateId),
  ],
);

export const orgCallLimits = pgTable('org_call_limits', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  callsPerDay: integer('calls_per_day').notNull().default(50),
  maxConcurrent: integer('max_concurrent').notNull().default(3),
  monthlyCap: integer('monthly_cap'),
  pricePerScreenInr: numeric('price_per_screen_inr', { precision: 10, scale: 2 }),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: text('events').array().notNull(),
    disabledAt: tstz('disabled_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('webhook_endpoints_org_idx').on(t.organizationId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    deliveredAt: tstz('delivered_at'),
  },
  (t) => [
    check(
      'webhook_deliveries_status_check',
      sql`${t.status} in ('pending', 'delivered', 'failed')`,
    ),
    index('webhook_deliveries_due_idx')
      .on(t.organizationId, t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('webhook_deliveries_call_idx').on(
      t.organizationId,
      sql`((${t.payload}->'data'->>'callId'))`,
    ),
  ],
);

export const candidateLinks = pgTable(
  'candidate_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: orgId(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').references(() => candidates.id, {
      onDelete: 'cascade',
    }),
    /** The link creator: acts as the user for the candidate's call. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    isTest: boolean('is_test').notNull().default(false),
    /** Optional prefill from the company, shown to the candidate. */
    fullName: text('full_name'),
    email: text('email'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('candidate_links_org_job_idx').on(t.organizationId, t.jobId)],
);
