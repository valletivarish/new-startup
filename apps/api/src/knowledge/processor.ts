/**
 * Document processing — the body of the background job.
 *
 *   load → guard version → extract → chunk → embed → write → flip pointer
 *
 * IDEMPOTENCY AND RETRY SAFETY, which is the whole difficulty here:
 *
 *   * The job carries the document VERSION it was queued for. If the document
 *     has since moved on, the job exits successfully without touching
 *     anything — a stale retry cannot overwrite newer content.
 *   * Chunks are deleted and rewritten for that version only, under a unique
 *     index on (document, version, chunk index). A retry converges on the
 *     same rows rather than appending duplicates.
 *   * The `indexed_version` pointer flips LAST, inside the same transaction
 *     as the chunk write. A crash before that leaves the previous version
 *     serving and the document not marked ready.
 *
 * Failure is explicit: a document that could not be indexed ends in `failed`
 * with a business-language reason, never in `ready`.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import type {
  Chunker,
  EmbeddingProvider,
  ObjectStorage,
} from '@platform/providers';
import type { Logger } from 'pino';

import { extractText } from './formats.js';

export interface ProcessDocumentJob {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly documentId: string;
  readonly version: number;
}

export interface ProcessResult {
  readonly status: 'indexed' | 'skipped' | 'failed';
  readonly chunkCount: number;
  readonly reason?: string;
}

/** Chunk sizing. Conservative defaults; tune with real corpora, not guesses. */
const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 150;
/** Bounded batches so a large document cannot build one enormous request. */
const EMBED_BATCH = 32;

export interface DocumentProcessorDeps {
  readonly database: Database;
  readonly embeddings: EmbeddingProvider;
  readonly chunker: Chunker;
  /** Content is fetched by opaque key — the provider stays swappable. */
  readonly storage: ObjectStorage;
  readonly logger: Logger;
  readonly onAudit?: (event: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly eventType: string;
    readonly documentId: string;
    readonly metadata: Record<string, string | number | boolean | null>;
  }) => Promise<void>;
}

export function createDocumentProcessor(deps: DocumentProcessorDeps) {
  const { database, embeddings, chunker, storage, logger, onAudit } = deps;

  return async function processDocument(
    job: ProcessDocumentJob,
  ): Promise<ProcessResult> {
    const startedAt = Date.now();
    const ctx = {
      organizationId: job.organizationId,
      userId: job.actorUserId,
    };

    // ---- 1. Claim the document for this version ---------------------------
    const claimed = await withTenantContext(database.db, ctx, async (tx) => {
      const rows = await tx.execute<{
        id: string;
        source_id: string;
        name: string;
        content_type: string;
        version: number;
        status: string;
        byte_size: number;
        storage_key: string | null;
      }>(sql`
        select id, source_id, name, content_type, version, status, byte_size,
               storage_key
        from knowledge_documents
        where id = ${job.documentId} and organization_id = ${job.organizationId}
        for update
      `);
      const doc = rows[0];
      if (!doc) return null;

      // A stale retry for an older version must not resurrect old content.
      if (Number(doc.version) !== job.version) return null;
      if (doc.status === 'deleted') return null;

      await tx.execute(sql`
        update knowledge_documents
        set status = 'processing', processing_started_at = now(), updated_at = now()
        where id = ${job.documentId} and organization_id = ${job.organizationId}
      `);

      await tx.execute(sql`
        insert into knowledge_processing_runs
          (organization_id, document_id, document_version, status, byte_size)
        values (${job.organizationId}, ${job.documentId}, ${job.version},
                'started', ${doc.byte_size})
      `);

      return doc;
    });

    if (!claimed) {
      logger.info(
        { documentId: job.documentId, version: job.version },
        'knowledge.process.skipped_stale',
      );
      return { status: 'skipped', chunkCount: 0 };
    }

    await onAudit?.({
      organizationId: job.organizationId,
      actorUserId: job.actorUserId,
      eventType: 'knowledge.document.processing_started',
      documentId: job.documentId,
      metadata: { version: job.version },
    });

    try {
      // ---- 2. Extract -----------------------------------------------------
      // Content is fetched through the ObjectStorage abstraction using the
      // document's opaque key. Nothing here knows whether that key resolves
      // to local disk or object storage, which is the point.
      if (!claimed.storage_key) {
        throw Object.assign(new Error('Document content is no longer available'), {
          category: 'content_missing',
        });
      }

      let bytes: Uint8Array;
      try {
        bytes = await storage.get(job.organizationId, claimed.storage_key);
      } catch {
        throw Object.assign(new Error('Document content could not be read'), {
          category: 'content_missing',
        });
      }

      const text = extractText(bytes);
      if (text.length === 0) {
        throw Object.assign(new Error('The document contained no readable text'), {
          category: 'empty_document',
        });
      }

      // ---- 3. Chunk -------------------------------------------------------
      const chunks = chunker.chunk({
        text,
        targetChars: TARGET_CHARS,
        overlapChars: OVERLAP_CHARS,
      });
      if (chunks.length === 0) {
        throw Object.assign(new Error('The document produced no indexable content'), {
          category: 'empty_document',
        });
      }

      // ---- 4. Embed, in bounded batches -----------------------------------
      const vectors: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const result = await embeddings.embed(batch.map((c) => c.content));
        if (result.vectors.length !== batch.length) {
          throw Object.assign(
            new Error('The embedding provider returned an unexpected result'),
            { category: 'embedding_failed' },
          );
        }
        for (const v of result.vectors) vectors.push([...v]);
      }

      // ---- 5. Write chunks and flip the pointer, atomically ----------------
      await withTenantContext(database.db, ctx, async (tx) => {
        // Re-check the version INSIDE the write transaction: a re-index that
        // landed while we were embedding must win, not lose to our stale work.
        const current = await tx.execute<{ version: number; status: string }>(sql`
          select version, status from knowledge_documents
          where id = ${job.documentId} and organization_id = ${job.organizationId}
          for update
        `);
        const row = current[0];
        if (!row || Number(row.version) !== job.version || row.status === 'deleted') {
          throw Object.assign(new Error('superseded'), { category: 'superseded' });
        }

        // Delete-then-insert for THIS version: a retry converges rather than
        // duplicating. The unique index is the backstop.
        await tx.execute(sql`
          delete from knowledge_chunks
          where document_id = ${job.documentId}
            and organization_id = ${job.organizationId}
            and document_version = ${job.version}
        `);

        for (const [i, chunk] of chunks.entries()) {
          const vector = vectors[i];
          if (!vector) throw new Error('missing embedding for chunk');
          await tx.execute(sql`
            insert into knowledge_chunks
              (organization_id, source_id, document_id, document_version,
               chunk_index, content, token_estimate, section, embedding,
               embedding_provider, embedding_dimensions)
            values (${job.organizationId}, ${claimed.source_id}, ${job.documentId},
                    ${job.version}, ${chunk.index}, ${chunk.content},
                    ${chunk.tokenEstimate}, ${chunk.section},
                    ${JSON.stringify(vector)}::vector,
                    ${embeddings.name}, ${embeddings.dimensions})
          `);
        }

        // The pointer flip. Everything before this was invisible to retrieval.
        await tx.execute(sql`
          update knowledge_documents
          set status = 'ready',
              indexed_version = ${job.version},
              indexed_with = ${embeddings.name},
              chunk_count = ${chunks.length},
              failure_reason = null,
              failure_category = null,
              processing_completed_at = now(),
              processing_duration_ms = ${Date.now() - startedAt},
              updated_at = now()
          where id = ${job.documentId} and organization_id = ${job.organizationId}
        `);

        // Older versions are now unreachable; remove them so the store does
        // not accumulate superseded vectors.
        await tx.execute(sql`
          delete from knowledge_chunks
          where document_id = ${job.documentId}
            and organization_id = ${job.organizationId}
            and document_version <> ${job.version}
        `);

        await tx.execute(sql`
          update knowledge_processing_runs
          set status = 'completed', chunk_count = ${chunks.length},
              embedding_count = ${vectors.length},
              duration_ms = ${Date.now() - startedAt}, finished_at = now()
          where document_id = ${job.documentId}
            and organization_id = ${job.organizationId}
            and document_version = ${job.version}
            and status = 'started'
        `);
      });

      logger.info(
        {
          documentId: job.documentId,
          version: job.version,
          chunks: chunks.length,
          bytes: claimed.byte_size,
          durationMs: Date.now() - startedAt,
        },
        'knowledge.process.completed',
      );

      await onAudit?.({
        organizationId: job.organizationId,
        actorUserId: job.actorUserId,
        eventType: 'knowledge.document.processing_completed',
        documentId: job.documentId,
        metadata: { version: job.version, chunkCount: chunks.length },
      });

      return { status: 'indexed', chunkCount: chunks.length };
    } catch (error) {
      const category =
        (error as { category?: string }).category ?? 'processing_failed';

      // A superseding re-index is not a failure — the newer job owns the
      // document now, and marking it failed would be wrong.
      if (category === 'superseded') {
        logger.info(
          { documentId: job.documentId, version: job.version },
          'knowledge.process.superseded',
        );
        return { status: 'skipped', chunkCount: 0 };
      }

      const reason = (error as Error).message;
      await withTenantContext(database.db, ctx, async (tx) => {
        await tx.execute(sql`
          update knowledge_documents
          set status = 'failed', failure_reason = ${reason},
              failure_category = ${category},
              processing_completed_at = now(),
              processing_duration_ms = ${Date.now() - startedAt},
              updated_at = now()
          where id = ${job.documentId}
            and organization_id = ${job.organizationId}
            and version = ${job.version}
        `);
        await tx.execute(sql`
          update knowledge_processing_runs
          set status = 'failed', failure_category = ${category},
              failure_reason = ${reason},
              duration_ms = ${Date.now() - startedAt}, finished_at = now()
          where document_id = ${job.documentId}
            and organization_id = ${job.organizationId}
            and document_version = ${job.version}
            and status = 'started'
        `);
      });

      // Category and reason only — never document content (§21).
      logger.error(
        { documentId: job.documentId, version: job.version, category },
        'knowledge.process.failed',
      );
      await onAudit?.({
        organizationId: job.organizationId,
        actorUserId: job.actorUserId,
        eventType: 'knowledge.document.processing_failed',
        documentId: job.documentId,
        metadata: { version: job.version, category },
      });

      return { status: 'failed', chunkCount: 0, reason };
    }
  };
}
