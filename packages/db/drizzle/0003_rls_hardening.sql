-- ---------------------------------------------------------------------------
-- RLS hardening — fixes confirmed findings from the Phase 1 independent audit.
--
--   1. roles: the FOR ALL policy let any tenant context DELETE shared system
--      roles (USING permitted the NULL-org rows; WITH CHECK governs only
--      INSERT/UPDATE, not DELETE). Split into per-command policies.
--   2. audit_events: the trail was not tamper-proof (app role held UPDATE/
--      DELETE) and a tenant context could forge platform-level NULL-org rows.
--      Revoke mutation; split INSERT policies per context.
--   3. audit_events.organization_id cascaded on org delete, erasing the org's
--      own audit trail including the deletion record. Now SET NULL: rows are
--      preserved as platform-level history.
--   4. permissions / role_permissions: the runtime role could rewrite the
--      authorization catalogue. Now read-only to platform_app; only the
--      migrator (seed migrations) writes them.
--   5. organization_invitations: the WITH CHECK blocked the legitimate
--      token-holder expiry-marking UPDATE (accepting an expired invitation
--      500ed and the email became un-reinvitable). The write arm now also
--      accepts the presented token hash — still bound to exactly one row.
-- ---------------------------------------------------------------------------

--
-- 1. roles: per-command policies
--
DROP POLICY "roles_tenant_isolation" ON "roles";

CREATE POLICY "roles_select" ON "roles"
  FOR SELECT
  USING (
    "organization_id" IS NULL
    OR "organization_id" = current_org_id()
  );

CREATE POLICY "roles_insert" ON "roles"
  FOR INSERT
  WITH CHECK ("organization_id" = current_org_id());

CREATE POLICY "roles_update" ON "roles"
  FOR UPDATE
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

-- DELETE reaches only the tenant's own custom roles, never system roles.
CREATE POLICY "roles_delete" ON "roles"
  FOR DELETE
  USING ("organization_id" = current_org_id());

--
-- 2 + 3. audit_events: append-only, forge-proof, retained after org deletion
--
REVOKE UPDATE, DELETE ON "audit_events" FROM platform_app;

DROP POLICY "audit_events_tenant_isolation" ON "audit_events";

CREATE POLICY "audit_events_select" ON "audit_events"
  FOR SELECT
  USING ("organization_id" = current_org_id());

-- Tenant context writes tenant rows; NULL-org platform rows can be written
-- only when NO tenant context exists (the auth layer). A tenant context can
-- therefore no longer forge platform-level entries.
CREATE POLICY "audit_events_insert_tenant" ON "audit_events"
  FOR INSERT
  WITH CHECK (
    current_org_id() IS NOT NULL
    AND "organization_id" = current_org_id()
  );

CREATE POLICY "audit_events_insert_platform" ON "audit_events"
  FOR INSERT
  WITH CHECK (
    current_org_id() IS NULL
    AND "organization_id" IS NULL
  );

ALTER TABLE "audit_events"
  DROP CONSTRAINT "audit_events_organization_id_organizations_id_fk";

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL;

--
-- 4. authorization catalogue: read-only at runtime
--
REVOKE INSERT, UPDATE, DELETE ON "permissions" FROM platform_app;
REVOKE INSERT, UPDATE, DELETE ON "role_permissions" FROM platform_app;

--
-- 5. invitations: allow the token holder's own row transitions
--
DROP POLICY "organization_invitations_tenant_isolation" ON "organization_invitations";

CREATE POLICY "organization_invitations_tenant_isolation" ON "organization_invitations"
  FOR ALL
  USING (
    "organization_id" = current_org_id()
    OR "token_hash" = current_invitation_token_hash()
  )
  WITH CHECK (
    "organization_id" = current_org_id()
    OR "token_hash" = current_invitation_token_hash()
  );
