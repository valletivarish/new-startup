import {
  AudioLines,
  BookOpen,
  BriefcaseBusiness,
  IndianRupee,
  ChartColumn,
  House,
  Phone,
  Settings,
  UsersRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
// Relative, so this stays importable under vitest (no @ alias there).
import type { UseCaseDefinition } from '../../../lib/use-case-definitions';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to people who hold this permission in the active workspace. */
  permission?: string;
}

/** The sidebar's two groups. Work item and contact words come from the use case (spec §9). */
export function buildNav(labels: UseCaseDefinition['labels']): { main: NavItem[]; workspace: NavItem[] } {
  return {
    main: [
      { href: '/dashboard', label: 'Home', icon: House },
      { href: '/jobs', label: labels.workItem.many, icon: BriefcaseBusiness, permission: 'jobs.read' },
      { href: '/candidates', label: labels.contact.many, icon: UsersRound, permission: 'candidates.read' },
      { href: '/calls', label: 'Calls', icon: Phone, permission: 'agents.sessions.read' },
    ],
    workspace: [
      { href: '/agents', label: 'Agents', icon: AudioLines, permission: 'agents.read' },
      { href: '/knowledge', label: 'Knowledge', icon: BookOpen, permission: 'knowledge.read' },
      { href: '/tools', label: 'Tools', icon: Wrench, permission: 'agents.read' },
      { href: '/analytics', label: 'Analytics', icon: ChartColumn, permission: 'analytics.read' },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/admin/costs', label: 'Costs', icon: IndianRupee, permission: 'platform.admin' },
    ],
  };
}

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
