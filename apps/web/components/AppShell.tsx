'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Me } from '../lib/api';

const SIDEBAR_BG = '#0f172a';
const SIDEBAR_TEXT = '#94a3b8';
const SIDEBAR_ACTIVE_BG = '#1e293b';
const ACCENT = '#1e40af';

const navLink: React.CSSProperties = {
  display: 'block',
  padding: '10px 16px',
  fontSize: 14,
  color: SIDEBAR_TEXT,
  textDecoration: 'none',
  borderRadius: 6,
  marginBottom: 2,
};

interface NavItem {
  href: string;
  label: string;
  permission?: string;
  disabled?: boolean;
  disabledLabel?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/jobs', label: 'Jobs', permission: 'jobs.read' },
  { href: '/candidates', label: 'Candidates', permission: 'candidates.read' },
  { href: '/knowledge', label: 'Knowledge', permission: 'knowledge.read' },
  { href: '/tools', label: 'Tools' },
  {
    href: '/calls',
    label: 'Calls',
    disabled: true,
    disabledLabel: 'Coming soon',
  },
];

export function AppShell({
  profile,
  children,
}: {
  profile: Me | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const permissions = new Set(profile?.activeOrganization?.permissions ?? []);

  const can = (p?: string) => !p || permissions.has(p);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: SIDEBAR_BG,
          color: '#f8fafc',
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 8px 20px', borderBottom: '1px solid #334155' }}>
          <strong style={{ fontSize: 15, letterSpacing: '-0.02em' }}>
            ai voice agent
          </strong>
        </div>
        <nav aria-label="Main" style={{ marginTop: 16, flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            if (item.permission && !can(item.permission)) return null;

            if (item.disabled) {
              return (
                <span
                  key={item.label}
                  style={{
                    ...navLink,
                    opacity: 0.45,
                    cursor: 'not-allowed',
                  }}
                  title={item.disabledLabel}
                >
                  {item.label}
                  <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                    {item.disabledLabel}
                  </span>
                </span>
              );
            }

            const active =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...navLink,
                  background: active ? SIDEBAR_ACTIVE_BG : 'transparent',
                  color: active ? '#f8fafc' : SIDEBAR_TEXT,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div style={{ flex: 1, background: '#f6f7f6', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

export const shell: React.CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
  padding: 24,
};

export const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};

export const primaryBtn: React.CSSProperties = {
  background: ACCENT,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

export const STATUS_COLOR: Record<string, string> = {
  draft: '#8a6108',
  open: '#0d6e63',
  closed: '#545c56',
  new: '#8a6108',
  screening: '#1e40af',
  reviewed: '#0d6e63',
};
