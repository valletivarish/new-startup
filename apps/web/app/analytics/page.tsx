'use client';

/**
 * Analytics: what the agent's calls added up to this month or last, and where candidates are
 * now. Every number is counted from the workspace's own call and candidate lists; nothing is
 * estimated. A number that didn't load is shown as missing, never as 0, and the call list's
 * latest-50 limit is said out loud wherever it cuts a period short.
 */

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { CircleCheck, Lock, PhoneMissed, Plus } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { DayChart, ShareBars, StageBars, type StageCounts } from '@/components/analytics/charts';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonGroup, useHeldLoading } from '@/components/ui/skeleton';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import { StatusBadge } from '@/components/ui/state-tag';
import { listJobCandidates, listJobs, listVoiceSessions, type Job, type Me, type VoiceSession } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { toPublicId } from '@/lib/public-id';
import { getStateMeta, JOB_STATUS_LABEL } from '@/lib/status-labels';
import { useMe } from '@/lib/use-me';
import { useOnline } from '@/lib/use-online';
import { useUseCase } from '@/lib/use-cases';
import {
  buildWorkspaceUsage,
  callOutcomes,
  callsByDay,
  inPeriod,
  loadedFrom,
  monthPeriod,
  OPEN_PLAN_LIMITS,
  SESSION_LIST_LIMIT,
} from '@/lib/usage';

const CARD = 'rounded-card border border-border bg-canvas p-5 sm:p-6';
const UTC_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
/** StatusTag's words for a call that didn't connect, reason unknown. */
const GENERIC_MISS = getStateMeta('call', 'failed').label;

interface AnalyticsData {
  /** null: this person can't see calls. */
  sessions: VoiceSession[] | null;
  /** null: this person can't see jobs. */
  jobs: Job[] | null;
  /** Candidate totals per job id. null: this person can't see candidates. */
  stages: Record<string, StageCounts> | null;
}

/** The same lists as before (calls, jobs, one page of each job's candidates for its totals), skipping what the person can't see. */
async function fetchAnalytics(can: (permission: string) => boolean): Promise<AnalyticsData> {
  const [sessions, jobs] = await Promise.all([
    can('agents.sessions.read') ? listVoiceSessions().then((res) => res.sessions) : null,
    can('jobs.read') ? listJobs().then((res) => res.jobs) : null,
  ]);
  const stages =
    jobs && can('candidates.read')
      ? Object.fromEntries(
          await Promise.all(
            jobs.map(async (job) => [job.id, (await listJobCandidates(job.id, { limit: 1 })).totals] as const),
          ),
        )
      : null;
  return { sessions, jobs, stages };
}

export default function AnalyticsPage() {
  const me = useMe();
  return (
    <AppShell profile={me.data ?? null}>
      <PageMain>
        <AnalyticsContent me={me} />
      </PageMain>
    </AppShell>
  );
}

const TITLE = { title: 'Analytics', accent: 'from real calls' } as const;

function AnalyticsContent({ me }: { me: UseQueryResult<Me> }) {
  const loading = useHeldLoading(me.isPending);
  if (me.data && !loading) {
    const permissions = me.data.activeOrganization?.permissions ?? null;
    if (!permissions) {
      return (
        <>
          <PageHeader {...TITLE} />
          <EmptyState
            icon={<Lock />}
            title="Open a workspace first"
            description="Analytics counts the calls in a workspace. Choose one on Home."
            action={
              <Button asChild variant="secondary">
                <Link href="/dashboard">Go to Home</Link>
              </Button>
            }
          />
        </>
      );
    }
    if (!permissions.includes('analytics.read')) {
      return (
        <>
          <PageHeader {...TITLE} />
          <EmptyState
            icon={<Lock />}
            title="Analytics isn’t shared with you"
            description="Ask a workspace admin to add you to the people who can see it."
          />
        </>
      );
    }
    return <Workspace orgId={me.data.activeOrganization?.id ?? ''} permissions={permissions} />;
  }
  if (me.isError) {
    return (
      <>
        <PageHeader {...TITLE} />
        <LoadError error={me.error} context="load your account" onRetry={() => void me.refetch()} retrying={me.isFetching} />
      </>
    );
  }
  return <AnalyticsSkeleton />;
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
  const message = toUserMessage(error, context);
  return <ErrorState title={message.title} cause={message.detail} onRetry={onRetry} retrying={retrying} />;
}

type PeriodKey = 'this' | 'last';

function Workspace({ orgId, permissions }: { orgId: string; permissions: string[] }) {
  const { labels } = useUseCase();
  const [periodKey, setPeriodKey] = useState<PeriodKey>('this');
  const [jobFilter, setJobFilter] = useState('all');
  const query = useQuery({
    queryKey: ['analytics', orgId],
    queryFn: () => fetchAnalytics((permission) => permissions.includes(permission)),
  });
  const loading = useHeldLoading(query.isPending);
  const period = useMemo(() => monthPeriod(periodKey === 'this' ? 0 : -1), [periodKey]);
  const data = loading ? undefined : query.data;
  const jobs = data?.jobs ?? null;
  const job = jobFilter === 'all' ? null : (jobs?.find((j) => j.id === jobFilter) ?? null);
  const month = period.label.split(' ')[0] ?? period.label;

  const header = (
    <PageHeader
      {...TITLE}
      // The filters need the room: beside the title from xl, under it before that.
      className="md:flex-col md:items-start xl:flex-row xl:items-center"
      description={`Calls the agent made in ${period.label}${job ? ` for ${job.title}` : ''}, and where your ${labels.contact.many.toLowerCase()} are now.`}
      actions={
        data ? (
          <>
            <Segmented<PeriodKey>
              label="Month"
              value={periodKey}
              onValueChange={setPeriodKey}
              options={[
                { value: 'this', label: 'This month' },
                { value: 'last', label: 'Last month' },
              ]}
            />
            {jobs && jobs.length > 0 ? (
              <Select
                aria-label={`Show one ${labels.workItem.one.toLowerCase()}`}
                value={job ? job.id : 'all'}
                onChange={(event) => setJobFilter(event.target.value)}
                className="w-full sm:w-60"
              >
                <option value="all">All {labels.workItem.many.toLowerCase()}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        ) : null
      }
    />
  );

  if (!data) {
    if (query.isError || query.fetchStatus === 'paused') {
      return (
        <>
          <PageHeader {...TITLE} />
          {query.isError ? (
            <LoadError error={query.error} context="load analytics" onRetry={() => void query.refetch()} retrying={query.isFetching} />
          ) : (
            <ErrorState variant="offline" onRetry={() => void query.refetch()} />
          )}
        </>
      );
    }
    return <AnalyticsSkeleton />;
  }

  return (
    <>
      {header}
      {query.isRefetchError ? (
        <Alert
          kind="warning"
          title="Couldn’t refresh Analytics"
          action={
            <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        >
          These numbers are from the last time it loaded.
        </Alert>
      ) : null}
      <Report data={data} period={period} month={month} job={job} />
    </>
  );
}

function Report({
  data,
  period,
  month,
  job,
}: {
  data: AnalyticsData;
  period: ReturnType<typeof monthPeriod>;
  month: string;
  job: Job | null;
}) {
  const { labels, stages } = useUseCase();
  const contacts = labels.contact.many.toLowerCase();
  const { sessions, jobs } = data;
  const from = sessions ? loadedFrom(sessions) : null;
  const scoped = (sessions ?? []).filter((s) => (job ? s.jobId === job.id : true) && inPeriod(s.startedAt, period));
  const outcomes = callOutcomes(scoped);
  const days = callsByDay(scoped, period, { from });
  const usage = buildWorkspaceUsage({
    jobs: jobs ?? [],
    peopleByJob: {},
    sessions: sessions ?? [],
    now: period.start,
    limits: OPEN_PLAN_LIMITS,
  });
  const minutes = job
    ? (usage.jobs.find((row) => row.jobId === job.id)?.minutes ?? 0)
    : (usage.meters.find((meter) => meter.key === 'minutes')?.used ?? 0);
  // The list holds only the latest calls: say so when that cuts this month short.
  const partial = from !== null && from > period.start.getTime();
  const noneLoaded = from !== null && from >= period.end.getTime();
  const since = from === null ? '' : new Date(from).toLocaleDateString('en-IN', UTC_DAY);
  const showOutcomes = Boolean(sessions) && outcomes.total > 0;
  const showStages = Boolean(jobs?.length);

  if ((jobs?.length ?? 0) === 0 && (sessions?.length ?? 0) === 0) {
    return (
      <EmptyState
        agent="idle"
        title="Nothing to count yet"
        description={`Create a ${labels.workItem.one.toLowerCase()}, add ${contacts} and let the agent call them. Analytics fills in from those calls.`}
        action={
          jobs ? (
            <Button asChild>
              <Link href="/jobs?create=1">
                <Plus aria-hidden strokeWidth={1.5} />
                Create {labels.workItem.one.toLowerCase()}
              </Link>
            </Button>
          ) : null
        }
        className="rounded-card border border-border bg-canvas py-16"
      />
    );
  }

  return (
    <>
      {partial && !noneLoaded ? (
        <Alert kind="info" title={`Only the latest ${SESSION_LIST_LIMIT} calls are counted`}>
          Calls before {since} aren’t loaded, so {month}’s numbers may be higher.
        </Alert>
      ) : null}

      <section aria-labelledby="analytics-calls" className={CARD}>
        <h2 id="analytics-calls" className="m-0 text-title font-semibold text-text">
          Calls in {month}
        </h2>
        {!sessions ? (
          <EmptyState
            headingLevel={3}
            icon={<Lock />}
            title="Calls aren’t shared with you"
            description="Ask a workspace admin to add you to the people who can see calls."
            className="py-10"
          />
        ) : outcomes.total === 0 ? (
          <EmptyState
            headingLevel={3}
            agent="idle"
            title={noneLoaded ? `${month}’s calls aren’t loaded` : `No calls in ${month}`}
            description={
              noneLoaded
                ? `Only the latest ${SESSION_LIST_LIMIT} calls load here, and they all came after ${month}.`
                : 'Calls the agent places, on the phone or as a test in your browser, show up here by day.'
            }
            className="py-10"
          />
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <p className="m-0 flex items-baseline gap-2.5">
                {/* The page's lead number: proportional figures, the same sans, like Home's. */}
                <span className="text-[3.5rem] font-semibold leading-none tracking-[-0.045em] text-text">{outcomes.total}</span>
                <span className="text-section font-medium text-text-2">
                  {outcomes.total === 1 ? 'call' : 'calls'}
                  {partial ? <span className="text-label font-normal text-text-3"> at least</span> : null}
                </span>
              </p>
              <dl className="m-0 grid grid-cols-3 gap-x-6 sm:gap-x-10">
                <Figure label="Connected" value={outcomes.connected} note={`${Math.round((outcomes.connected / outcomes.total) * 100)}% of calls`} />
                <Figure label="Didn’t connect" value={outcomes.notConnected} />
                <Figure
                  label="Minutes"
                  value={minutes}
                  note={
                    <>
                      Rounded up<span className="max-sm:hidden"> per call</span>
                    </>
                  }
                />
              </dl>
            </div>
            <div className="mt-8">
              <DayChart days={days} loadedFrom={from} />
            </div>
          </>
        )}
      </section>

      {showOutcomes || showStages ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {showOutcomes ? <Outcomes outcomes={outcomes} /> : null}
          {showStages ? (
            <section aria-labelledby="analytics-stages" className={cn(CARD, !showOutcomes && 'xl:col-span-2')}>
            <CardTitle id="analytics-stages" title={`Where ${contacts} are now`}>
              Today’s stage on each {labels.workItem.one.toLowerCase()}, whenever they were added.
            </CardTitle>
              {data.stages ? (
                <StageBars
                  rows={(job ? [job] : (jobs ?? [])).map((j) => ({
                    id: j.id,
                    title: j.title,
                    counts: data.stages?.[j.id] ?? { all: 0, new: 0, screening: 0, reviewed: 0 },
                  }))}
                  stages={stages}
                  emptyLabel={`No ${contacts} yet`}
                />
              ) : (
                <p className="m-0 text-text-2">
                  {labels.contact.many} aren’t shared with you. Ask a workspace admin to add you to the people who can see them.
                </p>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {jobs && (jobs.length > 0 || (!job && usage.unassigned.screens > 0)) ? (
        <ByJob
          usage={usage}
          jobs={job ? [job] : jobs}
          stages={data.stages}
          showTests={!job}
          // Calls for a month the list never reached are unknown, not 0: leave their columns out.
          showCalls={Boolean(sessions) && !noneLoaded}
          month={month}
        />
      ) : null}
    </>
  );
}

function Figure({ label, value, note }: { label: string; value: number; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-text-3">{label}</dt>
      <dd className="m-0 mt-1 text-subpage text-text">{value}</dd>
      {note ? <dd className="m-0 mt-0.5 text-caption text-text-3">{note}</dd> : null}
    </div>
  );
}

function CardTitle({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 id={id} className="m-0 text-title font-semibold text-text">
        {title}
      </h2>
      {children ? <p className="mb-0 mt-1 text-meta text-text-3">{children}</p> : null}
    </div>
  );
}

function Outcomes({ outcomes }: { outcomes: ReturnType<typeof callOutcomes> }) {
  return (
    <section aria-labelledby="analytics-outcomes" className={CARD}>
      <CardTitle id="analytics-outcomes" title="How calls ended">
        {outcomes.total === 1 ? 'Each bar is its share of the 1 call.' : `Each bar is its share of all ${outcomes.total} calls.`}
      </CardTitle>
      <ShareBars
        label="How calls ended"
        total={outcomes.total}
        rows={[
          {
            key: 'connected',
            label: (
              <StatusBadge tone="success" icon={CircleCheck}>
                Connected
              </StatusBadge>
            ),
            count: outcomes.connected,
          },
          {
            key: 'not-connected',
            label: (
              <StatusBadge tone="danger" icon={PhoneMissed}>
                Didn’t connect
              </StatusBadge>
            ),
            count: outcomes.notConnected,
          },
          ...(outcomes.inProgress > 0
            ? [
                {
                  key: 'in-progress',
                  label: (
                    <StatusBadge tone="info" icon="live">
                      In progress
                    </StatusBadge>
                  ),
                  count: outcomes.inProgress,
                },
              ]
            : []),
        ]}
      />
      {/* Only once some call has a reason of its own: a list of "other" alone says nothing. */}
      {outcomes.reasons.some((reason) => reason.label !== GENERIC_MISS) ? (
        <>
          <h3 className="mb-3 mt-7 text-label font-semibold text-text">Why calls didn’t connect</h3>
          <ShareBars
            label="Why calls didn’t connect"
            total={outcomes.notConnected}
            // Most first, "other" last whatever its count.
            rows={[...outcomes.reasons]
              .sort((a, b) => Number(a.label === GENERIC_MISS) - Number(b.label === GENERIC_MISS))
              .map((reason) => ({
              key: reason.key,
              label: (
                <span className="text-text-2">
                  {reason.label === GENERIC_MISS ? 'Other or not recorded' : reason.label}
                </span>
              ),
              count: reason.count,
            }))}
          />
        </>
      ) : null}
    </section>
  );
}

interface JobRow {
  id: string;
  title: string;
  meta: string;
  href?: string;
  /** One value per column after the name; '' where a count doesn't apply. */
  cells: (number | '')[];
  /** The same counts as one line, for phones. */
  phone: string;
}

const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ByJob({
  usage,
  jobs,
  stages,
  showTests,
  showCalls,
  month,
}: {
  usage: ReturnType<typeof buildWorkspaceUsage>;
  jobs: Job[];
  stages: Record<string, StageCounts> | null;
  showTests: boolean;
  showCalls: boolean;
  month: string;
}) {
  const { labels } = useUseCase();
  const work = labels.workItem.one.toLowerCase();
  const contact = { one: labels.contact.one.toLowerCase(), many: labels.contact.many.toLowerCase() };
  const heads = [...(stages ? [labels.contact.many] : []), ...(showCalls ? ['Calls', 'Minutes', 'Didn’t connect'] : [])];
  if (heads.length === 0) return null;

  const callCells = (use: { screens: number; minutes: number; failed: number } | undefined) =>
    showCalls ? [use?.screens ?? 0, use?.minutes ?? 0, use?.failed ?? 0] : [];
  const callLine = (use: { screens: number; minutes: number; failed: number } | undefined) =>
    showCalls
      ? [
          countOf(use?.screens ?? 0, 'call', 'calls'),
          `${use?.minutes ?? 0} min`,
          ...(use?.failed ? [`${use.failed} didn’t connect`] : []),
        ]
      : [];

  const rows: JobRow[] = jobs.map((j) => {
    const use = usage.jobs.find((row) => row.jobId === j.id);
    const people = stages?.[j.id]?.all;
    return {
      id: j.id,
      title: j.title,
      meta: JOB_STATUS_LABEL[j.status] ?? 'Unknown',
      href: `/jobs/${toPublicId(j.id)}/candidates`,
      cells: [...(stages ? [people ?? ('' as const)] : []), ...callCells(use)],
      phone: [...(people === undefined ? [] : [countOf(people, contact.one, contact.many)]), ...callLine(use)].join(' · '),
    };
  });
  if (showTests && showCalls && usage.unassigned.screens > 0) {
    rows.push({
      id: 'tests',
      title: 'Test calls in your browser',
      meta: `Not on a ${work}`,
      cells: [...(stages ? ['' as const] : []), ...callCells(usage.unassigned)],
      phone: callLine(usage.unassigned).join(' · '),
    });
  }

  return (
    <section aria-labelledby="analytics-by-job">
      <div className="mb-3">
        <h2 id="analytics-by-job" className="m-0 text-section text-text">
          By {work}
        </h2>
        <p className="mb-0 mt-1 text-text-2">
          {[
            showCalls ? `Calls, minutes and calls that didn’t connect in ${month}.` : null,
            stages ? `${labels.contact.many} is everyone on the ${work} today.` : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      </div>
      <ListRows
        aria-label={`By ${work}`}
        columns={`minmax(0,1fr) repeat(${heads.length}, minmax(6rem, auto))`}
        header={
          <>
            <span>{labels.workItem.one}</span>
            {heads.map((head) => (
              <span key={head} className="text-right">
                {head}
              </span>
            ))}
          </>
        }
      >
        {rows.map((row) => (
          <ListRow key={row.id}>
            <ListRowPrimary title={row.title} meta={row.meta} href={row.href} />
            {row.cells.map((value, index) => (
              <ListCell key={heads[index]} className="text-right tabular-nums text-text max-md:hidden">
                {value}
              </ListCell>
            ))}
            {row.phone ? <ListCell className="md:hidden">{row.phone}</ListCell> : null}
          </ListRow>
        ))}
      </ListRows>
    </section>
  );
}

/** The header, the calls card with its chart, two cards and the job rows, in their own geometry. */
function AnalyticsSkeleton() {
  return (
    <SkeletonGroup>
      <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-7 w-72 max-w-full rounded-pill" />
          <Skeleton className="h-3 w-96 max-w-full rounded-pill" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-48 rounded-input" />
          <Skeleton className="h-11 w-full rounded-input sm:w-60" />
        </div>
      </div>
      <div className="space-y-6">
        <div className={CARD}>
          <Skeleton className="h-4 w-36 rounded-pill" />
          <div className="mt-5 flex items-end justify-between gap-6">
            <Skeleton className="h-12 w-32" />
            <div className="hidden gap-10 sm:flex">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-20" />
              ))}
            </div>
          </div>
          <Skeleton className="mt-8 h-36 w-full sm:h-44" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className={cn(CARD, 'space-y-4')}>
              <Skeleton className="h-4 w-40 rounded-pill" />
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-3 w-full rounded-pill" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
