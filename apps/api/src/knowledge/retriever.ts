/**
 * Vector retrieval — the RAG seam the Agent Runtime consumes.
 *
 * SECURITY POSTURE, which is the point of this file:
 *
 *   * The organization id comes from `RetrievalContext`, which the API layer
 *     builds from the validated session. There is no parameter through which
 *     a caller could supply one.
 *   * The query runs inside `withTenantContext`, so RLS on `knowledge_chunks`
 *     applies to the similarity scan itself — the tenant predicate is on the
 *     same table the scan reads, not behind a join the planner might reorder.
 *   * The explicit `organization_id = $1` filter is ALSO present. Three
 *     layers, exactly as Phase 1 established: permission, explicit filter,
 *     RLS backstop.
 *   * Source and document narrowing is validated against the caller's own
 *     organization before it reaches the query, so a foreign id narrows to
 *     nothing rather than widening anything.
 *
 * Only LIVE chunks are searchable: `document_version = indexed_version` on a
 * document whose status is `ready`. A deleted, failed, or mid-reindex
 * document contributes nothing.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import type {
  EmbeddingProvider,
  KnowledgeRetriever,

  RetrievalOptions,
  RetrievalResult,
  RetrievedChunk,
} from '@platform/providers';
import type { Logger } from 'pino';

/** Conservative defaults: better to return nothing than something irrelevant. */
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 50;
const DEFAULT_MIN_SIMILARITY = 0.15;

type ChunkRecord = {
  id: string;
  document_id: string;
  document_name: string;
  source_id: string;
  content: string;
  chunk_index: number;
  section: string | null;
  metadata: unknown;
  similarity: number | string;
};

export function createKnowledgeRetriever(
  database: Database,
  embeddings: EmbeddingProvider,
  logger: Logger,
): KnowledgeRetriever {
  return {
    name: 'pgvector-cosine',

    async retrieve(query, context, options?: RetrievalOptions) {
      const topK = Math.min(options?.topK ?? DEFAULT_TOP_K, MAX_TOP_K);
      const minSimilarity = options?.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

      const trimmed = query.trim();
      if (trimmed.length === 0) {
        return { outcome: 'no_knowledge', chunks: [] } satisfies RetrievalResult;
      }

      try {
        const embedded = await embeddings.embed([trimmed]);
        const vector = embedded.vectors[0];
        if (!vector || vector.length === 0) {
          return { outcome: 'no_knowledge', chunks: [] } satisfies RetrievalResult;
        }
        const literal = JSON.stringify([...vector]);

        const rows = await withTenantContext(
          database.db,
          {
            organizationId: context.organizationId,
            userId: context.actorUserId,
          },
          async (tx) =>
            tx.execute<ChunkRecord>(sql`
              select c.id, c.document_id, d.name as document_name, c.source_id,
                     c.content, c.chunk_index, c.section, c.metadata,
                     -- pgvector's <=> is cosine DISTANCE; similarity is 1 - d.
                     1 - (c.embedding <=> ${literal}::vector) as similarity
              from knowledge_chunks c
              join knowledge_documents d
                on d.id = c.document_id
               and d.organization_id = c.organization_id
              where c.organization_id = ${context.organizationId}
                and c.embedding is not null
                -- Only LIVE chunks: the version the document currently serves.
                and d.status = 'ready'
                and d.indexed_version = c.document_version
                ${
                  // A parameterised IN list rather than an array cast: the
                  // driver flattens a single-element array to a scalar, which
                  // then fails as a malformed array literal. Each id is still
                  // an individual bind parameter — never interpolated.
                  context.sourceIds && context.sourceIds.length > 0
                    ? sql`and c.source_id in (${sql.join(
                        context.sourceIds.map((id) => sql`${id}::uuid`),
                        sql`, `,
                      )})`
                    : sql``
                }
                ${
                  context.documentIds && context.documentIds.length > 0
                    ? sql`and c.document_id in (${sql.join(
                        context.documentIds.map((id) => sql`${id}::uuid`),
                        sql`, `,
                      )})`
                    : sql``
                }
              order by c.embedding <=> ${literal}::vector
              limit ${topK}
            `),
        );

        const all: RetrievedChunk[] = rows.map((r) => ({
          chunkId: r.id,
          documentId: r.document_id,
          documentName: r.document_name,
          sourceId: r.source_id,
          content: r.content,
          similarity: Number(r.similarity),
          chunkIndex: Number(r.chunk_index),
          section: r.section,
          metadata: (r.metadata ?? {}) as Record<string, unknown>,
        }));

        // The threshold is applied AFTER ranking so the outcome can
        // distinguish "nothing indexed" from "nothing close enough" — a
        // distinction `refuseWhenNoKnowledge` depends on.
        const kept = all.filter((c) => c.similarity >= minSimilarity);

        if (kept.length > 0) {
          return { outcome: 'ok', chunks: kept } satisfies RetrievalResult;
        }
        return {
          outcome: all.length === 0 ? 'no_knowledge' : 'below_threshold',
          chunks: [],
        } satisfies RetrievalResult;
      } catch (error) {
        // A retrieval failure must never be presented as "no knowledge" — the
        // agent would then confidently answer from nothing.
        logger.error(
          { err: (error as Error).message, organizationId: context.organizationId },
          'knowledge.retrieval.failed',
        );
        return {
          outcome: 'failed',
          chunks: [],
          error: 'Knowledge retrieval is temporarily unavailable',
        } satisfies RetrievalResult;
      }
    },
  };
}
