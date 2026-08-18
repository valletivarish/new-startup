-- ---------------------------------------------------------------------------
-- Row-level security.
--
-- ADR-003, and the engineering rule elevated by the founder:
--
--     "No cross-tenant data access, even accidentally."
--
-- Isolation is enforced at three layers. This file is the third and last one,
-- the backstop that turns a forgotten `WHERE organization_id = $1` from a
-- silent cross-tenant leak into a query that returns nothing.
--
--   1. Authorization      — does this membership hold the permission?
--   2. Explicit filtering — the application still filters by organization_id
--   3. RLS (this file)    — the database refuses anything else
--
-- Every policy is expressed against current_org_id() / current_actor_id(),
-- which read GUCs set with SET LOCAL inside an explicit transaction and
-- derived exclusively from the authenticated server-side session.
--
-- FORCE ROW LEVEL SECURITY is set on every table so that the policies apply
-- even to platform_migrator, which owns them. Neither platform_migrator nor
-- platform_app has BYPASSRLS; a test asserts this at runtime.
-- ---------------------------------------------------------------------------

--
-- roles
--
-- Two kinds of row live here. System roles (organization_id IS NULL) are
-- available to every organization and are exempt per A6. Organization-defined
-- custom roles are not exempt — A6 exempts "system roles" specifically — so
-- they are scoped. One policy expresses both.
--
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "roles_tenant_isolation" ON "roles"
  FOR ALL
  USING (
    "organization_id" IS NULL
    OR "organization_id" = current_org_id()
  )
  WITH CHECK (
    -- A custom role may only ever be written into the active organization.
    -- System roles are seeded by migration, not by the application role.
    "organization_id" = current_org_id()
  );

--
-- organization_memberships
--
-- BOOTSTRAP TABLE. Cannot use the plain policy.
--
-- Login must answer "which organizations does this user belong to?", and every
-- request re-validates the session's active_organization_id against an active
-- membership. Both happen BEFORE any organization context exists, so a policy
-- of `organization_id = current_org_id()` alone would return zero rows and
-- make login impossible.
--
-- Resolution: you may always read your OWN membership rows. WITH CHECK stays
-- strict on organization_id, so no widening of write authority occurs — a
-- member still cannot create or move a membership into another organization.
--
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_memberships" FORCE ROW LEVEL SECURITY;

CREATE POLICY "organization_memberships_tenant_isolation" ON "organization_memberships"
  FOR ALL
  USING (
    "organization_id" = current_org_id()
    OR "user_id" = current_actor_id()
  )
  WITH CHECK (
    "organization_id" = current_org_id()
  );

--
-- organization_invitations
--
-- BOOTSTRAP TABLE. Acceptance is a public route reached from an email link,
-- with no session and no organization context.
--
-- Resolution: presenting the token IS the authorization. The application sets
-- app.invitation_token_hash inside the acceptance transaction, derived from
-- the token the caller supplied, and the policy exposes exactly the one row
-- whose hash matches. Knowledge of an unguessable token is the credential.
--
ALTER TABLE "organization_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_invitations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "organization_invitations_tenant_isolation" ON "organization_invitations"
  FOR ALL
  USING (
    "organization_id" = current_org_id()
    OR "token_hash" = current_invitation_token_hash()
  )
  WITH CHECK (
    "organization_id" = current_org_id()
  );

--
-- audit_events
--
-- organization_id is nullable: registration, login, failed login and password
-- reset must be audited but have no tenant context.
--
-- Reads are strictly tenant-scoped, so platform-level (NULL) rows are never
-- visible through the tenant-scoped API. Writes additionally permit NULL so
-- the server can record those platform events. Audit writes are server-issued
-- only; no route accepts a caller-supplied audit row.
--
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_tenant_isolation" ON "audit_events"
  FOR ALL
  USING (
    "organization_id" = current_org_id()
  )
  WITH CHECK (
    "organization_id" = current_org_id()
    OR "organization_id" IS NULL
  );

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Explicit grants for the tables created in 0000. ALTER DEFAULT PRIVILEGES in
-- the container bootstrap covers tables created later, but those defaults only
-- apply to objects created AFTER the statement ran, so the initial set is
-- granted here directly.
--
-- The application role receives DML only. It has no DDL, so it cannot disable
-- row-level security or drop a policy on a table it can read.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO platform_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO platform_app;

-- Defence in depth: make the intent explicit and greppable rather than
-- relying on the role never having been granted these.
REVOKE CREATE ON SCHEMA public FROM platform_app;
