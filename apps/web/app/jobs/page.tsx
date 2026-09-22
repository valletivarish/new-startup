'use client';

import { useCallback, useEffect, useState, type FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Briefcase, Plus } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogClose,
} from '../../components/ui/dialog';
import { Field, Input, Textarea } from '../../components/ui/input';
import { EmptyState, Notice, PageHeader, PageMain } from '../../components/ui/page';
import {
  DataList,
  DataListBody,
  DataListHeader,
  DataListMeta,
  DataListRow,
  DataListTitle,
} from '../../components/ui/list';
import { SkeletonPage, SkeletonRows } from '../../components/ui/skeleton';
import { loginPathForReturn } from '../../lib/auth-redirect';
import { formatWhen } from '../../lib/format';
import { toPublicId } from '../../lib/public-id';
import {
  ApiClientError,
  createJob,
  listAgents,
  me,
  type Agent,
  type Me,
} from '../../lib/api';

import { JOB_STATUS_LABEL, PIPELINE_STATUS_LABEL } from '../../lib/status-labels';
import {
  hiringPeopleQueryKey,
  useHiringPeople,
} from '../../lib/hiring-people';
import { useQueryClient } from '@tanstack/react-query';

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <AppShell profile={null}>
          <PageMain>
            <SkeletonPage rows={5} />
          </PageMain>
        </AppShell>
      }
    >
      <JobsPageInner />
    </Suspense>
  );
}

function JobsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'err'>('ok');
  const [authReady, setAuthReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(
    () => searchParams.get('create') === '1',
  );

  useEffect(() => {
    if (searchParams.get('create') === '1') setShowCreate(true);
  }, [searchParams]);

  const canJobs =
    profile?.activeOrganization?.permissions.includes('jobs.read') ?? false;
  const { data, isLoading, isError } = useHiringPeople(authReady && canJobs);
  const jobs = data?.jobs ?? [];
  const funnels = data?.funnels ?? {};

  const reload = useCallback(async () => {
    try {
      const p = await me();
      setProfile(p);
      setAuthReady(true);
      const agentsResult = await Promise.allSettled([listAgents()]);
      if (agentsResult[0]?.status === 'fulfilled') {
        const a = agentsResult[0].value;
        const published = a.agents.filter((ag) => ag.status === 'published');
        const hiring =
          published.length > 0
            ? published
            : a.agents.filter((ag) => ag.type === 'hiring');
        setAgents(hiring.length > 0 ? hiring : a.agents);
        setAgentId(
          (prev) =>
            prev ||
            hiring.find((ag) => ag.status === 'published')?.id ||
            hiring[0]?.id ||
            '',
        );
      } else {
        setAgents([]);
      }
      void queryClient.invalidateQueries({ queryKey: hiringPeopleQueryKey });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
      } else {
        setNoticeKind('err');
        setNotice('Could not load profile.');
        setAuthReady(true);
      }
    }
  }, [router, queryClient]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  const loading = !authReady || (canJobs && isLoading);
  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await createJob({
        title,
        description: description || undefined,
        agentId:
          agents.find((a) => a.id === agentId && a.status === 'published')
            ?.id ||
          agents.find((a) => a.status === 'published')?.id ||
          undefined,
      });
      setTitle('');
      setDescription('');
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: hiringPeopleQueryKey });
      router.push(`/jobs/${toPublicId(created.id)}`);
    } catch (e) {
      setNoticeKind('err');
      setNotice(
        e instanceof ApiClientError ? e.message : 'Could not create job.',
      );
    } finally {
      setCreating(false);
    }
  }

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain>
          {loading ? (
            <SkeletonPage rows={5} />
          ) : notice ? (
            <Notice kind="err">{notice}</Notice>
          ) : null}
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Jobs"
          description="Open a role, add people, run screens. One place for each job’s plan and candidates."
          actions={
            can('jobs.create') ? (
              <Button type="button" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Create job
              </Button>
            ) : null
          }
        />

        {notice ? (
          <Notice kind={noticeKind === 'err' ? 'err' : 'ok'}>{notice}</Notice>
        ) : isError ? (
          <Notice kind="err">Could not load jobs.</Notice>
        ) : null}

        {can('jobs.create') ? (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogContent
              className="top-[10%] max-h-[min(86vh,880px)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto p-5"
              aria-describedby={undefined}
            >
              <div className="pr-8">
                <h2 className="m-0 font-display text-lg font-semibold tracking-tight">
                  Create a job
                </h2>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                  Name the role. Next you’ll add the job description and
                  screening questions.
                </p>
              </div>
              <form onSubmit={onCreate} className="mt-4 grid gap-3">
                <Field label="Job title">
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Java Backend Developer"
                    required
                    minLength={1}
                    maxLength={200}
                    autoFocus
                  />
                </Field>
                <Field
                  label="Short note (optional)"
                  hint="For your team only — not the screening description."
                >
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Internal note…"
                    rows={3}
                    maxLength={5000}
                  />
                </Field>
                {agents.some((a) => a.status === 'published') ? (
                  <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                    Your published hiring voice will be linked automatically.
                    You can change it later in job setup.
                  </p>
                ) : (
                  <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                    You can create the job now. Add and publish a hiring voice
                    before calling candidates.{' '}
                    <Link href="/agents/new" className="text-[var(--accent)]">
                      Set up hiring voice
                    </Link>
                  </p>
                )}
                <div className="mt-1 flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button type="button" variant="ghost" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" size="sm" disabled={creating}>
                    {creating ? 'Creating…' : 'Create job'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}

        {loading ? (
          <SkeletonRows rows={5} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-5 w-5" aria-hidden />}
            title="No open roles yet"
            description="Create a job, add the description, then bring candidates in. Phone screens follow that role’s plan."
            action={
              can('jobs.create') ? (
                <Button type="button" onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Create job
                </Button>
              ) : null
            }
          />
        ) : (
          <DataList>
            <DataListHeader className="grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_minmax(7rem,auto)_auto]">
              <span>Job title</span>
              <span className="hidden sm:inline">Pipeline</span>
              <span className="hidden md:inline">Next</span>
              <span className="pr-1">Status</span>
            </DataListHeader>
            <DataListBody>
              {jobs.map((job) => {
                const when = formatWhen(job.createdAt);
                const funnel = funnels[job.id];
                const nextStep = !job.hasJdDocs
                  ? 'Add job description'
                  : !funnel || funnel.total === 0
                    ? 'Add people'
                    : funnel.toScreen > 0
                      ? `Screen ${funnel.toScreen}`
                      : funnel.inScreen > 0
                        ? `Review ${funnel.inScreen}`
                        : 'Open people';
                return (
                  <DataListRow
                    key={job.id}
                    href={
                      job.hasJdDocs
                        ? `/jobs/${toPublicId(job.id)}/candidates`
                        : `/jobs/${toPublicId(job.id)}`
                    }
                    className="grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_auto] md:grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_minmax(7rem,auto)_auto]"
                  >
                    <div className="min-w-0">
                      <DataListTitle>{job.title}</DataListTitle>
                      {when ? (
                        <DataListMeta>
                          <span>Created {when}</span>
                          <span className="mt-0.5 block text-[12px] font-medium text-[var(--accent)] sm:hidden">
                            {nextStep}
                          </span>
                        </DataListMeta>
                      ) : (
                        <DataListMeta className="sm:hidden">
                          <span className="text-[12px] font-medium text-[var(--accent)]">
                            {nextStep}
                          </span>
                        </DataListMeta>
                      )}
                    </div>
                    <span className="hidden text-sm tabular-nums text-[var(--foreground-tertiary)] sm:block">
                      {funnel && funnel.total > 0
                        ? `${funnel.total} · ${funnel.toScreen} ${PIPELINE_STATUS_LABEL.new.toLowerCase()} · ${funnel.inScreen} ${PIPELINE_STATUS_LABEL.screening.toLowerCase()} · ${funnel.reviewed} ${PIPELINE_STATUS_LABEL.reviewed.toLowerCase()}`
                        : 'No people yet'}
                    </span>
                    <span className="hidden text-sm font-medium text-[var(--accent)] md:block">
                      {nextStep}
                    </span>
                    <Badge tone={statusTone(job.status)}>
                      {JOB_STATUS_LABEL[job.status] ?? job.status}
                    </Badge>
                  </DataListRow>
                );
              })}
            </DataListBody>
          </DataList>
        )}
      </PageMain>
    </AppShell>
  );
}
