'use client';

import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Lock, Plus } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { GettingStarted } from '@/components/home/first-run';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { SkeletonPage, SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { createJob, listAgents } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { hiringPeopleQueryKey, useHomeSnapshot, useHiringPeople } from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { useMe } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';
import { JobList } from './job-list';
import { NeedsYou } from './needs-you';

/*
  Jobs is home: what needs you first (three rows, then Show all), then every job as a row with
  who is on it, its status and one Next: line from the same readiness model as the job's banner.
  A new workspace sees the getting-started steps instead.
*/

export default function JobsPage() {
  return (
    // useSearchParams (?create=1 from Home) needs a Suspense boundary.
    <Suspense
      fallback={
        <AppShell profile={null}>
          <PageMain>
            <SkeletonPage rows={4} />
          </PageMain>
        </AppShell>
      }
    >
      <JobsPageInner />
    </Suspense>
  );
}

function JobsPageInner() {
  const me = useMe();
  const searchParams = useSearchParams();
  const { labels } = useUseCase();
  const [creating, setCreating] = useState(() => searchParams.get('create') === '1');

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreating(true);
  }, [searchParams]);

  const permissions = me.data?.activeOrganization?.permissions ?? [];
  const canRead = permissions.includes('jobs.read');
  const canCreate = permissions.includes('jobs.create');
  const jobs = useHiringPeople(canRead);
  const home = useHomeSnapshot(me.data);
  const can = (permission: string) => permissions.includes(permission);
  // Pending stays true while the query waits on permission; only a fetch in flight is loading.
  const loading = useHeldLoading(me.isPending || (jobs.isPending && jobs.fetchStatus !== 'idle'));

  const createButton = canCreate ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <Plus aria-hidden strokeWidth={1.5} />
      Create {labels.workItem.one.toLowerCase()}
    </Button>
  ) : null;

  let body: ReactNode = <SkeletonRows rows={4} />;
  if (me.isError) {
    const m = toUserMessage(me.error, 'load your account');
    body = <ErrorState title={m.title} cause={m.detail} onRetry={() => void me.refetch()} retrying={me.isFetching} />;
  } else if ((!me.data && me.fetchStatus === 'paused') || (!jobs.data && jobs.fetchStatus === 'paused')) {
    // Offline before anything loaded. With data on screen, the shell's offline banner says so.
    body = <ErrorState variant="offline" onRetry={() => void (me.data ? jobs.refetch() : me.refetch())} />;
  } else if (loading) {
    body = <SkeletonRows rows={4} />;
  } else if (!canRead) {
    body = (
      <EmptyState
        icon={<Lock />}
        title={`You can’t see ${labels.workItem.many.toLowerCase()} in this workspace yet`}
        description="Ask a workspace admin to give you access."
      />
    );
  } else if (jobs.data) {
    body = (
      <>
        {jobs.isRefetchError ? (
          <Alert
            kind="warning"
            title={`Couldn’t refresh ${labels.workItem.many.toLowerCase()}`}
            action={
              <Button variant="secondary" size="sm" loading={jobs.isFetching} onClick={() => void jobs.refetch()}>
                Retry
              </Button>
            }
          >
            This list is from the last time it loaded.
          </Alert>
        ) : null}
        {jobs.data.jobs.length === 0 && home.data ? (
          <GettingStarted snapshot={home.data} can={can} />
        ) : jobs.data.jobs.length === 0 ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title={`No ${labels.workItem.many.toLowerCase()} yet`}
            description={`Create a ${labels.workItem.one.toLowerCase()}, add its description and the questions to ask. Then add ${labels.contact.many.toLowerCase()} and call them.`}
            action={createButton}
            className="rounded-card border border-border"
          />
        ) : (
          <>
            {home.data ? <NeedsYou snapshot={home.data} can={can} /> : null}
            <JobList jobs={jobs.data.jobs} funnels={jobs.data.funnels} />
          </>
        )}
      </>
    );
  } else if (jobs.isError) {
    const m = toUserMessage(jobs.error, `load ${labels.workItem.many.toLowerCase()}`);
    body = <ErrorState title={m.title} cause={m.detail} onRetry={() => void jobs.refetch()} retrying={jobs.isFetching} />;
  }

  return (
    <AppShell profile={me.data ?? null}>
      <PageMain>
        <PageHeader
          title={labels.workItem.many}
          accent="you’re hiring for"
          description="Add a job and the people for it. HRVoice phones them, and you decide who moves forward."
          actions={createButton}
        />
        {body}
        {canCreate ? <CreateJobDialog open={creating} onOpenChange={setCreating} /> : null}
      </PageMain>
    </AppShell>
  );
}

/** Title only: the description, questions and agent are the next page's steps. */
function CreateJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { labels } = useUseCase();
  const agents = useQuery({ queryKey: ['agents', 'for-new-job'], queryFn: listAgents, enabled: open });
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The first live agent makes the calls; it can be changed in setup.
  const live = agents.data?.agents.find((a) => a.status === 'published');
  const job = labels.workItem.one.toLowerCase();

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError(`Give the ${job} a title.`);
      return;
    }
    setBusy(true);
    setTitleError(null);
    setFormError(null);
    try {
      const created = await createJob({ title: title.trim(), agentId: live?.id });
      void queryClient.invalidateQueries({ queryKey: hiringPeopleQueryKey });
      setTitle('');
      onOpenChange(false);
      router.push(`/jobs/${toPublicId(created.id)}`);
    } catch (e) {
      const m = toUserMessage(e, `create the ${job}`);
      const field = m.fieldErrors?.find((f) => f.field === 'title')?.message;
      if (field) setTitleError(field);
      else setFormError(messageText(m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange(next))}>
      <DialogContent hideClose={busy}>
        <DialogHeader>
          <DialogTitle>Create a {job}</DialogTitle>
          <DialogDescription>
            Name it. Next you’ll add the description and the questions the agent asks.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onCreate} noValidate className="grid gap-5">
          <Field label={`${labels.workItem.one} title`} error={titleError}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="For example, Warehouse supervisor"
              maxLength={200}
              autoComplete="off"
              autoFocus
            />
          </Field>
          {agents.data ? (
            <p className="m-0 text-meta text-text-2">
              {live ? (
                <>
                  <span className="font-medium text-text">{live.name}</span> will make the calls. You can change
                  the agent in setup.
                </>
              ) : agents.data.agents.length > 0 ? (
                `Your AI hiring agent isn’t live yet. You can create the ${job} now and publish the agent before calling.`
              ) : (
                <>
                  You’ll need an AI hiring agent before calling.{' '}
                  <Link href="/agents/new" className="font-medium text-accent underline underline-offset-4">
                    Set up the agent
                  </Link>
                </>
              )}
            </p>
          ) : null}
          {formError ? <Alert kind="error">{formError}</Alert> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Create {job}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
