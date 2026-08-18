# Phase 3 Completion Report — Knowledge / RAG Foundation

**Date:** 2026-08-18
**Status:** COMPLETE against the Phase 3 completion criteria
**Verification:** 292 tests passing against real PostgreSQL; lint clean; typecheck clean in all five packages; clean-database migration verified; live ingestion-to-retrieval verified with the real worker.

---

## 1. Architecture

```
Organization → KnowledgeSource → KnowledgeDocument → KnowledgeChunk (pgvector)
                                        ↓
                              pg-boss worker (async)
                                        ↓
                        KnowledgeRetriever → Agent Runtime
```

Agent knowledge is **referenced, not copied**: `agent_knowledge_sources` is a join table, so one organization source can back a recruitment agent and a support agent while each keeps its own configuration. The Phase 2 agent model was not redesigned; its existing `knowledge[]` configuration slot now has a real layer behind it.

## 2. Database changes

Five tables (migrations `0009`, `0010`), all organization-owned with **RLS enabled and forced**, `USING` and `WITH CHECK` on `current_org_id()`:

`knowledge_sources` · `knowledge_documents` · `knowledge_chunks` · `agent_knowledge_sources` · `knowledge_processing_runs`

Design points that carry weight:

- **`knowledge_chunks.organization_id` is carried directly**, not reached through the document. A vector similarity scan must be tenant-filtered on the same table it scans, not behind a join the planner may reorder.
- **`(document_id, document_version, chunk_index)` is unique** — a retry rewrites the same rows rather than appending, so duplicate chunks are impossible by construction.
- **`(source_id, checksum)` is unique** among live documents — identical content is the same document, so a duplicate upload is a no-op.
- **HNSW index** with `vector_cosine_ops`, plus a partial index for the live-chunk path. RLS still applies to every scan that uses it; an index never bypasses a policy.
- `knowledge_processing_runs` is append-only for the runtime role (`DELETE` revoked).

Clean-database result: 20 tables, 13 RLS-forced, 21 policies, 54 permissions, HNSW index present, `platform_app` with no CREATE and no BYPASSRLS.

## 3. Ingestion pipeline

```
validate → store (ObjectStorage) → pending row → [pg-boss] → claim version
        → extract → chunk → embed → write chunks → flip indexed_version → ready
```

The request does validation and storage only; everything expensive happens on the worker. **Verified live: `pending → ready` in ~2s, performed by the worker process, not the API.**

Retry safety rests on three things rather than on care:

1. The job carries the document **version**. A stale retry finds the document has moved on and exits without touching anything.
2. Chunks are deleted and rewritten **for that version only**, under the unique index.
3. `indexed_version` flips **last**, inside the same transaction as the chunk write. A crash before that leaves the previous version serving, and the document is never marked ready on content that failed to index.

Retries are **bounded** (3 attempts, backoff). Exhaustion leaves an explicit `failed` state with a business-language reason — never an infinite loop, never a false `ready`.

## 4. Chunking

Structural and deterministic: splits on markdown headings then blank lines, packs to ~1200 chars with 150-char overlap, hard-splits oversized blocks, records the nearest heading as the chunk's section. Determinism is not tidiness — the same document must produce the same chunks on every re-index, or a retry would churn the vector store. Behind the replaceable `Chunker` interface; semantic chunking is deferred because doing it badly silently degrades every retrieval.

## 5. Embedding abstraction

**No embedding provider was installed or selected.** A deterministic provider implements the existing `EmbeddingProvider` interface: tokens are hashed into a sparse bag of dimensions and unit-normalised, so documents sharing vocabulary genuinely score higher. That makes ranking testable with *exact* expected results rather than "the numbers look plausible" — and the report does not pretend it is semantic similarity.

Each chunk records `embedding_provider` and `embedding_dimensions`, so when a real provider is chosen the old vectors are distinguishable and a full re-index is a visible, ordered operation.

## 6. Vector retrieval

`KnowledgeRetriever` returns structured results (chunk id, document id and name, source id, content, similarity, section, metadata) — never raw database rows. Supports top-k, similarity threshold, and source/document narrowing, with conservative defaults (top-k 5, threshold 0.15).

The outcome is a first-class value: `ok` · `no_knowledge` · `below_threshold` · `failed`. That distinction is what lets an agent decline honestly instead of answering from nothing.

Only **live** chunks are searchable: `document_version = indexed_version` on a `ready` document. Deleted, failed, and mid-reindex documents contribute nothing — **verified: a deleted document is immediately unretrievable.**

## 7. Tenant isolation

Three layers unchanged from Phase 1: permission check, explicit `organization_id` filter, RLS backstop. The retrieval context type has **no field through which a caller could supply an organization** — a forged tenant cannot even be parsed.

Adversarial tests (20) all pass: cross-tenant search using the other tenant's *exact secret text* returns nothing; forged organization ids in body, header and query are ignored; narrowing by a foreign source or document id returns nothing; a foreign chunk id is invisible; **an unscoped vector scan with no tenant context returns zero rows**; row migration between tenants is refused; anonymous retrieval is 401.

## 8. Permissions

**Zero new permissions.** All five knowledge permissions already existed and cover every operation: `knowledge.read` (including search), `.create`, `.update`, `.delete`, `.reindex`. A `knowledge.process` permission would have duplicated create/reindex.

The matrix already reflects the sensitivity: **a Viewer holds no knowledge permission at all** — organization knowledge is not automatically readable by everyone. An Agent Manager can read and re-index but cannot curate; creation and deletion belong to the Knowledge Manager. Both verified by test.

## 9. Async jobs

`knowledge.document.process` on the existing pg-boss infrastructure. Idempotent (singleton key on document + version), bounded retries with backoff, tenant-aware (context established per organization, per transaction), observable via `knowledge_processing_runs` — duration, byte size, chunk count, embedding count, failure category. No Redis, no new infrastructure.

A deployment without a worker runs the **same** processor inline rather than leaving documents silently pending — slower, but not broken.

## 10. API

Sources: `GET/POST /knowledge/sources`, `GET/PATCH/DELETE /knowledge/sources/:id`
Documents: `GET/POST /knowledge/documents`, `GET/DELETE /knowledge/documents/:id`, `POST /knowledge/documents/:id/reindex`
Retrieval: `POST /knowledge/search`
Agent association: `GET/POST /agents/:id/knowledge`, `DELETE /agents/:id/knowledge/:sourceId`

Every route declares exactly one permission; foreign ids return 404, never 403.

## 11. UI

A minimal Knowledge section: create sources, add documents, see processing status in plain language ("Ready to use", "Could not be indexed"), re-index, delete, and test retrieval with outcomes explained ("Nothing was close enough to be useful"). Failures are business language throughout — a user uploading a PDF is told to convert it to `.txt` or `.md`, not shown a MIME enum.

## 12. Tests — 292 passing, 14 suites

New: `knowledge.test.ts` (25) — chunking determinism and sections, embedding determinism/normalisation/lexical signal, format rejection (wrong type, wrong extension, binary-as-text), ingestion to ready, duplicate-upload dedup, processing-run records without content, **retrieval ranking the correct document**, top-k, threshold, source narrowing, empty-organization outcome, deleted-document unretrievability, re-index idempotency (three re-indexes, chunk count unchanged, one live version), version/indexed_version stepping, failed index staying failed, and the three `refuseWhenNoKnowledge` contract cases.

`knowledge-isolation.test.ts` (20) — the adversarial suite described in §7.

## 13. Live verification

Clean database → migrations → API + worker → source → document → **worker indexes asynchronously (2s)** → retrieval returns `ok` with the notice-period document → unsupported format refused with actionable guidance → **0 permission errors, 0 unhandled errors** in either process.

## 14. Known limitations

1. **Only `text/plain` and `text/markdown`.** PDF and DOCX are rejected with guidance rather than partially indexed. Adding them means a parser dependency and a class of malformed-file failures — a decision to make deliberately.
2. **The embedding provider is lexical, not semantic.** Ranking is real and testable; it is not what a production model would give. Swapping it is one interface implementation plus a re-index.
3. **Vector dimension is fixed at 1536** by the column. A provider with a different width needs a migration and a full re-index — which is why every chunk records the provider and dimension it came from.
4. **Retrieval has no reranking or hybrid keyword search.** Pure vector similarity with a threshold.
5. **The HNSW index is untuned.** At Phase 3 volumes an exact scan would also serve; tuning without representative corpora would be guesswork.
6. **Sources and documents are unpaginated** (capped at 200). The Phase 1 cursor helper exists and should be applied when volumes justify it.
7. **`url_reference` is a source *type* only** — no fetching or crawling, as instructed.

## 15. Deferred functionality

LLM providers, STT, TTS, telephony, voice, recruitment, candidates, jobs, calendar, CRM/ATS, billing, usage metering. **No provider SDK was added** — verified across every manifest and the lockfile. No Phase 4+ table exists; the boundary test now guards the Phase 4 line.

## 16. Recommended next phase

**Phase 4 — Intelligence + tools**, per the approved sequence. Phase 3 leaves it a defined seam: `ExecutionStrategy` is the single place an LLM-backed strategy replaces the deterministic one, and `RetrievalResult` already carries the grounded chunks a real strategy would use to answer rather than merely to decide whether to refuse. The `ToolRegistry`/`ToolExecutor` contracts from Phase 2 are still unimplemented and belong in the same phase, along with emitting `ToolRequested`/`ToolCompleted` so that part of the event taxonomy is finally exercised.
