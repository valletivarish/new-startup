'use client';

import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Lock, Plus } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { hasJobDescription } from '@/components/jobs/setup';
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
import { StatusTag } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import { createJob, listAgents, type Job } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import {
  formatJobNextStep,
  formatJobPeopleSummary,
  hiringPeopleQueryKey,
  useHiringPeople,
  type JobFunnel,
} from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { useMe } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';

/*
  Jobs (D2): the page's one serif accent in the title, then every job as a row: who is on it,
  the next step, its status. A job that has its description opens on its candidates; one
  that doesn't opens on setup, where the description goes in.
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
        {jobs.data.jobs.length === 0 ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title={`No ${labels.workItem.many.toLowerCase()} yet`}
            description={`Create a ${labels.workItem.one.toLowerCase()}, add its description and the questions to ask. Then add ${labels.contact.many.toLowerCase()} and call them.`}
            action={createButton}
            className="rounded-card border border-border"
          />
        ) : (
          <JobList jobs={jobs.data.jobs} funnels={jobs.data.funnels} />
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
          description="The agent brings each job’s description and questions to every call."
          actions={createButton}
        />
        {body}
        {canCreate ? <CreateJobDialog open={creating} onOpenChange={setCreating} /> : null}
      </PageMain>
    </AppShell>
  );
}

function JobList({ jobs, funnels }: { jobs: Job[]; funnels: Record<string, JobFunnel> }) {
  const { labels } = useUseCase();
  const contact = { one: labels.contact.one.toLowerCase(), many: labels.contact.many.toLowerCase() };
  return (
    <ListRows
      aria-label={labels.workItem.many}
      columns="minmax(0,1.2fr) minmax(0,1.6fr) minmax(0,0.9fr) auto"
      header={
        <>
          <span>{labels.workItem.one}</span>
          <span>{labels.contact.many}</span>
          <span>Next step</span>
          <span>Status</span>
        </>
      }
    >
      {jobs.map((job) => {
        const described = hasJobDescription(job);
        const funnel = funnels[job.id];
        const questions = job.screeningQuestions?.length ?? 0;
        const created = formatWhen(job.createdAt);
        const meta = [
          questions > 0 ? `${questions} ${questions === 1 ? 'question' : 'questions'}` : null,
          created ? `Created ${created}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <ListRow key={job.id}>
            <ListRowPrimary
              title={job.title}
              meta={meta || undefined}
              href={described ? `/jobs/${toPublicId(job.id)}/candidates` : `/jobs/${toPublicId(job.id)}`}
            />
            {/* Unknown (no access to candidates, or a closed job) stays empty, never "No candidates yet". */}
            <ListCell className="max-md:hidden">{formatJobPeopleSummary(funnel, contact)}</ListCell>
            <ListCell className="text-text">{formatJobNextStep(described, funnel, contact)}</ListCell>
            <ListCell kind="tag">
              <StatusTag domain="job" value={job.status} />
            </ListCell>
          </ListRow>
        );
      })}
    </ListRows>
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
