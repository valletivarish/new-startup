import { AudioLines, BriefcaseBusiness, ChartColumn, Inbox, IndianRupee, Settings, UsersRound, type LucideIcon } from 'lucide-react';
// Relative, so this stays importable under vitest (no @ alias there).
import type { UseCaseDefinition } from '../../../lib/use-case-definitions';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to people who hold this permission in the active workspace. */
  permission?: string;
}

/** The four places a person works from. Platform-owner pages live in the account menu (adminLinks). */
export function buildNav(labels: UseCaseDefinition['labels']): { main: NavItem[] } {
  return {
    main: [
      { href: '/jobs', label: labels.workItem.many, icon: BriefcaseBusiness },
      { href: '/people', label: 'People', icon: UsersRound, permission: 'candidates.read' },
      { href: '/reports', label: 'Reports', icon: ChartColumn, permission: 'analytics.read' },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  };
}

export const adminLinks: NavItem[] = [
  { href: '/admin/costs', label: 'Costs', icon: IndianRupee, permission: 'platform.admin' },
  { href: '/admin/support', label: 'Support inbox', icon: Inbox, permission: 'platform.admin' },
  { href: '/agents', label: 'Agents', icon: AudioLines, permission: 'platform.admin' },
];

/**
 * The items this person may see. `permissions` undefined means not known yet: gated items come
 * back `pending` and are drawn as placeholders, so the list never jumps. null means no workspace.
 */
export function gate<T extends { permission?: string }>(
  items: readonly T[],
  permissions: readonly string[] | null | undefined,
): (T & { pending: boolean })[] {
  return items.flatMap<T & { pending: boolean }>((item) => {
    if (!item.permission) return [{ ...item, pending: false }];
    if (permissions === undefined) return [{ ...item, pending: true }];
    return permissions?.includes(item.permission) ? [{ ...item, pending: false }] : [];
  });
}

/** Active on its own page and every page under it: Jobs is active on /jobs/abc/candidates. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
