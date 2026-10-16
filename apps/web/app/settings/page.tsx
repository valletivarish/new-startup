'use client';

/**
 * Settings (spec 7.11, D2): one tab per part of the workspace, chosen in the URL
 * (?section=team, ?section=account; ?invite=1 opens the invite dialog), so the shell's
 * "Invite people" and "Your account" land in the right place. Tabs the person can't use
 * aren't shown. Closes audit T1 to T5 and A10.
 */

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { House } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { TeamSettings } from '@/components/TeamSettings';
import { organizationsQueryKey } from '@/components/layout/app-shell/account';
import { AccessLevels } from '@/components/settings/access-levels';
import { ActivityLog } from '@/components/settings/activity';
import { AccountSection, WorkspaceSection } from '@/components/settings/sections';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Skeleton, SkeletonCard, useHeldLoading } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { myOrganizations, type Me } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { useMe } from '@/lib/use-me';
import { useOnline } from '@/lib/use-online';

type Section = 'workspace' | 'team' | 'access' | 'activity' | 'account';

export default function SettingsPage() {
  const me = useMe();
  return (
    <AppShell profile={me.data ?? null}>
      <PageMain>
        <PageHeader
          title="Settings"
          accent="for your workspace"
          description="Your workspace, the people in it and your own account."
        />
        {/* useSearchParams needs a boundary; the skeleton stands in until it resolves. */}
        <Suspense fallback={<SettingsSkeleton />}>
          <SettingsBody me={me} />
        </Suspense>
      </PageMain>
    </AppShell>
  );
}

function SettingsSkeleton() {
  return (
    <div>
      <div aria-hidden className="mb-6 flex h-11 items-center gap-6 shadow-[inset_0_-1px_0_var(--border)]">
        {['w-20', 'w-12', 'w-24', 'w-16'].map((w) => (
          <Skeleton key={w} className={`h-3 ${w} rounded-pill`} />
        ))}
      </div>
      <SkeletonCard />
    </div>
  );
}

function SettingsBody({ me }: { me: UseQueryResult<Me> }) {
  const online = useOnline();
  const loading = useHeldLoading(me.isPending);
  if (me.isError) {
    if (!online) return <ErrorState variant="offline" onRetry={() => void me.refetch()} retrying={me.isFetching} />;
    const m = toUserMessage(me.error, 'load your settings');
    return <ErrorState title={m.title} cause={m.detail} onRetry={() => void me.refetch()} retrying={me.isFetching} />;
  }
  if (!me.data || loading) return <SettingsSkeleton />;
  return <SettingsTabs profile={me.data} />;
}

function SettingsTabs({ profile }: { profile: Me }) {
  const params = useSearchParams();
  const org = profile.activeOrganization;
  const can = (p: string) => org?.permissions.includes(p) ?? false;
  const orgs = useQuery({
    queryKey: organizationsQueryKey,
    queryFn: myOrganizations,
    enabled: Boolean(org),
    staleTime: 5 * 60_000,
  });
  const workspaceName = orgs.data?.organizations.find((o) => o.id === org?.id)?.name.trim() || null;

  const sections: { value: Section; label: string }[] = [
    ...(org ? [{ value: 'workspace' as const, label: 'Workspace' }] : []),
    ...(org && (can('users.read') || can('users.invite')) ? [{ value: 'team' as const, label: 'Team' }] : []),
    ...(org && can('roles.read') ? [{ value: 'access' as const, label: 'Access levels' }] : []),
    ...(org && can('audit.read') ? [{ value: 'activity' as const, label: 'Activity' }] : []),
    { value: 'account', label: 'Your account' },
  ];
  const requested = params.get('section');
  const section = sections.find((s) => s.value === requested)?.value ?? sections[0]?.value ?? 'account';

  // History API, not the router: the tab switches at once and Next keeps useSearchParams in step.
  const setParams = useCallback((next: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const clearInvite = useCallback(() => setParams({ invite: null }), [setParams]);

  // On a phone the tab row scrolls: keep the open tab in view (a link can land on the last one).
  const tabList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabList.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [section]);

  return (
    <>
      {!org ? (
        <Alert
          kind="info"
          title="You’re not in a workspace yet"
          className="mb-6"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard">
                <House aria-hidden strokeWidth={1.5} />
                Go to Home
              </Link>
            </Button>
          }
        >
          Open or create one from Home. Your own account is below.
        </Alert>
      ) : null}
      <Tabs value={section} onValueChange={(value) => setParams({ section: value, invite: null })}>
        <TabsList ref={tabList} aria-label="Settings sections" flush className="mb-2">
          {sections.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="workspace" className="pt-6">
          <WorkspaceSection profile={profile} />
        </TabsContent>
        <TabsContent value="team" className="pt-6">
          <TeamSettings
            profile={profile}
            workspaceName={workspaceName}
            inviteRequested={params.get('invite') === '1'}
            onInviteHandled={clearInvite}
          />
        </TabsContent>
        <TabsContent value="access" className="pt-6">
          <AccessLevels profile={profile} />
        </TabsContent>
        <TabsContent value="activity" className="pt-6">
          <ActivityLog />
        </TabsContent>
        <TabsContent value="account" className="pt-6">
          <AccountSection profile={profile} workspaceName={workspaceName} />
        </TabsContent>
      </Tabs>
    </>
  );
}
