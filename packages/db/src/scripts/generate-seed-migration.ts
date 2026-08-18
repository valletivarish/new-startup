/**
 * Generates `drizzle/0002_seed_permission_matrix.sql` from the TypeScript
 * permission catalogue.
 *
 * The catalogue in `@platform/permissions` is the single source of truth —
 * it is what application code type-checks against. Hand-writing the same 51
 * permissions and seven role bundles into SQL would guarantee drift, so the
 * SQL is generated from the catalogue instead.
 *
 * Re-run after changing the catalogue:
 *
 *     pnpm --filter @platform/db exec tsx src/scripts/generate-seed-migration.ts
 *
 * The `permission_catalogue_matches_code` test fails if the database and the
 * catalogue ever disagree, so drift cannot pass review silently.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  permissionAction,
  permissionResource,
  type Permission,
} from '@platform/permissions';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(
  here,
  '..',
  '..',
  'drizzle',
  '0002_seed_permission_matrix.sql',
);

const sensitive = new Set<string>(SENSITIVE_PERMISSIONS);

/** Single-quote escaping for SQL string literals. */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const DESCRIPTIONS: Partial<Record<Permission, string>> = {
  'candidates.read': 'Read candidate records excluding contact details',
  'candidates.read_pii': 'Read candidate contact details and resume',
  'candidates.export': 'Export candidate data',
  'calls.read': 'Read call metadata only',
  'calls.read_transcript': 'Read call transcripts',
  'calls.read_recording': 'Listen to call recordings',
  'agents.deploy': 'Deploy an agent to live traffic',
  'agents.pause': 'Pause a running agent',
  'roles.manage': 'Create and edit organization-defined custom roles',
  'billing.manage': 'Change plan, payment method or subscription',
};

const resourceGroups = new Set(PERMISSIONS.map(permissionResource));
const totalGrants = SYSTEM_ROLE_DEFINITIONS.reduce(
  (n, r) => n + r.permissions.length,
  0,
);

const out: string[] = [];

out.push(
  '-- ---------------------------------------------------------------------------',
  '-- Permission catalogue and system role bundles.',
  '--',
  '-- GENERATED FILE — do not edit by hand.',
  '--   source:     packages/permissions/src/{permissions,roles}.ts',
  '--   regenerate: pnpm --filter @platform/db exec tsx src/scripts/generate-seed-migration.ts',
  "--   authority:  BRD's/11_PERMISSION_MATRIX.md (ACCEPTED 2026-08-16)",
  '--',
  `-- ${PERMISSIONS.length} permissions across ${resourceGroups.size} resource groups,`,
  `-- bundled into ${SYSTEM_ROLE_DEFINITIONS.length} system roles (${totalGrants} grants).`,
  '--',
  '-- Idempotent. Re-running is safe and keeps ids stable, so role_permissions',
  '-- and memberships are never orphaned by a re-seed.',
  '-- ---------------------------------------------------------------------------',
  '',
  '-- Permissions ---------------------------------------------------------------',
  '',
  'INSERT INTO "permissions" ("key", "resource", "action", "description", "is_sensitive") VALUES',
);

out.push(
  PERMISSIONS.map((p) => {
    const desc =
      DESCRIPTIONS[p] ?? `${permissionAction(p)} on ${permissionResource(p)}`;
    return `  (${lit(p)}, ${lit(permissionResource(p))}, ${lit(
      permissionAction(p),
    )}, ${lit(desc)}, ${sensitive.has(p)})`;
  }).join(',\n'),
);
out.push('ON CONFLICT ("key") DO UPDATE SET');
out.push('  "resource"     = EXCLUDED."resource",');
out.push('  "action"       = EXCLUDED."action",');
out.push('  "description"  = EXCLUDED."description",');
out.push('  "is_sensitive" = EXCLUDED."is_sensitive";');
out.push('');

out.push(
  '-- System roles --------------------------------------------------------------',
  '--',
  '-- organization_id IS NULL marks a system role, available to every',
  '-- organization. Organization-defined custom roles are deferred past MVP.',
  '--',
  '-- The RLS policy on "roles" requires organization_id = current_org_id() on',
  '-- write, which is correct: it stops the application creating a custom role',
  '-- in someone else\'s organization, and stops it minting system roles at all.',
  '-- System roles are migration-managed data, so FORCE is briefly dropped here',
  '-- and restored immediately. This is a DDL operation, available only to the',
  '-- table owner (platform_migrator) — platform_app has no DDL and can never',
  '-- do it. DDL is transactional in PostgreSQL, so a failure anywhere in this',
  '-- migration rolls the FORCE back on with everything else.',
  '',
  'ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;',
  '',
  'INSERT INTO "roles" ("organization_id", "key", "name", "description", "is_system") VALUES',
);
out.push(
  SYSTEM_ROLE_DEFINITIONS.map(
    (r) => `  (NULL, ${lit(r.key)}, ${lit(r.name)}, ${lit(r.description)}, true)`,
  ).join(',\n'),
);
// Matches the partial unique index `roles_system_key_unique`.
out.push('ON CONFLICT ("key") WHERE "organization_id" IS NULL DO UPDATE SET');
out.push('  "name"        = EXCLUDED."name",');
out.push('  "description" = EXCLUDED."description",');
out.push('  "is_system"   = true;');
out.push('');
out.push('ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;');
out.push('');

out.push(
  '-- Role to permission matrix -------------------------------------------------',
  '',
);
for (const role of SYSTEM_ROLE_DEFINITIONS) {
  out.push(
    `-- ${role.name} — ${role.permissions.length} of ${PERMISSIONS.length} permissions`,
  );
  out.push('INSERT INTO "role_permissions" ("role_id", "permission_id")');
  out.push('SELECT r."id", p."id"');
  out.push('FROM "roles" r');
  out.push('CROSS JOIN "permissions" p');
  out.push(
    `WHERE r."organization_id" IS NULL AND r."key" = ${lit(role.key)}`,
  );
  out.push('  AND p."key" IN (');
  out.push(role.permissions.map((p) => `    ${lit(p)}`).join(',\n'));
  out.push('  )');
  out.push('ON CONFLICT ("role_id", "permission_id") DO NOTHING;');
  out.push('');
}

out.push(
  '-- Remove grants that are no longer in the catalogue, so that revoking a',
  '-- permission from a role in code actually revokes it in the database.',
);
for (const role of SYSTEM_ROLE_DEFINITIONS) {
  out.push('DELETE FROM "role_permissions" rp');
  out.push('USING "roles" r, "permissions" p');
  out.push('WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"');
  out.push(
    `  AND r."organization_id" IS NULL AND r."key" = ${lit(role.key)}`,
  );
  out.push('  AND p."key" NOT IN (');
  out.push(role.permissions.map((p) => `    ${lit(p)}`).join(',\n'));
  out.push('  );');
  out.push('');
}

writeFileSync(target, out.join('\n'), 'utf8');

console.log(`wrote ${target}`);
console.log(
  `  ${PERMISSIONS.length} permissions · ${resourceGroups.size} resource groups · ${SYSTEM_ROLE_DEFINITIONS.length} roles · ${totalGrants} grants`,
);
for (const r of SYSTEM_ROLE_DEFINITIONS) {
  console.log(
    `  ${r.key.padEnd(18)} ${String(r.permissions.length).padStart(2)} permissions`,
  );
}
