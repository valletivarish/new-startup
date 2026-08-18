export { users, sessions, accounts, verifications } from './auth.js';
export { organizations } from './organizations.js';
export { roles, permissions, rolePermissions } from './authz.js';
export {
  organizationMemberships,
  organizationInvitations,
} from './membership.js';
export { auditEvents } from './audit.js';
export {
  agents,
  agentVersions,
  agentSessions,
  agentEvents,
} from './agents.js';
export {
  EMBEDDING_DIMENSIONS,
  knowledgeSources,
  knowledgeDocuments,
  knowledgeChunks,
  agentKnowledgeSources,
  knowledgeProcessingRuns,
} from './knowledge.js';

/**
 * Tables deliberately exempt from row-level security.
 *
 * Source: `12_ARCHITECTURE_DECISIONS_FINAL.md` A6, which enumerates the
 * exempt set exhaustively. `accounts` and `verifications` are Better Auth
 * internals belonging to the same identity layer as `users` and `sessions`,
 * and carry no organization scope.
 *
 * The `rls_is_enabled_and_forced_on_every_tenant_table` schema-drift test
 * reads this list. Adding a table here is therefore a visible, reviewable act
 * — which is the point.
 */
export const RLS_EXEMPT_TABLES = [
  'users',
  'sessions',
  'accounts',
  'verifications',
  'organizations',
  'permissions',
  'role_permissions',
] as const;

/**
 * Tables that carry RLS but cannot use the plain
 * `organization_id = current_org_id()` policy, because they must be readable
 * before a tenant context exists. Each is justified in `membership.ts`.
 */
export const RLS_BOOTSTRAP_TABLES = [
  'organization_memberships',
  'organization_invitations',
  'roles',
] as const;

/**
 * Phase 2 agent tables. Plain tenant policies — no bootstrap exception is
 * needed, because every access happens inside an established organization
 * context.
 */
export const AGENT_TABLES = [
  'agents',
  'agent_versions',
  'agent_sessions',
  'agent_events',
] as const;

/** Phase 3 knowledge tables. Plain tenant policies, same posture as above. */
export const KNOWLEDGE_TABLES = [
  'knowledge_sources',
  'knowledge_documents',
  'knowledge_chunks',
  'agent_knowledge_sources',
  'knowledge_processing_runs',
] as const;
