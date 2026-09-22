'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Briefcase,
  BarChart3,
  FileText,
  Home,
  Menu,
  Phone,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { myOrganizations, type Me } from '../lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { openCommandMenu } from '@/components/layout/CommandMenu';
import { BrandLink } from '@/components/brand/WaveMark';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

/** Primary — day-to-day hiring. */
const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/jobs', label: 'Jobs', icon: Briefcase, permission: 'jobs.read' },
  { href: '/candidates', label: 'People', icon: Users, permission: 'candidates.read' },
  { href: '/calls', label: 'Activity', icon: Phone },
];

/** Secondary — company tools (voice lives under Settings). */
const SECONDARY_NAV: NavItem[] = [
  {
    href: '/knowledge',
    label: 'Documents',
    icon: FileText,
    permission: 'knowledge.read',
  },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({
  profile,
  children,
}: {
  profile: Me | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const permissions = new Set(profile?.activeOrganization?.permissions ?? []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [shellReady, setShellReady] = useState(false);

  useEffect(() => {
    setShellReady(true);
  }, []);

  useEffect(() => {
    const orgId = profile?.activeOrganization?.id;
    if (!orgId) {
      setOrgName(null);
      return;
    }
    let cancelled = false;
    void myOrganizations()
      .then((res) => {
        if (cancelled) return;
        const match = res.organizations.find((o) => o.id === orgId);
        setOrgName(match?.name?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setOrgName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.activeOrganization?.id]);

  // Close mobile drawer on route change; lock body scroll while open.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const can = (p?: string) => !p || permissions.has(p);

  function NavLinks({
    items,
    onNavigate,
    compact = false,
  }: {
    items: NavItem[];
    onNavigate?: () => void;
    compact?: boolean;
  }) {
    return (
      <>
        {items.map((item) => {
          if (item.permission && !can(item.permission)) return null;

          const active =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex min-h-touch items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,opacity] duration-fast ease-out',
                compact ? 'py-2' : 'py-2.5',
                active
                  ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                  : 'text-[var(--foreground-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground-secondary)]',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </>
    );
  }

  const orgLabel =
    orgName ||
    profile?.user?.name?.trim() ||
    'Hiring workspace';

  return (
    <div className="flex min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#main-content"
        className="absolute left-4 top-4 z-50 -translate-y-[200%] rounded-md bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--foreground)] shadow-md outline-none ring-2 ring-[var(--focus-ring)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <aside
        className="hidden w-[15.5rem] shrink-0 flex-col border-r border-[var(--separator-subtle)] bg-[var(--surface)] md:flex"
        aria-label="Sidebar"
      >
        <div className="border-b border-[var(--separator-subtle)] px-4 py-5">
          <BrandLink
            href="/dashboard"
            markSize="md"
            className="text-[0.9375rem]"
          />
          <p className="mt-1 truncate text-xs text-[var(--foreground-tertiary)]">
            {orgLabel}
          </p>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 p-2">
          <NavLinks items={PRIMARY_NAV} />
        </nav>
        <div className="border-t border-[var(--separator-subtle)] p-2">
          <nav aria-label="Workspace" className="mb-1 flex flex-col gap-0.5">
            <NavLinks items={SECONDARY_NAV} compact />
          </nav>
          <div className="mt-1 flex items-center justify-between gap-2 px-1 py-1">
            <span className="text-xs text-[var(--foreground-muted)]">
              Appearance
            </span>
            <ThemeToggle />
          </div>
          <p className="mt-1 px-3 pb-1 text-[11px] text-[var(--foreground-muted)]">
            <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
            <span className="ml-1.5">to go anywhere</span>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="material sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[var(--separator-subtle)] px-4 py-3 md:hidden">
          <BrandLink
            href="/dashboard"
            markSize="md"
            className="min-w-0 text-[14px]"
            labelClassName="truncate"
          />
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Search"
              onClick={() => openCommandMenu()}
            >
              <Search className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-expanded={menuOpen}
              aria-controls="ava-mobile-nav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Menu className="h-4 w-4" aria-hidden />
              )}
              <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
            </Button>
          </div>
        </header>

        {/* Mobile drawer — overlay, not push-down */}
        <div
          className={cn(
            'fixed inset-0 z-50 md:hidden',
            menuOpen ? 'pointer-events-auto' : 'pointer-events-none',
          )}
          aria-hidden={!menuOpen}
          // `inert` differs between SSR and first client paint — apply after mount.
          {...(shellReady && !menuOpen ? { inert: true } : {})}
        >
          <button
            type="button"
            className={cn(
              'absolute inset-0 border-0 bg-[color-mix(in_srgb,var(--foreground)_28%,transparent)] transition-opacity duration-normal ease-out',
              menuOpen ? 'opacity-100' : 'opacity-0',
            )}
            aria-label="Close menu"
            tabIndex={menuOpen ? 0 : -1}
            onClick={() => setMenuOpen(false)}
          />
          <nav
            id="ava-mobile-nav"
            aria-label="Main"
            className={cn(
              'absolute inset-y-0 right-0 flex w-[min(18.5rem,88vw)] flex-col border-l border-[var(--separator-subtle)] bg-[var(--surface)] shadow-[var(--shadow-lg)] transition-transform duration-normal ease-out',
              menuOpen ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--separator-subtle)] px-4 py-3.5">
              <div className="min-w-0">
                <p className="m-0 truncate font-display text-sm font-semibold tracking-tight">
                  Menu
                </p>
                <p className="m-0 truncate text-[12px] text-[var(--foreground-tertiary)]">
                  {orgLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <NavLinks
                items={PRIMARY_NAV}
                compact
                onNavigate={() => setMenuOpen(false)}
              />
              <div className="my-2 border-t border-[var(--separator-subtle)]" />
              <NavLinks
                items={SECONDARY_NAV}
                compact
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
            <div className="flex flex-col gap-2 border-t border-[var(--separator-subtle)] px-4 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setMenuOpen(false);
                  openCommandMenu();
                }}
              >
                <Search className="h-4 w-4" aria-hidden />
                Search people &amp; jobs
              </Button>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--foreground-muted)]">
                  Appearance
                </span>
                <ThemeToggle />
              </div>
            </div>
          </nav>
        </div>

        <div
          id="main-content"
          className="surface-grain min-h-0 flex-1 overflow-auto bg-[var(--background)]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
