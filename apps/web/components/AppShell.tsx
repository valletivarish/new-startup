'use client';

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Me } from '@/lib/api';
import { meQueryKey, useMe } from '@/lib/use-me';
import { useOnline } from '@/lib/use-online';
import { useUseCase } from '@/lib/use-cases';
import { Breadcrumb, type Crumb } from '@/components/ui/breadcrumb';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { openCommandMenu, searchTitle } from '@/components/layout/CommandMenu';
import { UserMenu } from '@/components/layout/app-shell/account';
import { MobileTabBar, MobileTopBar } from '@/components/layout/app-shell/mobile';
import { buildNav, isActive } from '@/components/layout/app-shell/nav';
import { Sidebar } from '@/components/layout/app-shell/sidebar';
import { HelpButton } from '@/components/support/help-panel';

const noSubscribe = () => () => {};
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export interface AppShellProps {
  /**
   * The signed-in person as the page loaded it. While it is null the shell uses the cached
   * useMe() answer, and draws placeholders until one arrives.
   */
  profile: Me | null;
  children: ReactNode;
  /**
   * Left of the canvas header (desktop and tablet). Defaults to the current section's name
   * ("Jobs"). Not a heading: the page keeps its own h1 in PageHeader.
   */
  title?: ReactNode;
  /** Replaces the title on desktop with a trail, e.g. [{ label: 'Jobs', href: '/jobs' }, { label: job.title }]. */
  breadcrumb?: Crumb[];
  /**
   * Compact header controls (an icon button or one small pill), in the canvas header and the
   * phone top bar. The page's main action belongs in its PageHeader.
   */
  actions?: ReactNode;
}

/**
 * The app frame (D2): the sidebar sits on the ground, the page scrolls inside a white inset
 * canvas with a 64px header. Phones get a top bar and a bottom tab bar instead of the sidebar.
 */
export function AppShell({ profile: pageProfile, children, title, breadcrumb, actions }: AppShellProps) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useMe();
  const profile = pageProfile ?? me.data ?? null;
  const online = useOnline();
  const { labels } = useUseCase();
  const nav = useMemo(() => buildNav(labels), [labels]);
  const apple = useSyncExternalStore(noSubscribe, isApple, () => true);

  // Pages still load their own profile. Keep the shared cache on it, so the command menu and the
  // next page's shell agree with this page.
  useEffect(() => {
    if (pageProfile) queryClient.setQueryData(meQueryKey, pageProfile);
  }, [pageProfile, queryClient]);

  // undefined while unknown (gated items wait as placeholders); null when there is no workspace
  // or the profile failed to load (only ungated items show).
  // `platform.admin` is not a workspace permission: it marks the platform owner (cost dashboard).
  const permissions = profile
    ? [
        ...(profile.activeOrganization?.permissions ?? []),
        ...(profile.isPlatformAdmin ? ['platform.admin'] : []),
      ]
    : me.isError
      ? null
      : undefined;
  const section = nav.main.find((item) => isActive(pathname, item.href))?.label;
  const heading = title ?? section;

  return (
    // Fixed: the canvas scrolls, never the document.
    <div data-app-shell className="fixed inset-0 flex flex-col bg-ground text-text md:flex-row">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[60] -translate-y-[200%] rounded-button bg-canvas px-4 py-2.5 text-label font-medium text-text shadow-float focus:translate-y-0"
      >
        Skip to content
      </a>

      <Sidebar
        profile={profile}
        permissions={permissions}
        nav={nav}
        pathname={pathname}
        contactLabel={labels.contact.many.toLowerCase()}
      />
      <MobileTopBar profile={profile} actions={actions} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:py-3 md:pr-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-canvas bg-canvas md:rounded-canvas md:shadow-card">
          <header className="hidden h-16 shrink-0 items-center gap-3 border-b border-border pl-6 pr-5 md:flex">
            <div className="min-w-0 flex-1">
              {breadcrumb?.length ? (
                <Breadcrumb items={breadcrumb} />
              ) : (
                <p className="m-0 truncate text-title font-medium text-text">{heading}</p>
              )}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            <button
              type="button"
              onClick={() => openCommandMenu()}
              aria-haspopup="dialog"
              aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
              className="flex h-10 w-[22rem] min-w-[11rem] shrink items-center gap-2.5 rounded-input bg-subtle pl-4 pr-1.5 text-left text-label text-text-3 transition-colors hover:bg-muted hover:text-text-2 [@media(pointer:coarse)]:h-11"
            >
              <Search aria-hidden strokeWidth={1.5} className="size-[1.125rem] shrink-0" />
              <span className="min-w-0 flex-1 truncate">{searchTitle(labels)}</span>
              <kbd
                aria-hidden
                className="hidden h-7 items-center rounded-xs bg-canvas px-2.5 font-sans text-caption font-medium text-text-2 shadow-xs lg:inline-flex"
              >
                {apple ? '⌘K' : 'Ctrl K'}
              </kbd>
            </button>
            {permissions?.includes('support.use') ? <HelpButton /> : null}
            <UserMenu profile={profile} variant="avatar" />
          </header>

          <OfflineBanner online={online} />

          <div
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
          >
            {children}
          </div>
        </div>
      </div>

      <MobileTabBar nav={nav} permissions={permissions} pathname={pathname} />
    </div>
  );
}
