-- ---------------------------------------------------------------------------
-- Permission catalogue and system role bundles.
--
-- GENERATED FILE — do not edit by hand.
--   source:     packages/permissions/src/{permissions,roles}.ts
--   regenerate: pnpm --filter @platform/db exec tsx src/scripts/generate-seed-migration.ts
--   authority:  BRD's/11_PERMISSION_MATRIX.md (ACCEPTED 2026-08-16)
--
-- 51 permissions across 14 resource groups,
-- bundled into 7 system roles (171 grants).
--
-- Idempotent. Re-running is safe and keeps ids stable, so role_permissions
-- and memberships are never orphaned by a re-seed.
-- ---------------------------------------------------------------------------

-- Permissions ---------------------------------------------------------------

INSERT INTO "permissions" ("key", "resource", "action", "description", "is_sensitive") VALUES
  ('organization.read', 'organization', 'read', 'read on organization', false),
  ('organization.update', 'organization', 'update', 'update on organization', false),
  ('organization.delete', 'organization', 'delete', 'delete on organization', false),
  ('users.read', 'users', 'read', 'read on users', false),
  ('users.invite', 'users', 'invite', 'invite on users', false),
  ('users.update', 'users', 'update', 'update on users', false),
  ('users.deactivate', 'users', 'deactivate', 'deactivate on users', false),
  ('roles.read', 'roles', 'read', 'read on roles', false),
  ('roles.assign', 'roles', 'assign', 'assign on roles', false),
  ('roles.manage', 'roles', 'manage', 'Create and edit organization-defined custom roles', false),
  ('agents.read', 'agents', 'read', 'read on agents', false),
  ('agents.create', 'agents', 'create', 'create on agents', false),
  ('agents.update', 'agents', 'update', 'update on agents', false),
  ('agents.delete', 'agents', 'delete', 'delete on agents', false),
  ('agents.test', 'agents', 'test', 'test on agents', false),
  ('agents.deploy', 'agents', 'deploy', 'Deploy an agent to live traffic', false),
  ('agents.pause', 'agents', 'pause', 'Pause a running agent', false),
  ('knowledge.read', 'knowledge', 'read', 'read on knowledge', false),
  ('knowledge.create', 'knowledge', 'create', 'create on knowledge', false),
  ('knowledge.update', 'knowledge', 'update', 'update on knowledge', false),
  ('knowledge.delete', 'knowledge', 'delete', 'delete on knowledge', false),
  ('knowledge.reindex', 'knowledge', 'reindex', 'reindex on knowledge', false),
  ('jobs.read', 'jobs', 'read', 'read on jobs', false),
  ('jobs.create', 'jobs', 'create', 'create on jobs', false),
  ('jobs.update', 'jobs', 'update', 'update on jobs', false),
  ('jobs.delete', 'jobs', 'delete', 'delete on jobs', false),
  ('candidates.read', 'candidates', 'read', 'Read candidate records excluding contact details', false),
  ('candidates.read_pii', 'candidates', 'read_pii', 'Read candidate contact details and resume', true),
  ('candidates.create', 'candidates', 'create', 'create on candidates', false),
  ('candidates.update', 'candidates', 'update', 'update on candidates', false),
  ('candidates.delete', 'candidates', 'delete', 'delete on candidates', false),
  ('candidates.export', 'candidates', 'export', 'Export candidate data', true),
  ('calls.read', 'calls', 'read', 'Read call metadata only', false),
  ('calls.read_transcript', 'calls', 'read_transcript', 'Read call transcripts', true),
  ('calls.read_recording', 'calls', 'read_recording', 'Listen to call recordings', true),
  ('calls.initiate', 'calls', 'initiate', 'initiate on calls', false),
  ('workflows.read', 'workflows', 'read', 'read on workflows', false),
  ('workflows.create', 'workflows', 'create', 'create on workflows', false),
  ('workflows.update', 'workflows', 'update', 'update on workflows', false),
  ('workflows.delete', 'workflows', 'delete', 'delete on workflows', false),
  ('workflows.run', 'workflows', 'run', 'run on workflows', false),
  ('integrations.read', 'integrations', 'read', 'read on integrations', false),
  ('integrations.create', 'integrations', 'create', 'create on integrations', false),
  ('integrations.update', 'integrations', 'update', 'update on integrations', false),
  ('integrations.delete', 'integrations', 'delete', 'delete on integrations', false),
  ('analytics.read', 'analytics', 'read', 'read on analytics', false),
  ('usage.read', 'usage', 'read', 'read on usage', false),
  ('usage.manage_limits', 'usage', 'manage_limits', 'manage_limits on usage', false),
  ('billing.read', 'billing', 'read', 'read on billing', false),
  ('billing.manage', 'billing', 'manage', 'Change plan, payment method or subscription', false),
  ('audit.read', 'audit', 'read', 'read on audit', false)
ON CONFLICT ("key") DO UPDATE SET
  "resource"     = EXCLUDED."resource",
  "action"       = EXCLUDED."action",
  "description"  = EXCLUDED."description",
  "is_sensitive" = EXCLUDED."is_sensitive";

-- System roles --------------------------------------------------------------
--
-- organization_id IS NULL marks a system role, available to every
-- organization. Organization-defined custom roles are deferred past MVP.
--
-- The RLS policy on "roles" requires organization_id = current_org_id() on
-- write, which is correct: it stops the application creating a custom role
-- in someone else's organization, and stops it minting system roles at all.
-- System roles are migration-managed data, so FORCE is briefly dropped here
-- and restored immediately. This is a DDL operation, available only to the
-- table owner (platform_migrator) — platform_app has no DDL and can never
-- do it. DDL is transactional in PostgreSQL, so a failure anywhere in this
-- migration rolls the FORCE back on with everything else.

ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;

INSERT INTO "roles" ("organization_id", "key", "name", "description", "is_system") VALUES
  (NULL, 'owner', 'Owner', 'Ultimate authority. Billing, organization deletion and ownership transfer.', true),
  (NULL, 'administrator', 'Administrator', 'Full operational control. Cannot delete the organization or change billing.', true),
  (NULL, 'agent_manager', 'Agent Manager', 'Builds, tests and deploys agents and workflows. Reads conversations to tune quality.', true),
  (NULL, 'knowledge_manager', 'Knowledge Manager', 'Owns the knowledge base. No candidate or call access.', true),
  (NULL, 'recruiter', 'Recruiter / Operator', 'Day-to-day hiring work. The only non-admin role with candidate contact details.', true),
  (NULL, 'analyst', 'Analyst', 'Read-only analysis. Excluded from contact details, transcripts and recordings.', true),
  (NULL, 'viewer', 'Viewer', 'Minimal read access to business outcomes. No personal data.', true)
ON CONFLICT ("key") WHERE "organization_id" IS NULL DO UPDATE SET
  "name"        = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_system"   = true;

ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

-- Role to permission matrix -------------------------------------------------

-- Owner — 51 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'owner'
  AND p."key" IN (
    'organization.read',
    'organization.update',
    'organization.delete',
    'users.read',
    'users.invite',
    'users.update',
    'users.deactivate',
    'roles.read',
    'roles.assign',
    'roles.manage',
    'agents.read',
    'agents.create',
    'agents.update',
    'agents.delete',
    'agents.test',
    'agents.deploy',
    'agents.pause',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.delete',
    'knowledge.reindex',
    'jobs.read',
    'jobs.create',
    'jobs.update',
    'jobs.delete',
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
    'candidates.delete',
    'candidates.export',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'calls.initiate',
    'workflows.read',
    'workflows.create',
    'workflows.update',
    'workflows.delete',
    'workflows.run',
    'integrations.read',
    'integrations.create',
    'integrations.update',
    'integrations.delete',
    'analytics.read',
    'usage.read',
    'usage.manage_limits',
    'billing.read',
    'billing.manage',
    'audit.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Administrator — 48 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'administrator'
  AND p."key" IN (
    'organization.read',
    'organization.update',
    'users.read',
    'users.invite',
    'users.update',
    'users.deactivate',
    'roles.read',
    'roles.assign',
    'agents.read',
    'agents.create',
    'agents.update',
    'agents.delete',
    'agents.test',
    'agents.deploy',
    'agents.pause',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.delete',
    'knowledge.reindex',
    'jobs.read',
    'jobs.create',
    'jobs.update',
    'jobs.delete',
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
    'candidates.delete',
    'candidates.export',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'calls.initiate',
    'workflows.read',
    'workflows.create',
    'workflows.update',
    'workflows.delete',
    'workflows.run',
    'integrations.read',
    'integrations.create',
    'integrations.update',
    'integrations.delete',
    'analytics.read',
    'usage.read',
    'usage.manage_limits',
    'billing.read',
    'audit.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Agent Manager — 25 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'agent_manager'
  AND p."key" IN (
    'organization.read',
    'users.read',
    'roles.read',
    'agents.read',
    'agents.create',
    'agents.update',
    'agents.delete',
    'agents.test',
    'agents.deploy',
    'agents.pause',
    'knowledge.read',
    'knowledge.reindex',
    'jobs.read',
    'candidates.read',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'workflows.read',
    'workflows.create',
    'workflows.update',
    'workflows.delete',
    'workflows.run',
    'integrations.read',
    'analytics.read',
    'usage.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Knowledge Manager — 9 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'knowledge_manager'
  AND p."key" IN (
    'organization.read',
    'agents.read',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.delete',
    'knowledge.reindex',
    'jobs.read',
    'workflows.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Recruiter / Operator — 22 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'recruiter'
  AND p."key" IN (
    'organization.read',
    'users.read',
    'agents.read',
    'agents.pause',
    'knowledge.read',
    'jobs.read',
    'jobs.create',
    'jobs.update',
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
    'candidates.export',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'calls.initiate',
    'workflows.read',
    'workflows.run',
    'integrations.read',
    'analytics.read',
    'usage.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Analyst — 10 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'analyst'
  AND p."key" IN (
    'organization.read',
    'users.read',
    'agents.read',
    'knowledge.read',
    'jobs.read',
    'candidates.read',
    'calls.read',
    'workflows.read',
    'analytics.read',
    'usage.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Viewer — 6 of 51 permissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."key" = 'viewer'
  AND p."key" IN (
    'organization.read',
    'agents.read',
    'jobs.read',
    'calls.read',
    'workflows.read',
    'analytics.read'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Remove grants that are no longer in the catalogue, so that revoking a
-- permission from a role in code actually revokes it in the database.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'owner'
  AND p."key" NOT IN (
    'organization.read',
    'organization.update',
    'organization.delete',
    'users.read',
    'users.invite',
    'users.update',
    'users.deactivate',
    'roles.read',
    'roles.assign',
    'roles.manage',
    'agents.read',
    'agents.create',
    'agents.update',
    'agents.delete',
    'agents.test',
    'agents.deploy',
    'agents.pause',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.delete',
    'knowledge.reindex',
    'jobs.read',
    'jobs.create',
    'jobs.update',
    'jobs.delete',
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
    'candidates.delete',
    'candidates.export',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'calls.initiate',
    'workflows.read',
    'workflows.create',
    'workflows.update',
    'workflows.delete',
    'workflows.run',
    'integrations.read',
    'integrations.create',
    'integrations.update',
    'integrations.delete',
    'analytics.read',
    'usage.read',
    'usage.manage_limits',
    'billing.read',
    'billing.manage',
    'audit.read'
  );

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'administrator'
  AND p."key" NOT IN (
    'organization.read',
    'organization.update',
    'users.read',
    'users.invite',
    'users.update',
    'users.deactivate',
    'roles.read',
    'roles.assign',
    'agents.read',
    'agents.create',
    'agents.update',
    'agents.delete',
    'agents.test',
    'agents.deploy',
    'agents.pause',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.delete',
    'knowledge.reindex',
    'jobs.read',
    'jobs.create',
    'jobs.update',
    'jobs.delete',
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
    'candidates.delete',
    'candidates.export',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'calls.initiate',
    'workflows.read',
    'workflows.create',
    'workflows.update',
    'workflows.delete',
    'workflows.run',
    'integrations.read',
    'integrations.create',
    'integrations.update',
    'integrations.delete',
    'analytics.read',
    'usage.read',
    'usage.manage_limits',
    'billing.read',
    'audit.read'
  );

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'agent_manager'
  AND p."key" NOT IN (
    'organization.read',
    'users.read',
    'roles.read',
    'agents.read',
    'agents.create',
    'agents.update',
    'agents.delete',
    'agents.test',
    'agents.deploy',
    'agents.pause',
    'knowledge.read',
    'knowledge.reindex',
    'jobs.read',
    'candidates.read',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'workflows.read',
    'workflows.create',
    'workflows.update',
    'workflows.delete',
    'workflows.run',
    'integrations.read',
    'analytics.read',
    'usage.read'
  );

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'knowledge_manager'
  AND p."key" NOT IN (
    'organization.read',
    'agents.read',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.delete',
    'knowledge.reindex',
    'jobs.read',
    'workflows.read'
  );

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'recruiter'
  AND p."key" NOT IN (
    'organization.read',
    'users.read',
    'agents.read',
    'agents.pause',
    'knowledge.read',
    'jobs.read',
    'jobs.create',
    'jobs.update',
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
    'candidates.export',
    'calls.read',
    'calls.read_transcript',
    'calls.read_recording',
    'calls.initiate',
    'workflows.read',
    'workflows.run',
    'integrations.read',
    'analytics.read',
    'usage.read'
  );

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'analyst'
  AND p."key" NOT IN (
    'organization.read',
    'users.read',
    'agents.read',
    'knowledge.read',
    'jobs.read',
    'candidates.read',
    'calls.read',
    'workflows.read',
    'analytics.read',
    'usage.read'
  );

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."organization_id" IS NULL AND r."key" = 'viewer'
  AND p."key" NOT IN (
    'organization.read',
    'agents.read',
    'jobs.read',
    'calls.read',
    'workflows.read',
    'analytics.read'
  );
