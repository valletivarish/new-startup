/** The Settings menu: one entry per real route under /settings, in display order. */

export interface SettingsContext {
  hasOrg: boolean;
  can: (permission: string) => boolean;
  /** A hiring system can be connected here, or one already is. */
  sourcesAvailable: boolean;
}

export interface SettingsSection {
  slug: string;
  label: string;
  /** Needs a workspace (everything except Your account). */
  permission?: string;
  visible?: (ctx: SettingsContext) => boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { slug: 'company', label: 'Company' },
  { slug: 'calling', label: 'Calling' },
  { slug: 'team', label: 'Team', visible: (c) => c.can('users.read') || c.can('users.invite') },
  { slug: 'sources', label: 'Sources', permission: 'integrations.read', visible: (c) => c.sourcesAvailable },
  { slug: 'activity', label: 'Activity', permission: 'audit.read' },
  { slug: 'account', label: 'Your account' },
  { slug: 'advanced', label: 'Advanced', permission: 'integrations.read' },
];

export function visibleSections(ctx: SettingsContext): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => {
    if (s.slug === 'account') return true;
    if (!ctx.hasOrg) return false;
    return (!s.permission || ctx.can(s.permission)) && (!s.visible || s.visible(ctx));
  });
}

/** Old /settings?section= values to the page that now holds them. */
export const LEGACY_SECTION: Record<string, string> = {
  workspace: 'company',
  team: 'team',
  access: 'team',
  activity: 'activity',
  connected: 'sources',
  developers: 'advanced',
  account: 'account',
};
