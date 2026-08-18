/**
 * The seven system roles and their permission bundles.
 *
 * Source of truth: `BRD's/11_PERMISSION_MATRIX.md` (ACCEPTED 2026-08-16).
 *
 * Roles are held per *membership*, not per user (ADR-005): the same person may
 * be an Owner in one organization and a Viewer in another.
 *
 * System roles have `organization_id IS NULL` and are available to every
 * organization. Organization-defined custom roles are deferred past MVP, but
 * the schema already supports them.
 */

import { PERMISSIONS, type Permission } from './permissions.js';

export const SYSTEM_ROLES = [
  'owner',
  'administrator',
  'agent_manager',
  'knowledge_manager',
  'recruiter',
  'analyst',
  'viewer',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface SystemRoleDefinition {
  readonly key: SystemRole;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

/** Owner holds every permission in the catalogue. */
const OWNER_PERMISSIONS: readonly Permission[] = PERMISSIONS;

/**
 * Administrator holds everything except the three Owner-only powers:
 * deleting the organization, managing custom roles, and changing billing.
 */
const ADMINISTRATOR_EXCLUSIONS: readonly Permission[] = [
  'organization.delete',
  'roles.manage',
  'billing.manage',
];

const ADMINISTRATOR_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (p) => !ADMINISTRATOR_EXCLUSIONS.includes(p),
);

/**
 * Agent Manager builds, tests, deploys and tunes agents and workflows.
 *
 * Deliberate asymmetry: transcripts and recordings are granted (you cannot
 * tune conversation quality without hearing how conversations go) while bulk
 * candidate contact details are not.
 */
const AGENT_MANAGER_PERMISSIONS: readonly Permission[] = [
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
  'agents.archive',
  'agents.sessions.read',
  'agents.sessions.manage',
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
  'usage.read',
];

/**
 * Knowledge Manager curates the knowledge base and is fully walled off from
 * candidate and call data. Least privilege applied literally.
 */
const KNOWLEDGE_MANAGER_PERMISSIONS: readonly Permission[] = [
  'organization.read',
  'agents.read',
  'knowledge.read',
  'knowledge.create',
  'knowledge.update',
  'knowledge.delete',
  'knowledge.reindex',
  'jobs.read',
  'workflows.read',
];

/**
 * Recruiter / Operator does the day-to-day hiring work and is the only
 * non-admin role with candidate contact details.
 *
 * `agents.pause` is granted deliberately: pausing is a safety action, and the
 * operator watching a screening call go wrong should be able to stop it
 * without finding an administrator. The brake is shared more widely than the
 * accelerator.
 */
const RECRUITER_PERMISSIONS: readonly Permission[] = [
  'organization.read',
  'users.read',
  'agents.read',
  'agents.pause',
  'agents.sessions.read',
  'agents.sessions.manage',
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
  'usage.read',
];

/**
 * Analyst is read-only and deliberately excluded from personal data:
 * no contact details, no transcripts, no recordings, no export.
 * Analysts work through aggregated analytics endpoints.
 */
const ANALYST_PERMISSIONS: readonly Permission[] = [
  'organization.read',
  'users.read',
  'agents.read',
  'knowledge.read',
  'jobs.read',
  'candidates.read',
  'calls.read',
  'workflows.read',
  'analytics.read',
  'usage.read',
];

/** Viewer sees business outcomes and no personal data of any kind. */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  'organization.read',
  'agents.read',
  'jobs.read',
  'calls.read',
  'workflows.read',
  'analytics.read',
];

export const SYSTEM_ROLE_DEFINITIONS: readonly SystemRoleDefinition[] = [
  {
    key: 'owner',
    name: 'Owner',
    description:
      'Ultimate authority. Billing, organization deletion and ownership transfer.',
    permissions: OWNER_PERMISSIONS,
  },
  {
    key: 'administrator',
    name: 'Administrator',
    description:
      'Full operational control. Cannot delete the organization or change billing.',
    permissions: ADMINISTRATOR_PERMISSIONS,
  },
  {
    key: 'agent_manager',
    name: 'Agent Manager',
    description:
      'Builds, tests and deploys agents and workflows. Reads conversations to tune quality.',
    permissions: AGENT_MANAGER_PERMISSIONS,
  },
  {
    key: 'knowledge_manager',
    name: 'Knowledge Manager',
    description:
      'Owns the knowledge base. No candidate or call access.',
    permissions: KNOWLEDGE_MANAGER_PERMISSIONS,
  },
  {
    key: 'recruiter',
    name: 'Recruiter / Operator',
    description:
      'Day-to-day hiring work. The only non-admin role with candidate contact details.',
    permissions: RECRUITER_PERMISSIONS,
  },
  {
    key: 'analyst',
    name: 'Analyst',
    description:
      'Read-only analysis. Excluded from contact details, transcripts and recordings.',
    permissions: ANALYST_PERMISSIONS,
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Minimal read access to business outcomes. No personal data.',
    permissions: VIEWER_PERMISSIONS,
  },
];

const ROLE_BY_KEY = new Map<SystemRole, SystemRoleDefinition>(
  SYSTEM_ROLE_DEFINITIONS.map((r) => [r.key, r]),
);

export function systemRole(key: SystemRole): SystemRoleDefinition {
  const role = ROLE_BY_KEY.get(key);
  if (!role) throw new Error(`Unknown system role: ${key}`);
  return role;
}

export function isSystemRole(value: string): value is SystemRole {
  return ROLE_BY_KEY.has(value as SystemRole);
}

/**
 * Structural invariants that the matrix alone cannot express
 * (11_PERMISSION_MATRIX.md, "Structural invariants").
 */

/** Only an Owner may grant or revoke the Owner role. */
export function canAssignRole(
  actorRole: SystemRole,
  targetRole: SystemRole,
): boolean {
  if (targetRole === 'owner') return actorRole === 'owner';
  return actorRole === 'owner' || actorRole === 'administrator';
}

/** An Administrator cannot modify an Owner's membership. */
export function canModifyMembershipOf(
  actorRole: SystemRole,
  subjectRole: SystemRole,
): boolean {
  if (subjectRole === 'owner') return actorRole === 'owner';
  return actorRole === 'owner' || actorRole === 'administrator';
}

/**
 * Whether a role is the Owner role.
 *
 * The last-owner invariant is inherently about a specific role, not about a
 * permission — "keep at least one Owner" cannot be expressed as a permission
 * check. Naming it here keeps the comparison in the one module allowed to
 * make it, so call sites read as invariants rather than as role-based
 * authorization (ADR-004), and the lint rule can stay strict everywhere else.
 */
export function isOwnerRole(roleKey: string): boolean {
  return roleKey === 'owner';
}

/** Would this role change remove Owner authority from a membership? */
export function isOwnerDemotion(fromRoleKey: string, toRoleKey: string): boolean {
  return isOwnerRole(fromRoleKey) && !isOwnerRole(toRoleKey);
}
