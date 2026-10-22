-- ---------------------------------------------------------------------------
-- Careers-page embed: publishable keys on api_keys.
--
-- A publishable key (`hrv_pub_…`) is meant to sit in a company's public HTML.
-- It belongs to exactly one job and is only ever read by the public embed
-- routes, which let it add one candidate to that job and request one call.
-- The bearer-token guard never accepts it (its format differs, and kind is
-- checked too). Because it is public by design, the raw key is kept in
-- public_key so the dashboard can show the snippet again; key_hash is still
-- what lookups use. allowed_origins holds exact origins ("https://acme.in");
-- requests and CORS are allowed only from those.
-- ---------------------------------------------------------------------------

ALTER TABLE "api_keys"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'secret' CHECK ("kind" IN ('secret', 'publishable')),
  ADD COLUMN "job_id" uuid REFERENCES "jobs"("id") ON DELETE CASCADE,
  ADD COLUMN "allowed_origins" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "public_key" text UNIQUE;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_publishable_check" CHECK (
  ("kind" = 'publishable') = ("job_id" IS NOT NULL)
  AND ("kind" = 'publishable') = ("public_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "api_keys_job_idx" ON "api_keys" ("organization_id", "job_id") WHERE "job_id" IS NOT NULL;
--> statement-breakpoint

-- Calls requested from a careers-page form are their own source (calling hours apply).
ALTER TABLE "call_requests" DROP CONSTRAINT "call_requests_source_check";
--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_source_check"
  CHECK ("source" IN ('api', 'dashboard', 'link', 'zoho', 'embed'));
--> statement-breakpoint

-- The lookup also returns kind, job and origins (return type changes, so drop first).
DROP FUNCTION resolve_api_key(text);
--> statement-breakpoint
CREATE FUNCTION resolve_api_key(p_hash text)
RETURNS TABLE (id uuid, organization_id uuid, created_by_user_id uuid, mode text,
               scopes text[], revoked_at timestamp with time zone, kind text,
               job_id uuid, allowed_origins text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.lookup_api_key_hash', p_hash, true);
  RETURN QUERY
    SELECT k.id, k.organization_id, k.created_by_user_id, k.mode, k.scopes, k.revoked_at,
           k.kind, k.job_id, k.allowed_origins
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
