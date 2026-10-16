-- ---------------------------------------------------------------------------
-- Client integrations: API keys, idempotency, call requests, per-company call
-- limits, outbound webhooks, candidate links and candidate consent / test flags.
--
-- All new tables are org-scoped with FORCE RLS. API keys and candidate links
-- are looked up BEFORE any tenant context exists, so each has a SELECT-only
-- policy that exposes exactly the row whose hash equals a transaction-local
-- setting, and a SECURITY DEFINER function (owned by the migrator, executable
-- by platform_app only) that sets it. FORCE RLS applies to the owner too, so
-- the function cannot simply read the table.
-- ---------------------------------------------------------------------------

CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "key_hash" text NOT NULL UNIQUE,
  "mode" text NOT NULL CHECK ("mode" IN ('live', 'test')),
  "scopes" text[] NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" ("organization_id", "created_at");
--> statement-breakpoint

CREATE TABLE "idempotency_keys" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "status" integer NOT NULL,
  "body" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("organization_id", "key", "method", "path")
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" ("created_at");
--> statement-breakpoint

CREATE TABLE "org_call_limits" (
  "organization_id" uuid PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "calls_per_day" integer NOT NULL DEFAULT 50 CHECK ("calls_per_day" >= 0),
  "max_concurrent" integer NOT NULL DEFAULT 3 CHECK ("max_concurrent" >= 0),
  "monthly_cap" integer CHECK ("monthly_cap" IS NULL OR "monthly_cap" >= 0),
  "price_per_screen_inr" numeric(10, 2) CHECK ("price_per_screen_inr" IS NULL OR "price_per_screen_inr" >= 0),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Candidate columns first: call_requests and links reference candidates/jobs.
ALTER TABLE "candidates"
  ADD COLUMN "external_id" text,
  ADD COLUMN "consent_at" timestamp with time zone,
  ADD COLUMN "consent_source" text CHECK ("consent_source" IS NULL OR "consent_source" IN ('customer', 'candidate')),
  ADD COLUMN "is_test" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_org_job_external_unique"
  ON "candidates" ("organization_id", "job_id", "external_id")
  WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "is_test" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "is_test" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE TABLE "call_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "jobs"("id") ON DELETE CASCADE,
  "candidate_id" uuid NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
  "source" text NOT NULL CHECK ("source" IN ('api', 'dashboard', 'link')),
  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'scheduled', 'placing', 'placed', 'skipped', 'failed')),
  "reason" text,
  "not_before" timestamp with time zone,
  "voice_session_id" uuid REFERENCES "voice_sessions"("id") ON DELETE SET NULL,
  "is_test" boolean NOT NULL DEFAULT false,
  "created_by_key_id" uuid REFERENCES "api_keys"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "call_requests_org_status_idx" ON "call_requests" ("organization_id", "status", "not_before");
--> statement-breakpoint
CREATE INDEX "call_requests_org_candidate_idx" ON "call_requests" ("organization_id", "candidate_id");
--> statement-breakpoint

CREATE TABLE "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" text[] NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" ("organization_id");
--> statement-breakpoint

CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'delivered', 'failed')),
  "attempts" integer NOT NULL DEFAULT 0,
  "last_status_code" integer,
  "last_error" text,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" ("organization_id", "next_attempt_at")
  WHERE "status" = 'pending';
--> statement-breakpoint
-- emitCallEvent's once-per-call check.
CREATE INDEX "webhook_deliveries_call_idx" ON "webhook_deliveries" ("organization_id", (("payload"->'data'->>'callId')));
--> statement-breakpoint

CREATE TABLE "candidate_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "jobs"("id") ON DELETE CASCADE,
  "candidate_id" uuid REFERENCES "candidates"("id") ON DELETE CASCADE,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "is_test" boolean DEFAULT false NOT NULL,
  "full_name" text,
  "email" text,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "candidate_links_org_job_idx" ON "candidate_links" ("organization_id", "job_id");
--> statement-breakpoint

-- Tenant RLS + grants.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_call_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_call_limits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "api_keys_tenant_isolation" ON "api_keys" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant_isolation" ON "idempotency_keys" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "call_requests_tenant_isolation" ON "call_requests" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "org_call_limits_tenant_isolation" ON "org_call_limits" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "webhook_endpoints_tenant_isolation" ON "webhook_endpoints" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "webhook_deliveries_tenant_isolation" ON "webhook_deliveries" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "candidate_links_tenant_isolation" ON "candidate_links" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint

-- Pre-tenant lookups: expose only the row whose hash equals the setting that
-- the SECURITY DEFINER functions below set (transaction-local).
CREATE POLICY "api_keys_hash_lookup" ON "api_keys" FOR SELECT
  USING ("key_hash" = NULLIF(current_setting('app.lookup_api_key_hash', true), ''));
--> statement-breakpoint
CREATE POLICY "candidate_links_hash_lookup" ON "candidate_links" FOR SELECT
  USING ("token_hash" = NULLIF(current_setting('app.lookup_link_hash', true), ''));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "api_keys", "idempotency_keys", "call_requests", "org_call_limits",
  "webhook_endpoints", "webhook_deliveries", "candidate_links"
  TO platform_app;
--> statement-breakpoint

CREATE FUNCTION resolve_api_key(p_hash text)
RETURNS TABLE (id uuid, organization_id uuid, created_by_user_id uuid, mode text,
               scopes text[], revoked_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.lookup_api_key_hash', p_hash, true);
  RETURN QUERY
    SELECT k.id, k.organization_id, k.created_by_user_id, k.mode, k.scopes, k.revoked_at
    FROM api_keys k WHERE k.key_hash = p_hash;
  PERFORM set_config('app.lookup_api_key_hash', '', true);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION resolve_api_key(text) OWNER TO platform_migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_api_key(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_api_key(text) TO platform_app;
--> statement-breakpoint

CREATE FUNCTION resolve_candidate_link(p_hash text)
RETURNS TABLE (id uuid, organization_id uuid, job_id uuid, candidate_id uuid,
               created_by_user_id uuid, is_test boolean, full_name text, email text,
               expires_at timestamp with time zone, used_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.lookup_link_hash', p_hash, true);
  RETURN QUERY
    SELECT l.id, l.organization_id, l.job_id, l.candidate_id, l.created_by_user_id,
           l.is_test, l.full_name, l.email, l.expires_at, l.used_at
    FROM candidate_links l WHERE l.token_hash = p_hash;
  PERFORM set_config('app.lookup_link_hash', '', true);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION resolve_candidate_link(text) OWNER TO platform_migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_candidate_link(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_candidate_link(text) TO platform_app;
