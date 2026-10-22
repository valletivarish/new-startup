'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type PointerEvent } from 'react';
import { Pin, PanelLeftClose, PanelLeftOpen, Sparkle } from 'lucide-react';
import type { Me } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrandLink } from '@/components/brand/logo-mark';
import { buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu, WorkspaceSwitcher } from './account';
import { gate, isActive, type NavItem } from './nav';
import { NavIcon } from './nav-icons';
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

/**
 * A nav row. The icon sits at the same x in the rail and when the sidebar is open (left aligned
 * with fixed padding, never centred), so only the label moves: it fades and slides in beside the
 * icon, clipped by the row so it never wraps while the width animates.
 */
function NavRow({ item, active, index, ripple }: { item: NavItem; active: boolean; index: number; ripple: number }) {
  // The icon plays on each hover or keyboard focus, and in turn when the rail springs open.
  const [hovers, setHovers] = useState(0);
  const [fromRipple, setFromRipple] = useState(false);
  useEffect(() => {
    if (ripple > 0) setFromRipple(true);
  }, [ripple]);
  const play = () => {
    setFromRipple(false);
    setHovers((n) => n + 1);
  };
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onPointerEnter={play}
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && play()}
        className={cn(
          'group/row flex min-h-10 items-center gap-3 overflow-hidden rounded-input px-3 text-label transition-[background-color,color,box-shadow] duration-150 [@media(pointer:coarse)]:min-h-11',
          active
            ? 'bg-canvas font-medium text-text shadow-xs'
            : 'text-text-2 hover:bg-[color-mix(in_srgb,var(--canvas)_72%,transparent)] hover:text-text active:bg-canvas',
        )}
      >
        <NavIcon href={item.href} fallback={item.icon} play={hovers + ripple} delay={fromRipple ? index * 0.045 : 0} />
        <span className={cn('min-w-0 whitespace-nowrap', LABEL)}>{item.label}</span>
      </Link>
    </li>
  );
}

function NavList({
  items,
  pathname,
  ripple,
}: {
  items: (NavItem & { pending: boolean })[];
  pathname: string;
  /** Bumps each time the rail springs open, to ripple the icons. */
  ripple: number;
}) {
  return (
    <ul role="list" className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((item, i) =>
        item.pending ? (
          // Same geometry as a row, so nothing moves when permissions arrive.
          <li key={item.href} aria-hidden className="flex h-10 items-center gap-3 overflow-hidden px-3">
            <span className={cn(PLACEHOLDER.onGround, 'size-[1.125rem] shrink-0 rounded-xs')} />
            <span className={cn(PLACEHOLDER.onGround, 'h-3 w-20 shrink-0 rounded-pill', LABEL)} />
          </li>
        ) : (
          <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} index={i} ripple={ripple} />
        ),
      )}
    </ul>
  );
}

/**
 * A label beside an anchored icon. Hidden (still read out) in the rail; fades and slides in when
 * the rail opens on hover or focus, and back out as it closes.
 */
const LABEL = cn(
  'transition-[opacity,transform] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
  'group-data-[peek=open]/side:delay-75',
  'group-data-[rail=on]/side:-translate-x-2 group-data-[rail=on]/side:opacity-0',
  'max-lg:group-data-[rail=auto]/side:-translate-x-2 max-lg:group-data-[rail=auto]/side:opacity-0',
  'group-data-[peek=closing]/side:-translate-x-2 group-data-[peek=closing]/side:opacity-0 group-data-[peek=closing]/side:duration-150',
);

/** How long the rail takes to fold back; matches the panel's duration-[240ms] below. */
const CLOSE_MS = 240;

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
        href="/settings/team?invite=1"
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
  nav: { main: NavItem[] };
  pathname: string;
  /** Plural contact noun from the use case, lower case ("candidates"). */
  contactLabel: string;
}) {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'auto' as const);
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);
  const rail = mode === 'collapsed' || (mode === 'auto' && !desktop);

  // The rail opens over the page while a mouse is on it or focus is inside it: 'open', then
  // 'closing' while it folds back (labels stay laid out so they can fade), then 'closed'.
  const [peek, setPeek] = useState<'closed' | 'open' | 'closing'>('closed');
  const closeTimer = useRef<number | undefined>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  const [ripple, setRipple] = useState(0);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!rail) setPeek('closed');
  }, [rail]);

  function open() {
    if (!rail) return;
    window.clearTimeout(closeTimer.current);
    if (peek === 'closed') setRipple((n) => n + 1);
    setPeek('open');
  }
  function close() {
    if (peek !== 'open') return;
    // A menu opened from the rail lives in a portal; leaving for it must not fold the rail. Nor
    // does the mouse leaving while someone is tabbing through it.
    if (panel.current?.querySelector('[data-state="open"], :focus-visible')) return;
    setPeek('closing');
    closeTimer.current = window.setTimeout(() => setPeek('closed'), CLOSE_MS);
  }
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') open();
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') close();
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) open();
  };
  const onBlur = (event: FocusEvent) => {
    if (!panel.current?.contains(event.relatedTarget as Node | null)) close();
  };

  const peeking = rail && peek !== 'closed';
  const railAttr = peeking ? 'off' : mode === 'collapsed' ? 'on' : mode === 'expanded' ? 'off' : 'auto';

  function toggle() {
    setPeek('closed');
    if (rail) writeMode(desktop ? 'auto' : 'expanded');
    else writeMode(desktop ? 'collapsed' : 'auto');
  }

  return (
    // One provider: once a tooltip is open, the next opens at once.
    <TooltipProvider>
      {/* The aside keeps the layout width (rail or full); the panel inside can grow over the page. */}
      <aside
        aria-label="Sidebar"
        data-rail={railAttr}
        data-peek={peeking ? peek : undefined}
        className={cn(
          'group/side relative hidden w-[15.5rem] shrink-0 md:block',
          // CSS decides the auto rail, so the server's first paint is right at every width.
          mode === 'collapsed' && 'w-[4.5rem]',
          mode === 'auto' && 'max-lg:w-[4.5rem]',
        )}
      >
        <div
          ref={panel}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onFocus={onFocus}
          onBlur={onBlur}
          className={cn(
            'absolute inset-y-0 left-0 z-40 flex w-full flex-col overflow-hidden bg-ground px-4 pb-3',
            'transition-[width,box-shadow,border-radius] motion-reduce:transition-none',
            peek === 'open' && rail
              ? 'w-[15.5rem] rounded-r-card shadow-float duration-[420ms] ease-[var(--ease-spring)]'
              : 'duration-[240ms] ease-[var(--ease-out)]',
          )}
        >
          {/* 64px tall from the canvas's 12px top margin, so it lines up with the canvas header. */}
          <div className="mt-3 flex h-16 shrink-0 items-center justify-between gap-1 [@media(pointer:coarse)]:group-data-[rail=on]/side:h-auto [@media(pointer:coarse)]:group-data-[rail=on]/side:flex-col [@media(pointer:coarse)]:group-data-[rail=on]/side:py-2.5 [@media(pointer:coarse)]:max-lg:group-data-[rail=auto]/side:h-auto [@media(pointer:coarse)]:max-lg:group-data-[rail=auto]/side:flex-col [@media(pointer:coarse)]:max-lg:group-data-[rail=auto]/side:py-2.5">
            <BrandLink href="/jobs" className="px-1" labelClassName={RAIL.srOnly} />
            {/* With a mouse the rail opens on hover, so its toggle only shows once open ("Keep open"). */}
            <span className="shrink-0 [@media(pointer:fine)]:group-data-[rail=on]/side:hidden [@media(pointer:fine)]:max-lg:group-data-[rail=auto]/side:hidden">
              <IconButton
                label={peeking ? 'Keep sidebar open' : rail ? 'Expand sidebar' : 'Collapse sidebar'}
                variant="quiet"
                tooltipSide="right"
                onClick={toggle}
              >
                {peeking ? (
                  <Pin strokeWidth={1.5} />
                ) : rail ? (
                  <PanelLeftOpen strokeWidth={1.5} />
                ) : (
                  <PanelLeftClose strokeWidth={1.5} />
                )}
              </IconButton>
            </span>
          </div>

          <div className="mt-1">
            <WorkspaceSwitcher profile={profile} rail={rail && !peeking} />
          </div>

          {/* Negative margin plus padding: focus outlines are not clipped by the scroll box. */}
          <nav aria-label="Main" className="-mx-2 mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1">
            <NavList items={gate(nav.main, permissions)} pathname={pathname} ripple={ripple} />
          </nav>

          <div className="mt-3 flex shrink-0 flex-col gap-2">
            {permissions?.includes('users.invite') ? <InviteCard contactLabel={contactLabel} /> : null}
            <UserMenu profile={profile} variant="row" rail={rail && !peeking} />
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
