/**
 * The agent model (Phase 2).
 *
 *   Organization → Agent → AgentVersion → AgentSession → AgentEvent
 *
 * Every table here is organization-owned and carries RLS with FORCE, the
 * same posture as Phase 1 — no new isolation mechanism, no exceptions.
 *
 * Agents are CONFIGURATION, not code (`03_SYSTEM_ARCHITECTURE` §6). The core
 * Agent row holds identity and lifecycle only; everything behavioural lives
 * in the versioned configuration, and nothing provider-specific lives in
 * either.
 */

import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations.js';
import { users } from './auth.js';

/**
 * An agent.
 *
 * `status` is the lifecycle state: draft | published | paused | archived.
 * Transitions are enforced in the service layer and covered by tests; the
 * column stores the current state only.
 */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    purpose: text('purpose').notNull().default(''),
    /** Business category — recruitment, sales, support. NOT a provider. */
    type: text('type').notNull().default('general'),
    status: text('status').notNull().default('draft'),
    /**
     * The published version currently serving sessions. NULL while an agent
     * has never been published. Deliberately RESTRICT: a version that an
     * agent points at cannot be deleted out from under it.
     */
    currentVersionId: uuid('current_version_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Agent names are unique within an organization, and only among agents
    // that are still live — an archived agent must not block reuse of its name.
    uniqueIndex('agents_org_name_unique')
      .on(t.organizationId, t.name)
      .where(sql`${t.status} <> 'archived'`),
    index('agents_org_status_idx').on(t.organizationId, t.status),
    index('agents_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

/**
 * An immutable-once-published snapshot of an agent's configuration.
 *
 * Immutability is enforced by a database trigger (migration 0006), not by
 * application discipline: a published version is what running sessions are
 * pinned to, so "we always remember to check" is not a strong enough
 * guarantee. Editing a published agent creates a NEW draft version.
 */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Monotonic per agent, starting at 1. */
    version: integer('version').notNull(),
    /** Validated against the AgentConfiguration contract before it is stored. */
    configuration: jsonb('configuration').notNull(),
    /** draft | published | superseded | archived */
    status: text('status').notNull().default('draft'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_versions_agent_version_unique').on(t.agentId, t.version),
    // At most ONE draft per agent: concurrent draft creation is a conflict,
    // not two rival drafts silently diverging.
    uniqueIndex('agent_versions_one_draft_per_agent')
      .on(t.agentId)
      .where(sql`${t.status} = 'draft'`),
    // At most ONE published version per agent — the database, not the
    // application, is what makes "current version" unambiguous under
    // concurrent publishes.
    uniqueIndex('agent_versions_one_published_per_agent')
      .on(t.agentId)
      .where(sql`${t.status} = 'published'`),
    index('agent_versions_org_agent_idx').on(t.organizationId, t.agentId),
  ],
);

/**
 * A conversation with an agent.
 *
 * The session PINS the exact agent version it started with. Publishing a new
 * version must never change the behaviour of a conversation already in
 * progress — that is the whole point of versioning, and the reason
 * `agentVersionId` is NOT NULL and never updated.
 */
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    /** The pinned version. RESTRICT: a version in use cannot be removed. */
    agentVersionId: uuid('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'restrict' }),
    /** active | ended */
    status: text('status').notNull().default('active'),
    /**
     * Channel the session runs over. `text` in Phase 2; `voice` arrives in
     * Phase 5 without any change to this model.
     */
    channel: text('channel').notNull().default('text'),
    /**
     * Opaque business linkage — a candidate, a ticket, a lead. Deliberately
     * untyped here so the generic runtime carries no recruitment vocabulary.
     */
    businessContext: jsonb('business_context').notNull().default({}),
    /**
     * The next sequence number to assign. Incremented under a row lock, which
     * is what makes per-session event ordering deterministic under concurrency.
     */
    nextSequence: bigint('next_sequence', { mode: 'number' })
      .notNull()
      .default(1),
    endedReason: text('ended_reason'),
    correlationId: text('correlation_id'),
    startedByUserId: uuid('started_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('agent_sessions_org_agent_idx').on(t.organizationId, t.agentId),
    index('agent_sessions_org_status_idx').on(t.organizationId, t.status),
    index('agent_sessions_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

/**
 * One event in a session's ordered stream.
 *
 * Append-only by design: events are the record of what happened, so the
 * runtime never rewrites one. `sequence` is unique per session, which turns
 * ordering from an assumption about network delivery into a database
 * guarantee.
 */
export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSessions.id, { onDelete: 'cascade' }),
    /** Monotonic within the session. Assigned server-side, never by a client. */
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    direction: text('direction').notNull(),
    payload: jsonb('payload').notNull().default({}),
    /**
     * Client-supplied deduplication key. Unique per session, so a retry
     * cannot append a second logical event.
     */
    idempotencyKey: text('idempotency_key'),
    correlationId: text('correlation_id'),
    /** The inbound event that caused this one, for outbound events. */
    causedByEventId: uuid('caused_by_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_events_session_sequence_unique').on(
      t.sessionId,
      t.sequence,
    ),
    uniqueIndex('agent_events_session_idempotency_unique')
      .on(t.sessionId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('agent_events_org_session_idx').on(t.organizationId, t.sessionId),
    index('agent_events_session_seq_idx').on(t.sessionId, t.sequence),
  ],
);
