-- ---------------------------------------------------------------------------
-- Hybrid retrieval and embedding reuse.
--
--   * content_tsv: full-text leg of hybrid search (fused with the existing
--     HNSW vector leg by reciprocal rank fusion). Generated, so it can never
--     drift from `content`.
--   * content_hash: sha-256 of the normalised chunk text, for chunk-level
--     dedup and embedding-cache lookups.
--   * embedding_cache: per-ORGANIZATION cache keyed by (content hash, model).
--     Per-org on purpose: embeddings can be partially inverted to text, so a
--     cross-tenant cache would leak content between organizations.
--
-- Additive only; existing readers are unaffected.
-- ---------------------------------------------------------------------------

ALTER TABLE "knowledge_chunks"
  ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce("section", '') || ' ' || "content")
  ) STORED;
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_content_tsv_idx"
  ON "knowledge_chunks" USING gin ("content_tsv");
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "content_hash" text;
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_org_hash_idx"
  ON "knowledge_chunks" ("organization_id", "content_hash");
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
  "organization_id" uuid NOT NULL,
  "model" text NOT NULL,
  "content_hash" text NOT NULL,
  "dimensions" integer NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "embedding_cache_pk" PRIMARY KEY ("organization_id", "model", "content_hash")
);
--> statement-breakpoint
ALTER TABLE "embedding_cache"
  ADD CONSTRAINT "embedding_cache_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "embedding_cache" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "embedding_cache" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "embedding_cache_tenant_isolation" ON "embedding_cache"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "embedding_cache" TO platform_app;
