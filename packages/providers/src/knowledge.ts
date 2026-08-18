/**
 * Knowledge and storage contracts (Phase 3).
 *
 * Interfaces only. The two that matter most for provider independence:
 *
 *   ObjectStorage      — documents hold an opaque storage KEY, never a bucket
 *                        name, provider URL, or credential. Swapping local
 *                        disk for Cloudflare R2 is a new implementation of
 *                        this interface and nothing else.
 *
 *   KnowledgeRetriever — the RAG seam the Agent Runtime consumes. Its context
 *                        is TRUSTED input assembled server-side; there is no
 *                        field through which a caller could supply an
 *                        organization id, because the type does not have one
 *                        that isn't already session-derived.
 */

/** A stored object, addressed by an opaque key. */
export interface StoredObject {
  readonly key: string;
  readonly byteSize: number;
  readonly contentType: string;
}

export interface ObjectStorage {
  readonly name: string;
  /**
   * Keys are namespaced by organization so a bug in one caller cannot address
   * another tenant's object by guessing.
   */
  put(params: {
    readonly organizationId: string;
    readonly key: string;
    readonly contentType: string;
    readonly body: Uint8Array;
  }): Promise<StoredObject>;
  get(organizationId: string, key: string): Promise<Uint8Array>;
  delete(organizationId: string, key: string): Promise<void>;
  exists(organizationId: string, key: string): Promise<boolean>;
}

/** Deterministic text splitting. Replaceable without touching the pipeline. */
export interface ChunkInput {
  readonly text: string;
  readonly targetChars: number;
  readonly overlapChars: number;
}

export interface TextChunk {
  readonly index: number;
  readonly content: string;
  readonly section: string | null;
  readonly tokenEstimate: number;
}

export interface Chunker {
  readonly name: string;
  chunk(input: ChunkInput): readonly TextChunk[];
}

/**
 * Retrieval context.
 *
 * Every field here is derived server-side from the authenticated session or
 * from the agent's own configuration. Note what is ABSENT: there is no
 * caller-supplied organization id, because tenant scope is not a parameter
 * a client gets to influence.
 */
export interface RetrievalContext {
  /** From the validated session. Never from a header, query, or body. */
  readonly organizationId: string;
  readonly actorUserId: string;
  /** Optional narrowing, validated to belong to the same organization. */
  readonly sourceIds?: readonly string[];
  readonly documentIds?: readonly string[];
}

export interface RetrievalOptions {
  readonly topK?: number;
  /** Cosine similarity floor in [0,1]. Conservative by default. */
  readonly minSimilarity?: number;
}

export interface RetrievedChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly sourceId: string;
  readonly content: string;
  readonly similarity: number;
  readonly chunkIndex: number;
  readonly section: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Why a retrieval produced no usable knowledge.
 *
 * The distinction matters for `refuseWhenNoKnowledge`: an agent must be able
 * to tell "nothing relevant exists" from "the lookup broke", and must not
 * present either as an answer.
 */
export type RetrievalOutcome = 'ok' | 'no_knowledge' | 'below_threshold' | 'failed';

export interface RetrievalResult {
  readonly outcome: RetrievalOutcome;
  readonly chunks: readonly RetrievedChunk[];
  /** Present when outcome is `failed`. Safe for logs; never document content. */
  readonly error?: string;
}

export interface KnowledgeRetriever {
  readonly name: string;
  retrieve(
    query: string,
    context: RetrievalContext,
    options?: RetrievalOptions,
  ): Promise<RetrievalResult>;
}
