-- ---------------------------------------------------------------------------
-- Switching an organization's knowledge to a new embedding model without a
-- retrieval gap.
--
--   * embedding_next / embedding_next_provider: a shadow vector filled in
--     batches (resumable) while the current vectors keep serving. The switch
--     is then ONE update per organization that swaps them in.
--   * embedding_switches: progress per organization and target model, so a
--     cutover can be watched, resumed after a crash, and re-run safely.
--
-- Additive: Nest never reads these columns.
-- ---------------------------------------------------------------------------

ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_next" vector(1536);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_next_provider" text;
--> statement-breakpoint
CREATE TABLE "embedding_switches" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "target" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('preparing', 'prepared', 'switched', 'failed')),
  "total_chunks" integer NOT NULL DEFAULT 0,
  "prepared_chunks" integer NOT NULL DEFAULT 0,
  "switched_chunks" integer NOT NULL DEFAULT 0,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "switched_at" timestamp with time zone,
  CONSTRAINT "embedding_switches_pk" PRIMARY KEY ("organization_id", "target")
);
--> statement-breakpoint
ALTER TABLE "embedding_switches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "embedding_switches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "es_tenant_isolation" ON "embedding_switches"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "embedding_switches" TO platform_app;
