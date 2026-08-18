/**
 * The knowledge model (Phase 3).
 *
 *   Organization → KnowledgeSource → KnowledgeDocument → KnowledgeChunk (vector)
 *
 * Every table is organization-owned and carries RLS with FORCE — the same
 * posture as Phases 1 and 2. Organization knowledge is potentially
 * confidential (`02_BRD` §7), so nothing here relaxes it.
 *
 * VERSIONING is the load-bearing idea. A document carries a monotonic
 * `version`, and every chunk records the `document_version` it was derived
 * from. Retrieval only ever reads chunks whose version equals the document's
 * `indexed_version`, so:
 *
 *   * a re-index writes a NEW version's chunks before flipping the pointer,
 *     making the switch atomic;
 *   * a retry deletes and rewrites only its own version, so it cannot
 *     duplicate;
 *   * a FAILED index never flips the pointer, so stale content is never
 *     silently served as current.
 */

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations.js';
import { users } from './auth.js';

/**
 * Embedding width for the vector column.
 *
 * pgvector needs a fixed dimension to index, and no embedding provider is
 * selected yet (ADR-006 condition), so this is a deliberate platform
 * constant rather than a provider's number. Changing it means a migration
 * plus a full re-index — which is exactly why every chunk records the
 * provider and dimension that produced it.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** file | text | faq | url_reference */
    type: text('type').notNull().default('text'),
    /** active | archived */
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').notNull().default({}),
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
    uniqueIndex('knowledge_sources_org_name_unique')
      .on(t.organizationId, t.name)
      .where(sql`${t.status} <> 'archived'`),
    index('knowledge_sources_org_status_idx').on(t.organizationId, t.status),
  ],
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    /**
     * Opaque reference resolved by the ObjectStorage adapter. Never a bucket
     * name, provider URL, or credential — the storage provider stays
     * swappable and nothing here leaks it.
     */
    storageKey: text('storage_key'),
    byteSize: integer('byte_size').notNull().default(0),
    /** SHA-256 of the content. Identical re-upload is a no-op, not a re-index. */
    checksum: text('checksum').notNull(),
    /** pending | processing | ready | failed | deleted */
    status: text('status').notNull().default('pending'),
    /** Bumped on every content change; drives re-indexing. */
    version: integer('version').notNull().default(1),
    /** The version whose chunks are currently live. NULL until first success. */
    indexedVersion: integer('indexed_version'),
    /** Which embedding provider produced the live chunks. */
    indexedWith: text('indexed_with'),
    chunkCount: integer('chunk_count').notNull().default(0),
    /** Business-language reason, safe to show a user. Never contains content. */
    failureReason: text('failure_reason'),
    failureCategory: text('failure_category'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingCompletedAt: timestamp('processing_completed_at', {
      withTimezone: true,
    }),
    processingDurationMs: integer('processing_duration_ms'),
    metadata: jsonb('metadata').notNull().default({}),
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
    // The same content in the same source is one document, not many. This is
    // what makes duplicate ingestion a no-op rather than a second copy.
    uniqueIndex('knowledge_documents_source_checksum_unique')
      .on(t.sourceId, t.checksum)
      .where(sql`${t.status} <> 'deleted'`),
    index('knowledge_documents_org_source_idx').on(t.organizationId, t.sourceId),
    index('knowledge_documents_org_status_idx').on(t.organizationId, t.status),
  ],
);

/**
 * One embedded chunk.
 *
 * `organization_id` is carried directly rather than reached through the
 * document: a vector search must be tenant-filtered by the RLS policy on THIS
 * table, without a join the planner might reorder.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    /** The document version this chunk was derived from. */
    documentVersion: integer('document_version').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenEstimate: integer('token_estimate').notNull().default(0),
    /** Section/heading path where the extractor could determine one. */
    section: text('section'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingProvider: text('embedding_provider'),
    embeddingDimensions: integer('embedding_dimensions'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A retry rewrites the same (document, version, index) rather than
    // appending — duplicate chunks are impossible by construction.
    uniqueIndex('knowledge_chunks_doc_version_index_unique').on(
      t.documentId,
      t.documentVersion,
      t.chunkIndex,
    ),
    index('knowledge_chunks_org_idx').on(t.organizationId),
    index('knowledge_chunks_doc_version_idx').on(t.documentId, t.documentVersion),
    index('knowledge_chunks_org_source_idx').on(t.organizationId, t.sourceId),
  ],
);

/**
 * Which knowledge an agent may draw on.
 *
 * A join table, NOT a copy: the same organization source can back a
 * recruitment agent and a support agent, each keeping its own configuration.
 * The agent version's configuration still lists references for authoring; this
 * table is the resolved, validated association the runtime queries.
 */
export const agentKnowledgeSources = pgTable(
  'agent_knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_knowledge_sources_unique').on(t.agentId, t.sourceId),
    index('agent_knowledge_sources_org_idx').on(t.organizationId),
  ],
);

/** Retained for observability without storing document content. */
export const knowledgeProcessingRuns = pgTable(
  'knowledge_processing_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    documentVersion: integer('document_version').notNull(),
    attempt: integer('attempt').notNull().default(1),
    /** started | completed | failed */
    status: text('status').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    chunkCount: integer('chunk_count').notNull().default(0),
    embeddingCount: integer('embedding_count').notNull().default(0),
    durationMs: integer('duration_ms'),
    failureCategory: text('failure_category'),
    /** A category and a short reason — never document content. */
    failureReason: text('failure_reason'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('knowledge_runs_org_doc_idx').on(t.organizationId, t.documentId),
    index('knowledge_runs_started_idx').on(t.startedAt),
  ],
);
