'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import type { Me } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrandLink } from '@/components/brand/logo-mark';
import { IconButton } from '@/components/ui/icon-button';
import { openCommandMenu } from '@/components/layout/CommandMenu';
import { HelpButton } from '@/components/support/help-panel';
import { UserMenu } from './account';
import { gate, isActive, type NavItem } from './nav';
import { PLACEHOLDER } from './parts';

/**
 * Phones: the wordmark, search and the account menu, on the ground above the canvas. The page's
 * own h1 and the active tab say where you are, so no title repeats them here.
 */
export function MobileTopBar({ profile, actions }: { profile: Me | null; actions?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 pl-3 pr-2 md:hidden">
      <BrandLink href="/dashboard" className="mr-auto" />
      {actions}
      <IconButton label="Search" onClick={() => openCommandMenu()}>
        <Search strokeWidth={1.5} />
      </IconButton>
      {profile?.activeOrganization?.permissions.includes('support.use') ? <HelpButton /> : null}
      <UserMenu profile={profile} variant="avatar" />
    </header>
  );
}

const tab = (active: boolean) =>
  cn(
    'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-caption focus-visible:-outline-offset-2',
    active ? 'font-medium text-text' : 'text-text-3',
  );

function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span aria-hidden className={cn('grid h-7 w-12 place-items-center rounded-pill', active && 'bg-muted')}>
      <Icon strokeWidth={1.5} className="size-5" />
    </span>
  );
}

/** Phones: the four items as tabs. */
export function MobileTabBar({
  nav,
  permissions,
  pathname,
}: {
  nav: { main: NavItem[] };
  permissions: readonly string[] | null | undefined;
  pathname: string;
}) {
  return (
    <nav aria-label="Main" className="shrink-0 border-t border-border bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul role="list" className="m-0 flex list-none p-0">
        {gate(nav.main, permissions).map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              {item.pending ? (
                <span aria-hidden className={tab(false)}>
                  <span className={cn(PLACEHOLDER.onCanvas, 'h-7 w-12 rounded-pill')} />
                  <span className={cn(PLACEHOLDER.onCanvas, 'h-2.5 w-10 rounded-pill')} />
                </span>
              ) : (
                <Link href={item.href} aria-current={active ? 'page' : undefined} className={tab(active)}>
                  <TabIcon icon={item.icon} active={active} />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
