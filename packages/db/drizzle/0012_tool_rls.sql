-- ---------------------------------------------------------------------------
-- Phase 4 tool tables: row-level security and privileges.
--
-- Same posture as every earlier phase. Two details specific to tools:
--
--   * `tool_executions` is APPEND-ONLY for the runtime role. It records both
--     authorized and DENIED attempts, and a denial record that could be
--     edited away would be worthless as evidence.
--
--   * `tools.required_permission` is data the authorization layer reads. It
--     is writable only within the tenant, so one organization cannot lower
--     another's bar for executing a tool.
-- ---------------------------------------------------------------------------

ALTER TABLE "tools" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tools" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tools_tenant_isolation" ON "tools"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "agent_tools" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tools" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_tools_tenant_isolation" ON "agent_tools"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "tool_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tool_executions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tool_executions_select" ON "tool_executions"
  FOR SELECT USING ("organization_id" = current_org_id());
CREATE POLICY "tool_executions_insert" ON "tool_executions"
  FOR INSERT WITH CHECK ("organization_id" = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "tools" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_tools" TO platform_app;

-- Append-only: the audit of what was attempted must not be rewritable.
GRANT SELECT, INSERT ON "tool_executions" TO platform_app;
REVOKE UPDATE, DELETE ON "tool_executions" FROM platform_app;

-- session_id references a Phase 2 table, so the FK is added here.
ALTER TABLE "tool_executions"
  ADD CONSTRAINT "tool_executions_session_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE;
