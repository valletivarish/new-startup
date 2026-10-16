-- ---------------------------------------------------------------------------
-- Durable background work for the Java API (email delivery, document
-- indexing): survives restarts, retries with exponential backoff, and is
-- claimed with FOR UPDATE SKIP LOCKED so any number of replicas can work it.
--
-- Why not share pg-boss's tables: their layout is internal to one pg-boss
-- version, they carry no organization_id and no row-level security (email
-- payloads hold raw invitation and reset tokens), and during side-by-side
-- running the Nest worker would pick up Java's jobs and vice versa.
--
-- Row-level security:
--   * tenant rows: visible only inside that organization's context;
--   * account rows (organization_id NULL — password reset, verification
--     email): visible only OUTSIDE any organization context.
-- Email payloads are additionally sealed (AES-GCM) by the application, and a
-- row is deleted the moment its work succeeds.
-- ---------------------------------------------------------------------------

CREATE TABLE "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('email', 'document')),
  "payload" jsonb NOT NULL,
  "idempotency_key" text,
  "status" text DEFAULT 'queued' NOT NULL CHECK ("status" IN ('queued', 'running', 'dead')),
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer NOT NULL CHECK ("max_attempts" BETWEEN 1 AND 20),
  "run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idempotency_idx" ON "background_jobs" ("kind", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL AND "status" IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX "background_jobs_due_idx" ON "background_jobs" ("organization_id", "run_at")
  WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "background_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "bj_tenant_isolation" ON "background_jobs"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "bj_account_scope" ON "background_jobs"
  FOR ALL
  USING ("organization_id" IS NULL AND current_org_id() IS NULL)
  WITH CHECK ("organization_id" IS NULL AND current_org_id() IS NULL);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "background_jobs" TO platform_app;
