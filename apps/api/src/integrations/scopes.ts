/**
 * API key scopes. A key's permissions are its creator's role permissions
 * intersected with the union of SCOPE_PERMISSIONS for the key's scopes.
 */

import type { Permission } from '@platform/permissions';

export const API_SCOPES = [
  'jobs',
  'candidates',
  'calls',
  'results',
  'webhooks',
  'usage',
  'support',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_PERMISSIONS: Record<ApiScope, readonly Permission[]> = {
  jobs: ['jobs.read', 'jobs.create', 'jobs.update'],
  candidates: [
    'candidates.read',
    'candidates.read_pii',
    'candidates.create',
    'candidates.update',
  ],
  calls: ['calls.read', 'calls.initiate'],
  results: ['calls.read_transcript', 'calls.read_recording'],
  webhooks: [
    'integrations.read',
    'integrations.create',
    'integrations.update',
    'integrations.delete',
  ],
  usage: ['usage.read'],
  // Raise, read and reply to the company's support tickets.
  support: ['support.use'],
};

/** Every permission granted by any of `scopes`. Unknown scopes grant nothing. */
export function scopePermissions(scopes: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const scope of scopes) {
    if (!Object.hasOwn(SCOPE_PERMISSIONS, scope)) continue;
    for (const p of SCOPE_PERMISSIONS[scope as ApiScope]) out.add(p);
  }
  return out;
}
