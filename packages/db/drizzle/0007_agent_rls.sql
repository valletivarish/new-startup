-- ---------------------------------------------------------------------------
-- Phase 2 agent tables: row-level security and published-version immutability.
--
-- Same posture as Phase 1 — no new isolation mechanism, no exceptions. Every
-- agent table is organization-owned, so each gets the plain tenant policy:
-- ENABLE + FORCE, USING and WITH CHECK both on current_org_id(). None of them
-- needs a bootstrap arm, because every access happens inside an established
-- organization context.
-- ---------------------------------------------------------------------------

ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agents_tenant_isolation" ON "agents"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "agent_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_versions_tenant_isolation" ON "agent_versions"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "agent_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_sessions_tenant_isolation" ON "agent_sessions"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

-- Events are APPEND-ONLY. Reads and inserts are tenant-scoped; UPDATE and
-- DELETE are revoked outright below, so the stream is a record of what
-- happened rather than a mutable log.
ALTER TABLE "agent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_events_select" ON "agent_events"
  FOR SELECT
  USING ("organization_id" = current_org_id());
CREATE POLICY "agent_events_insert" ON "agent_events"
  FOR INSERT
  WITH CHECK ("organization_id" = current_org_id());

-- ---------------------------------------------------------------------------
-- Published-version immutability.
--
-- A published version is what running sessions are pinned to, so it must not
-- change underneath them. Enforcing that in the service layer alone would
-- make the guarantee "we always remember to check"; a trigger makes it a
-- property of the database.
--
-- Publishing (draft -> published) and superseding (published -> superseded)
-- are the only permitted transitions of a published row, and neither may
-- alter the configuration itself.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_agent_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.configuration IS DISTINCT FROM OLD.configuration THEN
      RAISE EXCEPTION
        'agent version %.% is published and its configuration is immutable; create a new draft version instead',
        OLD.agent_id, OLD.version
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.version IS DISTINCT FROM OLD.version
       OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION
        'agent version identity is immutable once published'
        USING ERRCODE = 'restrict_violation';
    END IF;

    -- A published version may only move on to `superseded` or `archived`.
    IF NEW.status NOT IN ('published', 'superseded', 'archived') THEN
      RAISE EXCEPTION
        'a published agent version cannot return to status %', NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_agent_version_immutability() OWNER TO platform_migrator;

CREATE TRIGGER agent_versions_immutable_when_published
  BEFORE UPDATE ON "agent_versions"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_version_immutability();

-- ---------------------------------------------------------------------------
-- Privileges: DML for the runtime role, minus mutation of the event log.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "agents" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_versions" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_sessions" TO platform_app;

-- Append-only: the runtime can write history and read it, never rewrite it.
GRANT SELECT, INSERT ON "agent_events" TO platform_app;
REVOKE UPDATE, DELETE ON "agent_events" FROM platform_app;

-- The agents.current_version_id FK is added here rather than in the table
-- definition because the two tables reference each other.
ALTER TABLE "agents"
  ADD CONSTRAINT "agents_current_version_id_fk"
  FOREIGN KEY ("current_version_id") REFERENCES "agent_versions"("id")
  ON DELETE SET NULL;
