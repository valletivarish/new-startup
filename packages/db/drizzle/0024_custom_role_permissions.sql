-- ---------------------------------------------------------------------------
-- Organization-defined custom roles (ADR-004 extension point, schema already
-- supports roles.organization_id).
--
-- role_permissions stays a GLOBAL readable table (A6 exemption list), so
-- session resolution keeps working unchanged. What changes is WRITE authority:
-- the runtime role may now insert/delete grants, but a trigger refuses any
-- grant whose role is not a custom role of the CURRENT organization. System
-- bundles therefore remain writable only by the migrator (seed migrations).
--
-- Deleting a custom role: the application deletes its grants first (inside
-- the organization's context), then the role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_role_permission_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target uuid;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
  IF current_user = 'platform_app' AND NOT EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = target
      AND r.organization_id IS NOT NULL
      AND r.organization_id = current_org_id()
  ) THEN
    RAISE EXCEPTION 'permissions may only change for a custom role of the current organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION enforce_role_permission_scope() OWNER TO platform_migrator;
--> statement-breakpoint
CREATE TRIGGER role_permissions_scope
  BEFORE INSERT OR DELETE ON "role_permissions"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_role_permission_scope();
--> statement-breakpoint
GRANT INSERT, DELETE ON "role_permissions" TO platform_app;
