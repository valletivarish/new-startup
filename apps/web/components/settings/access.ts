// Access levels (the API's roles) in plain words, shared by Settings › Team and › Access levels.
// Relative imports, so vitest (no @ alias) can load this file.
import type { PermissionInfo, Role } from '../../lib/api';
import type { UseCaseDefinition } from '../../lib/use-case-definitions';

type Labels = UseCaseDefinition['labels'];

/** Query keys for the team's data, so a change on one tab refreshes the other. */
export const teamKeys = {
  members: ['team', 'members'],
  invites: ['team', 'invites'],
  roles: ['team', 'roles'],
  permissions: ['team', 'permissions'],
} as const;

const lower = (s: string) => s.toLowerCase();

// The built-in levels, least access first. Blurbs follow the permission sets the API grants each one.
const BUILT_IN: Record<string, { name: string; blurb: (l: Labels) => string }> = {
  viewer: { name: 'Viewer', blurb: (l) => `Sees ${lower(l.workItem.many)}, outcomes and analytics. No personal data.` },
  analyst: { name: 'Analyst', blurb: () => 'Analytics and outcomes. No contact details, transcripts or recordings.' },
  recruiter: {
    name: 'Recruiter',
    blurb: (l) =>
      `${l.workItem.many}, ${lower(l.contact.many)} and calls, including phone numbers, transcripts and recordings.`,
  },
  knowledge_manager: {
    name: 'Knowledge manager',
    blurb: (l) => `Adds and edits what HRVoice answers from. No ${lower(l.contact.many)} or calls.`,
  },
  agent_manager: {
    // Display only: the stored key stays agent_manager.
    name: 'Call setup manager',
    blurb: () => 'Sets up, tests and publishes the call, and reads its calls to tune it.',
  },
  administrator: { name: 'Administrator', blurb: () => 'Everything except billing and deleting the workspace.' },
  owner: { name: 'Owner', blurb: () => 'Everything, including billing and deleting the workspace.' },
};
const BUILT_IN_ORDER = Object.keys(BUILT_IN);

/** "custom_team_lead" reads "Team lead" when the API sends no name. */
function humanize(key: string): string {
  const words = key.replace(/^custom_/, '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unnamed access level';
}

/** The level's name: ours for built-in ones, the workspace's own for custom ones. */
export function accessName(key: string, apiName?: string | null): string {
  return BUILT_IN[key]?.name ?? (apiName?.trim() || humanize(key));
}

// The server's own names for the built-in levels (packages/permissions), for replies that carry a
// name but no key, such as the invite preview.
const SERVER_NAME_KEY: Record<string, string> = {
  Owner: 'owner',
  Administrator: 'administrator',
  'Agent Manager': 'agent_manager',
  'Knowledge Manager': 'knowledge_manager',
  'Recruiter / Operator': 'recruiter',
  Analyst: 'analyst',
  Viewer: 'viewer',
};

/** A level named by the server alone: ours for built-in ones, as given for custom ones. */
export function accessNameFromServer(name: string): string {
  return accessName(SERVER_NAME_KEY[name] ?? '', name);
}

/** One line on what the level allows. Custom levels show what their creator wrote, if anything. */
export function accessBlurb(key: string, apiDescription: string | null | undefined, labels: Labels): string {
  return BUILT_IN[key]?.blurb(labels) ?? apiDescription?.trim() ?? '';
}

/** Built-in levels for when the list can't be read (no permission to see levels, older backends). */
export const BUILT_IN_LEVELS: Role[] = Object.entries(BUILT_IN).map(([key, level]) => ({
  id: key,
  key,
  name: level.name,
  description: '',
  isSystem: true,
}));

/** Built-in levels least access first, then custom ones by name. */
export function sortLevels(roles: readonly Role[]): Role[] {
  const rank = (r: Role) => {
    const i = BUILT_IN_ORDER.indexOf(r.key);
    return i === -1 ? BUILT_IN_ORDER.length : i;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b) || accessName(a.key, a.name).localeCompare(accessName(b.key, b.name)));
}

export interface Granter {
  /** The active workspace's role key. */
  role: string;
  permissions: readonly string[];
}

/**
 * Can this person give out this level (invite with it, or move someone onto or off it)? Mirrors
 * the server: only an Owner hands out Owner; anyone else only what they hold themselves.
 */
export function canGrant(level: Pick<Role, 'key' | 'permissions'>, me: Granter): boolean {
  if (level.key === 'owner') return me.role === 'owner';
  if (me.role === 'owner') return true;
  // Older backends don't send a level's permissions: the server decides.
  return level.permissions?.every((p) => me.permissions.includes(p)) ?? true;
}

// Areas of the product that aren't built yet stay out of the editor (PRODUCT.md: no fake features).
const HIDDEN_GROUPS = new Set(['Workflows', 'Integrations', 'Billing']);
const GROUP_ORDER = ['Jobs', 'People', 'Calls', 'Agents', 'Knowledge', 'Analytics and usage', 'Team', 'Company', 'Activity log'];

// The API's labels, where they use words the product doesn't (roles, company, demo, conversations).
const LABEL: Record<string, string> = {
  'organization.read': 'See workspace settings',
  'organization.update': 'Edit workspace settings',
  'organization.delete': 'Delete the workspace',
  'roles.read': 'See access levels',
  'roles.assign': 'Change someone’s access level',
  'roles.manage': 'Create and edit access levels',
  'agents.test': 'Make test calls in the browser',
  'agents.read': 'See call setups',
  'agents.create': 'Create call setups',
  'agents.update': 'Edit call setups',
  'agents.delete': 'Delete call setups',
  'agents.deploy': 'Publish call setups',
  'agents.pause': 'Pause calls',
  'agents.archive': 'Archive call setups',
  'agents.sessions.read': 'See the calls',
  'agents.sessions.manage': 'Start and end calls',
};

export function permissionLabel(p: Pick<PermissionInfo, 'key' | 'label'>): string {
  return LABEL[p.key] ?? p.label;
}

export interface PermissionGroup {
  name: string;
  items: PermissionInfo[];
}

/** The catalogue as the editor shows it: areas in a recruiter's order, unbuilt areas left out. */
export function groupPermissions(catalogue: readonly PermissionInfo[], labels: Labels): PermissionGroup[] {
  const byGroup = new Map<string, PermissionInfo[]>();
  for (const p of catalogue) {
    if (HIDDEN_GROUPS.has(p.group)) continue;
    byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), p]);
  }
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  const name = (g: string) =>
    g === 'Jobs' ? labels.workItem.many : g === 'People' ? labels.contact.many : g === 'Company' ? 'Workspace' : g === 'Agents' ? 'Call setup' : g;
  return [...byGroup.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((g) => ({ name: name(g), items: byGroup.get(g) ?? [] }));
}

/** Permissions the editor never shows. Kept as they are when a level is saved. */
export function hiddenPermissions(catalogue: readonly PermissionInfo[]): Set<string> {
  return new Set(catalogue.filter((p) => HIDDEN_GROUPS.has(p.group)).map((p) => p.key));
}

/** What to send on save: the boxes ticked, plus whatever hidden permissions the level already had. */
export function permissionsToSave(
  ticked: ReadonlySet<string>,
  previous: readonly string[],
  hidden: ReadonlySet<string>,
): string[] {
  return [...new Set([...ticked, ...previous.filter((p) => hidden.has(p))])];
}
