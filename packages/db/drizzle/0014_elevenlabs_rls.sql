-- ---------------------------------------------------------------------------
-- MVP-01 ElevenLabs tables: row-level security and privileges.
--
-- Same ENABLE + FORCE + plain tenant isolation posture as every prior phase.
-- Neither table has a bootstrap exception — every access happens inside an
-- established organization context.
--
-- voice_sessions contains the WebRTC conversation token (written at creation,
-- never returned via API). The SELECT policy therefore covers all columns,
-- but the API layer redacts the token before returning results to callers.
-- ---------------------------------------------------------------------------

ALTER TABLE "voice_provider_deployments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_provider_deployments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "vpd_tenant_isolation" ON "voice_provider_deployments"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "voice_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "vs_tenant_isolation" ON "voice_sessions"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "voice_provider_deployments" TO platform_app;
GRANT SELECT, INSERT, UPDATE        ON "voice_sessions"               TO platform_app;

-- voice_sessions are append-only from the application perspective:
-- results are written via UPDATE (status, transcript, etc.) but never deleted.
REVOKE DELETE ON "voice_sessions" FROM platform_app;
