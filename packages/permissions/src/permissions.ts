/**
 * The permission catalogue.
 *
 * Source of truth: `BRD's/11_PERMISSION_MATRIX.md` (ACCEPTED 2026-08-16).
 *
 * Application code checks permission strings, never role names (ADR-004):
 *
 *     @RequirePermission('agents.deploy')     ✅
 *     if (role === 'administrator')           ❌
 *
 * Adding a permission is a deliberate, reviewable act: add it here AND add a
 * migration that inserts it. The `permission_catalogue_matches_code` test
 * fails if the database and this file disagree.
 */

export const PERMISSIONS = [
  // Organization settings
  'organization.read',
  'organization.update',
  'organization.delete',

  // Users
  'users.read',
  'users.invite',
  'users.update',
  'users.deactivate',

  // Roles
  'roles.read',
  'roles.assign',
  'roles.manage',

  // Agents
  'agents.read',
  'agents.create',
  'agents.update',
  'agents.delete',
  'agents.test',

  // Agent deployment — deliberately separate from agents.update. Editing a
  // draft is free; deploying spends money and reaches real people.
  'agents.deploy',
  'agents.pause',

  // Knowledge
  'knowledge.read',
  'knowledge.create',
  'knowledge.update',
  'knowledge.delete',
  'knowledge.reindex',

  // Jobs
  'jobs.read',
  'jobs.create',
  'jobs.update',
  'jobs.delete',

  // Candidates — `read` excludes contact details; `read_pii` grants them.
  'candidates.read',
  'candidates.read_pii',
  'candidates.create',
  'candidates.update',
  'candidates.delete',
  'candidates.export',

  // Calls — `read` is metadata only. Transcripts and recordings are personal
  // data and are gated separately.
  'calls.read',
  'calls.read_transcript',
  'calls.read_recording',
  'calls.initiate',

  // Workflows
  'workflows.read',
  'workflows.create',
  'workflows.update',
  'workflows.delete',
  'workflows.run',

  // Integrations
  'integrations.read',
  'integrations.create',
  'integrations.update',
  'integrations.delete',

  // Analytics
  'analytics.read',

  // Usage
  'usage.read',
  'usage.manage_limits',

  // Billing
  'billing.read',
  'billing.manage',

  // Audit
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<Permission> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value as Permission);
}

/**
 * Permissions that expose personal data. Every successful read of one of
 * these writes an AuditEvent (11_PERMISSION_MATRIX.md, structural invariant 7).
 */
export const SENSITIVE_PERMISSIONS = [
  'candidates.read_pii',
  'candidates.export',
  'calls.read_transcript',
  'calls.read_recording',
] as const satisfies readonly Permission[];

export type SensitivePermission = (typeof SENSITIVE_PERMISSIONS)[number];

const SENSITIVE_SET: ReadonlySet<string> = new Set(SENSITIVE_PERMISSIONS);

export function isSensitivePermission(value: Permission): boolean {
  return SENSITIVE_SET.has(value);
}

export function permissionResource(permission: Permission): string {
  const [resource] = permission.split('.');
  // Every catalogue entry is `resource.action`, so this is always defined.
  return resource as string;
}

export function permissionAction(permission: Permission): string {
  const idx = permission.indexOf('.');
  return permission.slice(idx + 1);
}
