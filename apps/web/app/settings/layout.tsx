'use client';

/**
 * Settings (spec 7.11, D2): one real route per part of the workspace, so each has its own link.
 * The menu is SETTINGS_SECTIONS filtered by what the person may use; a direct URL to a part
 * they can't use shows the "no access" state instead of the page.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { House, Lock } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ZOHO_STATUS_KEY } from '@/components/settings/connected-systems';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { SkeletonCard, useHeldLoading } from '@/components/ui/skeleton';
import { TAB_LIST, TAB_LIST_FLUSH, TAB_TRIGGER } from '@/components/ui/tabs';
import { getZohoStatus } from '@/lib/connected-systems';
import { toUserMessage } from '@/lib/errors';
import { useOnline } from '@/lib/use-online';
import { visibleSections } from './sections';
import { useSettings } from './use-settings';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { me, profile, hasOrg, can } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnline();
  const loading = useHeldLoading(me.isPending);
  // Sources exists only when a hiring system can be connected on this server (or one already is).
  const zoho = useQuery({
    queryKey: ZOHO_STATUS_KEY,
    queryFn: getZohoStatus,
    enabled: hasOrg && can('integrations.read'),
  });
  const sections = visibleSections({
    hasOrg,
    can,
    sourcesAvailable: Boolean(zoho.data?.available || zoho.data?.connection),
  });
  const current = pathname.split('/')[2] ?? '';
  // Wait for the status before judging /settings/sources, so a deep link doesn't flash "no access".
  const waitingOnSources = current === 'sources' && hasOrg && can('integrations.read') && zoho.isPending;

  // No workspace: /settings/company and the rest have nothing to show; Your account is theirs.
  const needsAccountPage = Boolean(profile) && !hasOrg && !sections.some((s) => s.slug === current);
  useEffect(() => {
    if (needsAccountPage) router.replace('/settings/account');
  }, [needsAccountPage, router]);

  let body: ReactNode = null;
  if (me.isError) {
    if (!online) body = <ErrorState variant="offline" onRetry={() => void me.refetch()} retrying={me.isFetching} />;
    else {
      const m = toUserMessage(me.error, 'load your settings');
      body = <ErrorState title={m.title} cause={m.detail} onRetry={() => void me.refetch()} retrying={me.isFetching} />;
    }
  } else if (!profile || loading || waitingOnSources || current === '' || needsAccountPage) {
    // Bare /settings is redirected to Company (next.config); never judge it "not shared".
    body = <SkeletonCard />;
  } else if (sections.some((s) => s.slug === current)) {
    body = children;
  } else if (hasOrg) {
    body = (
      <EmptyState
        icon={<Lock />}
        title="This part of Settings isn’t shared with you"
        description="Ask a workspace admin to give you access."
      />
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain>
        <PageHeader
          title="Settings"
          accent="for your workspace"
          description="Your workspace, the people in it and your own account."
        />
        {profile && !hasOrg ? (
          <Alert
            kind="info"
            title="You’re not in a workspace yet"
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/jobs">
                  <House aria-hidden strokeWidth={1.5} />
                  Go to Jobs
                </Link>
              </Button>
            }
          >
            Open or create one from Jobs. Your own account is below.
          </Alert>
        ) : null}
        {profile ? (
          <nav aria-label="Settings sections" className={cn(TAB_LIST, TAB_LIST_FLUSH, 'mb-2')}>
            {sections.map((s) => (
              <Link
                key={s.slug}
                href={`/settings/${s.slug}`}
                className={TAB_TRIGGER}
                data-state={s.slug === current ? 'active' : 'inactive'}
                aria-current={s.slug === current ? 'page' : undefined}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="pt-6">{body}</div>
      </PageMain>
    </AppShell>
  );
}
