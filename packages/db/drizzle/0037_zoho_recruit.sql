-- ---------------------------------------------------------------------------
-- Zoho Recruit connector (build step 8).
--
-- zoho_connections   one per company. Tokens are sealed (AES-256-GCM) by the
--                    API before they reach this table; the column never holds
--                    a readable token. sync_cursor is the highest Zoho
--                    Modified_Time read so far (see connectors/zoho/sync.ts).
-- zoho_oauth_states  one-time OAuth state + PKCE verifier, 10 minutes.
-- zoho_job_links     which Zoho job opening feeds which HRVoice job.
-- zoho_applicants    every application read on a linked job: the HRVoice
--                    candidate it became, or why it was skipped. `closed`
--                    (rejected, hired, archived in Zoho) blocks every call.
-- zoho_notes         one note per finished call, delivered with retries.
--
-- All org-scoped, FORCE RLS, plain tenant policy. Disconnect deletes the
-- connection; everything below it cascades.
-- ---------------------------------------------------------------------------

CREATE TABLE "zoho_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL DEFAULT 'connected' CHECK ("status" IN ('connected', 'needs_attention')),
  "accounts_server" text NOT NULL,
  "recruit_base" text NOT NULL,
  "secrets_sealed" text NOT NULL,
  "consent_confirmed_at" timestamp with time zone NOT NULL,
  "sync_cursor" timestamp with time zone,
  "sync_lease_until" timestamp with time zone,
  "last_sync_at" timestamp with time zone,
  "last_error" text,
  "paused_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "zoho_oauth_states" (
  "state_hash" text PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_verifier" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "zoho_oauth_states_org_idx" ON "zoho_oauth_states" ("organization_id");
--> statement-breakpoint

CREATE TABLE "zoho_job_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "zoho_connections"("id") ON DELETE CASCADE,
  "zoho_job_id" text NOT NULL,
  "zoho_job_title" text NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "jobs"("id") ON DELETE CASCADE,
  "auto_call" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("connection_id", "zoho_job_id")
);
--> statement-breakpoint
CREATE INDEX "zoho_job_links_org_idx" ON "zoho_job_links" ("organization_id");
--> statement-breakpoint

CREATE TABLE "zoho_applicants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "zoho_connections"("id") ON DELETE CASCADE,
  "zoho_application_id" text NOT NULL,
  "zoho_candidate_id" text,
  "zoho_job_id" text NOT NULL,
  "full_name" text NOT NULL,
  "candidate_id" uuid REFERENCES "candidates"("id") ON DELETE SET NULL,
  "closed" boolean NOT NULL DEFAULT false,
  "skip_reason" text CHECK ("skip_reason" IS NULL OR "skip_reason" IN
    ('closed_in_zoho', 'no_phone', 'invalid_phone', 'duplicate_phone')),
  "modified_time" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("connection_id", "zoho_application_id")
);
--> statement-breakpoint
CREATE INDEX "zoho_applicants_candidate_idx" ON "zoho_applicants" ("organization_id", "candidate_id");
--> statement-breakpoint

CREATE TABLE "zoho_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "zoho_connections"("id") ON DELETE CASCADE,
  "voice_session_id" uuid NOT NULL REFERENCES "voice_sessions"("id") ON DELETE CASCADE,
  "zoho_candidate_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sent', 'failed')),
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  UNIQUE ("connection_id", "voice_session_id")
);
--> statement-breakpoint
CREATE INDEX "zoho_notes_org_status_idx" ON "zoho_notes" ("organization_id", "status");
--> statement-breakpoint

-- Calls started by the Zoho sync are their own source (calling hours apply).
ALTER TABLE "call_requests" DROP CONSTRAINT "call_requests_source_check";
--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_source_check"
  CHECK ("source" IN ('api', 'dashboard', 'link', 'zoho'));
--> statement-breakpoint

ALTER TABLE "zoho_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_oauth_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_oauth_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_job_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_job_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_applicants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_applicants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zoho_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "zoho_connections_tenant_isolation" ON "zoho_connections" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "zoho_oauth_states_tenant_isolation" ON "zoho_oauth_states" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "zoho_job_links_tenant_isolation" ON "zoho_job_links" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "zoho_applicants_tenant_isolation" ON "zoho_applicants" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "zoho_notes_tenant_isolation" ON "zoho_notes" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "zoho_connections", "zoho_oauth_states", "zoho_job_links", "zoho_applicants", "zoho_notes"
  TO platform_app;
