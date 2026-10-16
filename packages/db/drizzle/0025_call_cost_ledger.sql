-- ---------------------------------------------------------------------------
-- Per-call cost ledger, per-organization usage limits, scheduled call retries,
-- and the compiled-context hash that lets provisioning skip unchanged syncs.
--
-- Ledger quantities are MEASURED (call duration, transcript characters,
-- provider-reported tokens); costs are quantity x configured rate. Unknown
-- values stay NULL — a zero would be a fabricated metric.
--
-- Every table is organization-owned: ENABLE + FORCE row-level security in this
-- same migration, plain tenant policy, DML-only grants.
-- ---------------------------------------------------------------------------

CREATE TABLE "call_cost_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "voice_session_id" uuid NOT NULL,
  "use_case" text NOT NULL DEFAULT 'hiring',
  "channel" text NOT NULL,
  "outcome" text NOT NULL,
  "job_id" uuid,
  "candidate_id" uuid,
  "connected_seconds" integer,
  "billed_telephony_seconds" integer,
  "stt_seconds" integer,
  "tts_characters" integer,
  "llm_input_tokens" bigint,
  "llm_cached_input_tokens" bigint,
  "llm_output_tokens" bigint,
  "recording_bytes" bigint,
  "provider_reported_cost" numeric(14, 6),
  "provider_cost_unit" text,
  "telephony_cost" numeric(14, 4),
  "stt_cost" numeric(14, 4),
  "tts_cost" numeric(14, 4),
  "llm_cost" numeric(14, 4),
  "storage_cost" numeric(14, 4),
  "total_cost" numeric(14, 4),
  "currency" text NOT NULL DEFAULT 'INR',
  "rate_card" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_cost_ledger"
  ADD CONSTRAINT "ccl_org_fk" FOREIGN KEY ("organization_id")
  REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "call_cost_ledger"
  ADD CONSTRAINT "ccl_voice_session_fk" FOREIGN KEY ("voice_session_id")
  REFERENCES "public"."voice_sessions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX "ccl_voice_session_unique" ON "call_cost_ledger" ("voice_session_id");
--> statement-breakpoint
CREATE INDEX "ccl_org_created_idx" ON "call_cost_ledger" ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ccl_org_use_case_idx" ON "call_cost_ledger" ("organization_id", "use_case");
--> statement-breakpoint
ALTER TABLE "call_cost_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_cost_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ccl_tenant_isolation" ON "call_cost_ledger"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "call_cost_ledger" TO platform_app;
--> statement-breakpoint

CREATE TABLE "usage_limits" (
  "organization_id" uuid PRIMARY KEY NOT NULL,
  "monthly_minutes" integer,
  "monthly_cost" numeric(12, 2),
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_limits"
  ADD CONSTRAINT "usage_limits_org_fk" FOREIGN KEY ("organization_id")
  REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "usage_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_limits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "usage_limits_tenant_isolation" ON "usage_limits"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_limits" TO platform_app;
--> statement-breakpoint

CREATE TABLE "scheduled_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "attempt" integer NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL
    CHECK ("status" IN ('scheduled', 'dialing', 'done', 'cancelled', 'skipped')),
  "reason" text,
  "previous_voice_session_id" uuid,
  "voice_session_id" uuid,
  "requested_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_calls"
  ADD CONSTRAINT "scheduled_calls_org_fk" FOREIGN KEY ("organization_id")
  REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "scheduled_calls"
  ADD CONSTRAINT "scheduled_calls_job_fk" FOREIGN KEY ("job_id")
  REFERENCES "public"."jobs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "scheduled_calls"
  ADD CONSTRAINT "scheduled_calls_candidate_fk" FOREIGN KEY ("candidate_id")
  REFERENCES "public"."candidates"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "scheduled_calls_org_status_due_idx"
  ON "scheduled_calls" ("organization_id", "status", "due_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_calls_one_open_per_candidate"
  ON "scheduled_calls" ("candidate_id")
  WHERE "status" IN ('scheduled', 'dialing');
--> statement-breakpoint
ALTER TABLE "scheduled_calls" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scheduled_calls" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "scheduled_calls_tenant_isolation" ON "scheduled_calls"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "scheduled_calls" TO platform_app;
--> statement-breakpoint

ALTER TABLE "voice_provider_deployments" ADD COLUMN "context_hash" text;
