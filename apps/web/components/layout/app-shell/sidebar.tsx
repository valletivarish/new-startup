'use client';

import Link from 'next/link';
import { useId, useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen, Sparkle } from 'lucide-react';
import type { Me } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrandLink } from '@/components/brand/logo-mark';
import { buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu, WorkspaceSwitcher } from './account';
import { gate, isActive, type NavItem } from './nav';
import { PLACEHOLDER, RAIL } from './parts';

/*
  'auto' is a rail from 768 to 1023px and full width from 1024px. Toggling picks the opposite
  of what is on screen. Remembered per browser; the server renders 'auto', so a saved choice
  lands one frame after hydration on a full page load (client navigations read it at once).
*/
type SidebarMode = 'auto' | 'expanded' | 'collapsed';

const MODE_KEY = 'app-shell.sidebar';
const listeners = new Set<() => void>();
let savedMode: SidebarMode | null = null;

function readMode(): SidebarMode {
  if (savedMode === null) {
    try {
      const value = window.localStorage.getItem(MODE_KEY);
      savedMode = value === 'expanded' || value === 'collapsed' ? value : 'auto';
    } catch {
      savedMode = 'auto';
    }
  }
  return savedMode;
}

function writeMode(next: SidebarMode) {
  savedMode = next;
  try {
    window.localStorage.setItem(MODE_KEY, next);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  listeners.forEach((notify) => notify());
}

function subscribeMode(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

const DESKTOP = '(min-width: 1024px)';
function subscribeDesktop(notify: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function NavRow({ item, active, rail }: { item: NavItem; active: boolean; rail: boolean }) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      // The rail's tooltip repeats the name, so it must not describe the link as well.
      aria-describedby={undefined}
      className={cn(
        'flex min-h-10 items-center gap-3 rounded-input px-3 text-label transition-colors [@media(pointer:coarse)]:min-h-11',
        RAIL.center,
        active ? 'bg-canvas font-medium text-text shadow-xs' : 'text-text-2 hover:bg-muted hover:text-text',
      )}
    >
      <Icon aria-hidden strokeWidth={1.5} className="size-[1.125rem] shrink-0" />
      <span className={cn('truncate', RAIL.srOnly)}>{item.label}</span>
    </Link>
  );
  return (
    <li>
      {rail ? (
        <Tooltip content={item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

function NavList({
  items,
  pathname,
  rail,
  labelledBy,
}: {
  items: (NavItem & { pending: boolean })[];
  pathname: string;
  rail: boolean;
  labelledBy?: string;
}) {
  return (
    <ul role="list" aria-labelledby={labelledBy} className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((item) =>
        item.pending ? (
          // Same geometry as a row, so nothing moves when permissions arrive.
          <li key={item.href} aria-hidden className={cn('flex h-10 items-center gap-3 px-3', RAIL.center)}>
            <span className={cn(PLACEHOLDER.onGround, 'size-[1.125rem] shrink-0 rounded-xs')} />
            <span className={cn(PLACEHOLDER.onGround, 'h-3 w-20 rounded-pill', RAIL.hidden)} />
          </li>
        ) : (
          <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} rail={rail} />
        ),
      )}
    </ul>
  );
}

/** D2's bottom card. Leaves short screens (under 800px tall) to the nav, and the rail. */
function InviteCard({ contactLabel }: { contactLabel: string }) {
  return (
    <div
      className={cn(
        'rounded-card-sm border border-border bg-canvas p-4 shadow-xs [@media(max-height:50rem)]:hidden',
        RAIL.hidden,
      )}
    >
      <span aria-hidden className="grid size-8 place-items-center rounded-xs bg-primary text-primary-foreground">
        <Sparkle fill="currentColor" strokeWidth={1.5} className="size-4" />
      </span>
      <p className="mb-0 mt-3 text-label font-semibold text-text">Invite your team</p>
      <p className="mb-0 mt-1 text-meta text-text-2">Bring in the people who review {contactLabel} with you.</p>
      <Link
        href="/settings?section=team&invite=1"
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3 shadow-xs')}
      >
        Invite people
      </Link>
    </div>
  );
}

/** The desktop and tablet sidebar, sitting directly on the ground (D2). Hidden on phones. */
export function Sidebar({
  profile,
  permissions,
  nav,
  pathname,
  contactLabel,
}: {
  profile: Me | null;
  /** undefined while unknown: gated rows wait as placeholders. null: only ungated rows. */
  permissions: readonly string[] | null | undefined;
  nav: { main: NavItem[]; workspace: NavItem[] };
  pathname: string;
  /** Plural contact noun from the use case, lower case ("candidates"). */
  contactLabel: string;
}) {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'auto' as const);
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);
  const rail = mode === 'collapsed' || (mode === 'auto' && !desktop);
  const groupId = useId();

  function toggle() {
    if (rail) writeMode(desktop ? 'auto' : 'expanded');
    else writeMode(desktop ? 'collapsed' : 'auto');
  }

  return (
    // One provider: once a rail tooltip is open, the next opens at once.
    <TooltipProvider>
      <aside
        aria-label="Sidebar"
        data-rail={mode === 'collapsed' ? 'on' : mode === 'expanded' ? 'off' : 'auto'}
        className="group/side hidden w-[15.5rem] shrink-0 flex-col px-4 pb-3 data-[rail=on]:w-[4.5rem] max-lg:data-[rail=auto]:w-[4.5rem] md:flex"
      >
        {/* 64px tall from the canvas's 12px top margin, so it lines up with the canvas header. */}
        <div className="mt-3 flex h-16 shrink-0 items-center justify-between gap-1 group-data-[rail=on]/side:h-auto group-data-[rail=on]/side:flex-col group-data-[rail=on]/side:py-2.5 max-lg:group-data-[rail=auto]/side:h-auto max-lg:group-data-[rail=auto]/side:flex-col max-lg:group-data-[rail=auto]/side:py-2.5">
          <BrandLink href="/dashboard" className="px-1" labelClassName={RAIL.srOnly} />
          <IconButton
            label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            variant="quiet"
            tooltipSide="right"
            onClick={toggle}
          >
            {rail ? <PanelLeftOpen strokeWidth={1.5} /> : <PanelLeftClose strokeWidth={1.5} />}
          </IconButton>
        </div>

        <div className="mt-1">
          <WorkspaceSwitcher profile={profile} rail={rail} />
        </div>

        {/* Negative margin plus padding: focus outlines are not clipped by the scroll box. */}
        <nav aria-label="Main" className="-mx-2 mt-4 min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <NavList items={gate(nav.main, permissions)} pathname={pathname} rail={rail} />
          <p id={groupId} className={cn('mb-1 mt-5 px-3 text-meta text-text-3', RAIL.srOnly)}>
            Workspace
          </p>
          <div aria-hidden className={cn('mx-auto my-3 h-px w-6 bg-border-input opacity-50', RAIL.only)} />
          <NavList items={gate(nav.workspace, permissions)} pathname={pathname} rail={rail} labelledBy={groupId} />
        </nav>

        <div className="mt-3 flex shrink-0 flex-col gap-2">
          {permissions?.includes('users.invite') ? <InviteCard contactLabel={contactLabel} /> : null}
          <UserMenu profile={profile} variant="row" rail={rail} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
