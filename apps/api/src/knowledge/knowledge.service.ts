/**
 * Knowledge sources and documents.
 *
 * Ingestion is deliberately split: the API request does validation, storage
 * and a `pending` row, then returns. Extraction, chunking and embedding all
 * happen on the pg-boss worker, because a document that takes ten seconds to
 * index must not hold an HTTP request open for ten seconds.
 *
 * The version model is what makes re-indexing safe. A document's live chunks
 * are those whose `document_version` equals its `indexed_version`. Processing
 * writes a new version's chunks first and flips the pointer last, so a failure
 * leaves the previous version serving and never marks a document ready on
 * content it did not successfully index.
 */

import { createHash } from 'node:crypto';
import { sql, withTenantContext, type Database } from '@platform/db';

import type { ObjectStorage } from '@platform/providers';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { JobQueue } from '../jobs/queue.js';
import { validateUpload } from './formats.js';
import { extractDocumentText } from './document-text.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export const SOURCE_TYPES = ['file', 'text', 'faq', 'url_reference'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DOCUMENT_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
  'deleted',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Permitted document transitions. Anything else is refused, so a document
 * cannot be marked ready without having been processed.
 */
const DOCUMENT_TRANSITIONS: Readonly<
  Record<DocumentStatus, readonly DocumentStatus[]>
> = {
  pending: ['processing', 'failed', 'deleted'],
  processing: ['ready', 'failed', 'deleted'],
  // A ready document can be re-indexed (back to pending) or removed.
  ready: ['pending', 'processing', 'deleted'],
  failed: ['pending', 'processing', 'deleted'],
  deleted: [],
};

export function canTransitionDocument(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  return DOCUMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly status: string;
  readonly documentCount: number;
  readonly createdAt: string;
}

export interface DocumentRow {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly status: string;
  readonly version: number;
  readonly indexedVersion: number | null;
  readonly chunkCount: number;
  readonly failureReason: string | null;
  readonly failureCategory: string | null;
  readonly createdAt: string;
}

export interface KnowledgeService {
  listSources(actor: Actor): Promise<readonly SourceRow[]>;
  getSource(actor: Actor, sourceId: string): Promise<SourceRow>;
  createSource(
    actor: Actor,
    input: { name: string; description?: string; type?: SourceType },
  ): Promise<{ id: string }>;
  updateSource(
    actor: Actor,
    sourceId: string,
    input: { name?: string; description?: string },
  ): Promise<void>;
  deleteSource(actor: Actor, sourceId: string): Promise<void>;

  listDocuments(actor: Actor, sourceId?: string): Promise<readonly DocumentRow[]>;
  getDocument(actor: Actor, documentId: string): Promise<DocumentRow>;
  createDocument(
    actor: Actor,
    input: {
      sourceId: string;
      name: string;
      contentType: string;
      content: string;
      /** utf8 for pasted text; base64 for PDF / Word / PowerPoint bytes. */
      contentEncoding?: 'utf8' | 'base64';
    },
  ): Promise<{ id: string; status: string; deduplicated: boolean }>;
  deleteDocument(actor: Actor, documentId: string): Promise<void>;
  reindexDocument(actor: Actor, documentId: string): Promise<{ version: number }>;
}

type SourceRecord = {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  document_count: string | number;
  created_at: string;
};

type DocumentRecord = {
  id: string;
  source_id: string;
  name: string;
  content_type: string;
  byte_size: number;
  status: string;
  version: number;
  indexed_version: number | null;
  chunk_count: number;
  failure_reason: string | null;
  failure_category: string | null;
  created_at: string;
};

function toSource(r: SourceRecord): SourceRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    status: r.status,
    documentCount: Number(r.document_count),
    createdAt: r.created_at,
  };
}

function toDocument(r: DocumentRecord): DocumentRow {
  return {
    id: r.id,
    sourceId: r.source_id,
    name: r.name,
    contentType: r.content_type,
    byteSize: Number(r.byte_size),
    status: r.status,
    version: Number(r.version),
    indexedVersion: r.indexed_version === null ? null : Number(r.indexed_version),
    chunkCount: Number(r.chunk_count),
    failureReason: r.failure_reason,
    failureCategory: r.failure_category,
    createdAt: r.created_at,
  };
}

/**
 * Runs a document through the pipeline when no worker is available.
 *
 * This is NOT a test-only shortcut: it is the same processor the worker
 * calls, invoked inline. A deployment without a worker still indexes
 * documents — more slowly, and in the request — rather than leaving them
 * silently pending forever, which would be the worse failure.
 */
export type InlineProcessor = (job: {
  organizationId: string;
  actorUserId: string;
  documentId: string;
  version: number;
}) => Promise<unknown>;

export function createKnowledgeService(
  database: Database,
  audit: AuditService,
  jobs: JobQueue | null,
  storage: ObjectStorage,
  processInline?: InlineProcessor,
): KnowledgeService {
  type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];

  async function loadSource(
    tx: Tx,
    actor: Actor,
    sourceId: string,
    forUpdate = false,
  ): Promise<{ id: string; status: string }> {
    const rows = await tx.execute<{ id: string; status: string }>(sql`
      select id, status from knowledge_sources
      where id = ${sourceId} and organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update` : sql``}
    `);
    const source = rows[0];
    // A foreign id and a nonexistent one are indistinguishable.
    if (!source) throw ApiError.notFound('Knowledge source');
    return source;
  }

  async function loadDocument(
    tx: Tx,
    actor: Actor,
    documentId: string,
    forUpdate = false,
  ): Promise<DocumentRecord> {
    const rows = await tx.execute<DocumentRecord>(sql`
      select id, source_id, name, content_type, byte_size, status, version,
             indexed_version, chunk_count, failure_reason, failure_category,
             created_at::text
      from knowledge_documents
      where id = ${documentId} and organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update` : sql``}
    `);
    const doc = rows[0];
    if (!doc || doc.status === 'deleted') {
      throw ApiError.notFound('Document');
    }
    return doc;
  }

  /** Queue processing, or run it inline when there is no worker. */
  async function enqueueProcessing(
    actor: Actor,
    documentId: string,
    version: number,
  ): Promise<void> {
    const job = {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      documentId,
      version,
    };

    if (jobs) {
      await jobs.enqueueDocumentProcessing(
        job,
        // Keyed on document AND version: re-queuing the same version is a
        // no-op, so a double click cannot start two indexing runs.
        `knowledge:${documentId}:${version}`,
      );
      return;
    }
    await processInline?.(job);
  }

  return {
    async listSources(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<SourceRecord>(sql`
            select s.id, s.name, s.description, s.type, s.status,
                   s.created_at::text,
                   (select count(*) from knowledge_documents d
                     where d.source_id = s.id
                       and d.organization_id = ${actor.organizationId}
                       and d.status <> 'deleted') as document_count
            from knowledge_sources s
            where s.organization_id = ${actor.organizationId}
              and s.status <> 'archived'
            order by s.created_at desc
          `),
      );
      return rows.map(toSource);
    },

    async getSource(actor, sourceId) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadSource(tx, actor, sourceId);
          return tx.execute<SourceRecord>(sql`
            select s.id, s.name, s.description, s.type, s.status,
                   s.created_at::text,
                   (select count(*) from knowledge_documents d
                     where d.source_id = s.id
                       and d.organization_id = ${actor.organizationId}
                       and d.status <> 'deleted') as document_count
            from knowledge_sources s
            where s.id = ${sourceId} and s.organization_id = ${actor.organizationId}
          `);
        },
      );
      const found = rows[0];
      if (!found) throw ApiError.notFound('Knowledge source');
      return toSource(found);
    },

    async createSource(actor, input) {
      const id = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          try {
            const rows = await tx.execute<{ id: string }>(sql`
              insert into knowledge_sources
                (organization_id, name, description, type, created_by_user_id)
              values (${actor.organizationId}, ${input.name},
                      ${input.description ?? ''}, ${input.type ?? 'text'},
                      ${actor.userId})
              returning id
            `);
            const created = rows[0]?.id;
            if (!created) throw new Error('source insert returned no id');
            return created;
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                `A knowledge source named "${input.name}" already exists`,
              );
            }
            throw error;
          }
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'knowledge.source.created',
        resourceType: 'knowledge_source',
        resourceId: id,
        metadata: { name: input.name, type: input.type ?? 'text' },
      });
      return { id };
    },

    async updateSource(actor, sourceId, input) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadSource(tx, actor, sourceId, true);
          await tx.execute(sql`
            update knowledge_sources set
              name = coalesce(${input.name ?? null}, name),
              description = coalesce(${input.description ?? null}, description),
              updated_at = now()
            where id = ${sourceId} and organization_id = ${actor.organizationId}
          `);
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'knowledge.source.updated',
        resourceType: 'knowledge_source',
        resourceId: sourceId,
      });
    },

    async deleteSource(actor, sourceId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadSource(tx, actor, sourceId, true);
          // Archive rather than hard-delete: agents may reference it, and the
          // audit trail should still resolve the name.
          await tx.execute(sql`
            update knowledge_sources set status = 'archived', updated_at = now()
            where id = ${sourceId} and organization_id = ${actor.organizationId}
          `);
          await tx.execute(sql`
            update knowledge_documents set status = 'deleted', updated_at = now()
            where source_id = ${sourceId}
              and organization_id = ${actor.organizationId}
              and status <> 'deleted'
          `);
          // Chunks go immediately: deleted content must not remain retrievable.
          await tx.execute(sql`
            delete from knowledge_chunks
            where source_id = ${sourceId} and organization_id = ${actor.organizationId}
          `);
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'knowledge.source.deleted',
        resourceType: 'knowledge_source',
        resourceId: sourceId,
      });
    },

    async listDocuments(actor, sourceId) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<DocumentRecord>(sql`
            select id, source_id, name, content_type, byte_size, status, version,
                   indexed_version, chunk_count, failure_reason, failure_category,
                   created_at::text
            from knowledge_documents
            where organization_id = ${actor.organizationId}
              and status <> 'deleted'
              ${sourceId ? sql`and source_id = ${sourceId}` : sql``}
            order by created_at desc
            limit 200
          `),
      );
      return rows.map(toDocument);
    },

    async getDocument(actor, documentId) {
      const doc = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadDocument(tx, actor, documentId),
      );
      return toDocument(doc);
    },

    async createDocument(actor, input) {
      const encoding = input.contentEncoding ?? 'utf8';
      let bytes: Uint8Array;
      if (encoding === 'base64') {
        try {
          bytes = Buffer.from(input.content, 'base64');
        } catch {
          throw ApiError.validation([
            {
              field: 'content',
              message: 'The file could not be decoded. Try uploading it again.',
            },
          ]);
        }
        if (bytes.byteLength === 0) {
          throw ApiError.validation([
            { field: 'content', message: 'The document is empty.' },
          ]);
        }
      } else {
        bytes = new TextEncoder().encode(input.content);
      }

      // Validation happens BEFORE anything is stored: an unusable document
      // never becomes a row that has to be cleaned up later.
      const contentType = validateUpload({
        name: input.name,
        contentType: input.contentType,
        bytes,
      });
      // Prove the document yields readable text now rather than discovering
      // it on the worker, where the user is no longer watching.
      await extractDocumentText(contentType, bytes);

      const checksum = createHash('sha256').update(bytes).digest('hex');

      const result = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadSource(tx, actor, input.sourceId);

          // Identical content in the same source is the SAME document. A
          // duplicate upload is a no-op, not a second copy to embed twice.
          const existing = await tx.execute<{ id: string; status: string }>(sql`
            select id, status from knowledge_documents
            where source_id = ${input.sourceId}
              and organization_id = ${actor.organizationId}
              and checksum = ${checksum}
              and status <> 'deleted'
          `);
          const duplicate = existing[0];
          if (duplicate) {
            return {
              id: duplicate.id,
              status: duplicate.status,
              deduplicated: true,
              storageKey: null as string | null,
              contentType,
            };
          }

          // The storage key is derived from the checksum, so the same
          // content always lands on the same object and a retry overwrites
          // rather than orphaning.
          const storageKey = `documents/${checksum}`;

          const rows = await tx.execute<{ id: string }>(sql`
            insert into knowledge_documents
              (organization_id, source_id, name, content_type, byte_size,
               checksum, storage_key, status, version, created_by_user_id)
            values (${actor.organizationId}, ${input.sourceId}, ${input.name},
                    ${contentType}, ${bytes.byteLength}, ${checksum},
                    ${storageKey}, 'pending', 1, ${actor.userId})
            returning id
          `);
          const id = rows[0]?.id;
          if (!id) throw new Error('document insert returned no id');
          return {
            id,
            status: 'pending',
            deduplicated: false,
            storageKey,
            contentType,
          };
        },
      );

      if (!result.deduplicated) {
        // Store the bytes AFTER the row commits: an orphaned object is
        // harmless and reclaimable, whereas a row pointing at content that
        // was never written would fail processing for no good reason.
        if (result.storageKey) {
          await storage.put({
            organizationId: actor.organizationId,
            key: result.storageKey,
            contentType: result.contentType,
            body: bytes,
          });
        }

        await audit.record({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          eventType: 'knowledge.document.created',
          resourceType: 'knowledge_document',
          resourceId: result.id,
          metadata: {
            sourceId: input.sourceId,
            contentType: result.contentType,
            byteSize: bytes.byteLength,
          },
        });
        await enqueueProcessing(actor, result.id, 1);
      }

      return {
        id: result.id,
        status: result.status,
        deduplicated: result.deduplicated,
      };
    },

    async deleteDocument(actor, documentId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadDocument(tx, actor, documentId, true);
          await tx.execute(sql`
            update knowledge_documents
            set status = 'deleted', indexed_version = null, chunk_count = 0,
                updated_at = now()
            where id = ${documentId} and organization_id = ${actor.organizationId}
          `);
          // Chunks are removed in the same transaction: a deleted document
          // must be unretrievable immediately, not eventually.
          await tx.execute(sql`
            delete from knowledge_chunks
            where document_id = ${documentId}
              and organization_id = ${actor.organizationId}
          `);
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'knowledge.document.deleted',
        resourceType: 'knowledge_document',
        resourceId: documentId,
      });
    },

    async reindexDocument(actor, documentId) {
      const version = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const doc = await loadDocument(tx, actor, documentId, true);
          if (!canTransitionDocument(doc.status as DocumentStatus, 'pending')) {
            throw ApiError.conflict(
              `A document in "${doc.status}" cannot be re-indexed right now`,
            );
          }

          // Bump the version. The live chunks keep serving under the OLD
          // version until the new one succeeds, so re-indexing never creates
          // a window where the document is silently unsearchable.
          const rows = await tx.execute<{ version: number }>(sql`
            update knowledge_documents
            set version = version + 1, status = 'pending',
                failure_reason = null, failure_category = null,
                updated_at = now()
            where id = ${documentId} and organization_id = ${actor.organizationId}
            returning version
          `);
          const next = rows[0]?.version;
          if (next === undefined) throw ApiError.notFound('Document');
          return Number(next);
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'knowledge.document.reindexed',
        resourceType: 'knowledge_document',
        resourceId: documentId,
        metadata: { version },
      });
      await enqueueProcessing(actor, documentId, version);
      return { version };
    },
  };
}
