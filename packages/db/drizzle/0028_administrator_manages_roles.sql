-- ---------------------------------------------------------------------------
-- Administrators manage custom roles (ADR-009, ACCEPTED 2026-10-01 on the
-- founder's instruction that permissions be configurable at admin level).
--
-- Grants roles.manage (and roles.read, already held) to the Administrator
-- system role. Nothing else changes: the API still refuses to let anyone grant
-- a permission they do not hold, so an Administrator can neither create
-- Owner-only power (organization.delete, billing.manage) nor touch Owners.
--
-- Idempotent, like the generated seeds it amends.
-- ---------------------------------------------------------------------------

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'administrator'
  AND p."key" IN (
    'roles.read',
    'roles.manage'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
