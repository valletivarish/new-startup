'use client';

/**
 * Home (spec 7.1, D2): a greeting with the person's first name, then what needs them, from
 * real counts. First run shows the three setup steps instead. Closes audit H4 to H9 and S1.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { firstNameOf, greetingFor } from '@/components/home/copy';
import { GettingStarted, WorkspaceSetup } from '@/components/home/first-run';
import { Queues } from '@/components/home/queues';
import { HomeBodySkeleton, HomeHeaderSkeleton } from '@/components/home/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { SkeletonGroup, useHeldLoading } from '@/components/ui/skeleton';
import type { Me } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { needsSetup, useHomeSnapshot } from '@/lib/hiring-people';
import { useMe } from '@/lib/use-me';
import { useOnline } from '@/lib/use-online';
import { useUseCase } from '@/lib/use-cases';

export default function HomePage() {
  const me = useMe();
  return (
    <AppShell profile={me.data ?? null}>
      <PageMain>
        <HomeContent me={me} />
      </PageMain>
    </AppShell>
  );
}

function HomeContent({ me }: { me: UseQueryResult<Me> }) {
  const loading = useHeldLoading(me.isPending);
  if (me.data && !loading) {
    return me.data.activeOrganization ? <Workspace profile={me.data} /> : <NoWorkspace profile={me.data} />;
  }
  if (me.isError) {
    return (
      <LoadError error={me.error} context="load your account" onRetry={() => void me.refetch()} retrying={me.isFetching} />
    );
  }
  if (me.fetchStatus === 'paused') return <ErrorState variant="offline" onRetry={() => void me.refetch()} />;
  return (
    <SkeletonGroup>
      <HomeHeaderSkeleton />
      <HomeBodySkeleton />
    </SkeletonGroup>
  );
}

/** "Good evening, Priya", the name in the page's one serif-italic accent. */
function Greeting({ profile, description, actions }: { profile: Me; description: ReactNode; actions?: ReactNode }) {
  const name = firstNameOf(profile.user.name);
  // Rendered only once the profile is in, which is always in the browser, so the hour is local.
  const greeting = greetingFor(new Date().getHours());
  return (
    <PageHeader
      title={name ? `${greeting},` : greeting}
      accent={name || undefined}
      description={description}
      actions={actions}
    />
  );
}

function LoadError({
  error,
  context,
  onRetry,
  retrying,
}: {
  error: unknown;
  context: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const online = useOnline();
  if (!online) return <ErrorState variant="offline" onRetry={onRetry} retrying={retrying} />;
  // The detail carries the support reference, so it isn't passed twice.
  const message = toUserMessage(error, context);
  return <ErrorState title={message.title} cause={message.detail} onRetry={onRetry} retrying={retrying} />;
}

function NoWorkspace({ profile }: { profile: Me }) {
  return (
    <>
      <Greeting profile={profile} description="Your work lives in a workspace. Open one to start." />
      <WorkspaceSetup />
    </>
  );
}

function Workspace({ profile }: { profile: Me }) {
  const { labels } = useUseCase();
  const permissions = profile.activeOrganization?.permissions ?? [];
  const can = (permission: string) => permissions.includes(permission);
  const home = useHomeSnapshot(profile);
  // Pending stays true while the query waits on permission; only a fetch in flight is loading.
  const loading = useHeldLoading(home.isPending && home.fetchStatus !== 'idle');
  const snapshot = loading ? undefined : home.data;
  const setup = snapshot ? needsSetup(snapshot) : false;
  const jobs = labels.workItem.many.toLowerCase();

  if (!can('jobs.read')) {
    return (
      <>
        <Greeting profile={profile} description={`${labels.workItem.many} in this workspace aren’t shared with you.`} />
        <EmptyState
          icon={<Lock />}
          title="Nothing here needs you yet"
          description={`Home lists calls and ${labels.contact.many.toLowerCase()} from your ${jobs}. Ask a workspace admin if you need access.`}
        />
      </>
    );
  }

  let body: ReactNode;
  if (snapshot) {
    body = setup ? <GettingStarted snapshot={snapshot} can={can} /> : <Queues snapshot={snapshot} can={can} />;
  } else if (home.isError) {
    body = <LoadError error={home.error} context="load Home" onRetry={() => void home.refetch()} retrying={home.isFetching} />;
  } else if (home.fetchStatus === 'paused') {
    body = <ErrorState variant="offline" onRetry={() => void home.refetch()} />;
  } else {
    body = (
      <SkeletonGroup>
        <HomeBodySkeleton />
      </SkeletonGroup>
    );
  }

  return (
    <>
      <Greeting
        profile={profile}
        description={
          setup
            ? 'Set up once, then the calls that need you land here.'
            : `Calls to review, calls to retry and ${labels.contact.many.toLowerCase()} still to call.`
        }
        actions={
          // First run has its own steps, so the page's one navy pill is the next step's, not this.
          can('jobs.create') && !setup ? (
            <Button asChild>
              <Link href="/jobs?create=1">
                <Plus aria-hidden strokeWidth={1.5} />
                Create {labels.workItem.one.toLowerCase()}
              </Link>
            </Button>
          ) : null
        }
      />
      {snapshot && home.isRefetchError ? (
        <Alert
          kind="warning"
          title="Couldn’t refresh Home"
          className="mb-4"
          action={
            <Button variant="secondary" size="sm" loading={home.isFetching} onClick={() => void home.refetch()}>
              Retry
            </Button>
          }
        >
          These numbers are from the last time it loaded.
        </Alert>
      ) : null}
      {body}
    </>
  );
}
