ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "jobs_tenant_isolation" ON "jobs"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "candidates_tenant_isolation" ON "candidates"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "job_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_candidates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "job_candidates_tenant_isolation" ON "job_candidates"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "jobs" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "candidates" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_candidates" TO platform_app;
