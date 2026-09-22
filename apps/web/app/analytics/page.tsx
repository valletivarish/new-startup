'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '../../components/AppShell';
import {
  EmptyState,
  Notice,
  PageHeader,
  PageMain,
  Surface,
} from '../../components/ui/page';
import { Skeleton } from '../../components/ui/skeleton';
import { loginPathForReturn } from '../../lib/auth-redirect';
import { toPublicId } from '../../lib/public-id';
import { PIPELINE_STATUS_LABEL } from '../../lib/status-labels';
import {
  ApiClientError,
  listJobCandidates,
  listJobs,
  listVoiceSessions,
  me,
  type Job,
  type Me,
  type VoiceSession,
} from '../../lib/api';

type JobFunnelRow = {
  id: string;
  title: string;
  inQueue: number;
  held: number;
  movedForward: number;
  people: number;
  screens: number;
  completed: number;
};

export default function AnalyticsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [funnelRows, setFunnelRows] = useState<JobFunnelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await me();
      setProfile(p);
      const [s, j] = await Promise.all([
        listVoiceSessions().catch(() => ({ sessions: [] as VoiceSession[] })),
        listJobs().catch(() => ({ jobs: [] as Job[] })),
      ]);
      setSessions(s.sessions);
      setJobs(j.jobs);

      const trackedJobs = j.jobs
        .filter((job) => job.status !== 'closed')
        .slice(0, 12);
      const perJob = await Promise.all(
        trackedJobs.map(async (job) => {
          try {
            const res = await listJobCandidates(job.id, { limit: 100 });
            const screens = s.sessions.filter((sess) => sess.jobId === job.id);
            const completed = screens.filter(
              (sess) => sess.status === 'ended',
            ).length;
            // On hold maps to assignment status `screening`.
            return {
              id: job.id,
              title: job.title,
              inQueue: res.totals.new,
              held: res.totals.screening,
              movedForward: res.totals.reviewed,
              people: res.totals.all,
              screens: screens.length,
              completed,
            } satisfies JobFunnelRow;
          } catch {
            return {
              id: job.id,
              title: job.title,
              inQueue: 0,
              held: 0,
              movedForward: 0,
              people: 0,
              screens: s.sessions.filter((sess) => sess.jobId === job.id).length,
              completed: s.sessions.filter(
                (sess) => sess.jobId === job.id && sess.status === 'ended',
              ).length,
            } satisfies JobFunnelRow;
          }
        }),
      );
      setFunnelRows(perJob);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn('/analytics'));
        return;
      }
      setError('Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const ended = sessions.filter((s) => s.status === 'ended').length;
    const failed = sessions.filter((s) => s.status === 'failed').length;
    const active = sessions.filter(
      (s) => s.status === 'active' || s.status === 'pending',
    ).length;
    const byDay = new Map<string, number>();
    for (const s of sessions) {
      const raw = s.startedAt;
      if (!raw) continue;
      const day = new Date(raw).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const chart = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([day, count]) => ({
        day: day.slice(5),
        screens: count,
      }));

    const people = funnelRows.reduce((n, r) => n + r.people, 0);
    const screened = funnelRows.reduce((n, r) => n + r.completed, 0);
    const moved = funnelRows.reduce((n, r) => n + r.movedForward, 0);
    const openJobs = jobs.filter((j) => j.status === 'open').length;
    const activeJobs = jobs.filter((j) => j.status !== 'closed').length;

    return {
      ended,
      failed,
      active,
      total: sessions.length,
      chart,
      people,
      screened,
      moved,
      openJobs,
      activeJobs,
    };
  }, [sessions, funnelRows, jobs]);

  const funnelStages = [
    {
      label: 'People on roles',
      value: stats.people,
      hint: 'Anyone added to a job that is not closed',
      barPct: 100,
      rateLabel: null as string | null,
    },
    {
      label: 'Screens completed',
      value: stats.screened,
      hint: 'Calls that finished on those roles',
      barPct:
        stats.people > 0
          ? Math.round((stats.screened / stats.people) * 100)
          : 0,
      rateLabel:
        stats.people > 0
          ? `${Math.round((stats.screened / stats.people) * 100)}% of people`
          : null,
    },
    {
      label: 'Moved forward',
      value: stats.moved,
      hint: 'Marked ready for the next step',
      barPct:
        stats.screened > 0
          ? Math.round((stats.moved / stats.screened) * 100)
          : stats.people > 0
            ? Math.round((stats.moved / stats.people) * 100)
            : 0,
      rateLabel:
        stats.screened > 0
          ? `${Math.round((stats.moved / stats.screened) * 100)}% of screens done`
          : stats.people > 0
            ? `${Math.round((stats.moved / stats.people) * 100)}% of people`
            : null,
    },
  ];

  const metrics = [
    { label: 'Open jobs', value: stats.openJobs },
    { label: 'Roles tracked', value: stats.activeJobs },
    { label: 'Total screens', value: stats.total },
    { label: 'Completed', value: stats.ended },
  ];

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Analytics"
          description="Screens and pipeline counts from your company."
        />

        {loading ? (
          <Surface
            className="overflow-hidden p-0"
            aria-busy="true"
            aria-label="Loading"
          >
            <div className="grid grid-cols-2 divide-x divide-[var(--separator-subtle)] sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2 px-5 py-4">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-7 w-10" />
                </div>
              ))}
            </div>
          </Surface>
        ) : null}
        {error ? <Notice kind="err">{error}</Notice> : null}

        {!loading ? (
          <>
            <Surface className="overflow-hidden p-0">
              <dl className="m-0 grid grid-cols-2 divide-x divide-y divide-[var(--separator-subtle)] sm:grid-cols-4 sm:divide-y-0">
                {metrics.map((card) => (
                  <div key={card.label} className="px-5 py-4">
                    <dt className="m-0 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
                      {card.label}
                    </dt>
                    <dd className="m-0 mt-1.5 font-display text-[1.75rem] font-semibold tabular-nums tracking-tight leading-none">
                      {card.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Surface>

            <Surface className="space-y-4">
              <div>
                <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                  Hiring funnel
                </h2>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                  Across roles that are not closed — how many people were added,
                  screened, and moved forward.
                </p>
              </div>
              <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
                {funnelStages.map((stage) => (
                  <li key={stage.label} className="min-w-0">
                    <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                      {stage.label}
                    </p>
                    <p className="mt-1 mb-0 font-display text-2xl font-semibold tabular-nums tracking-tight">
                      {stage.value}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{
                          width: `${Math.max(0, Math.min(100, stage.barPct))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1.5 mb-0 text-xs text-[var(--foreground-tertiary)]">
                      {stage.rateLabel ?? stage.hint}
                    </p>
                  </li>
                ))}
              </ol>
            </Surface>

            {stats.failed > 0 ? (
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                {stats.failed} failed connect
                {stats.failed === 1 ? '' : 's'} — check numbers and your phone
                line in Activity.
              </p>
            ) : null}

            {stats.total === 0 && stats.people === 0 ? (
              <EmptyState
                icon={<BarChart3 className="h-5 w-5" aria-hidden />}
                title="No screens yet"
                description="When people are added and calls finish, the funnel and day chart show up here."
              />
            ) : null}

            {funnelRows.length > 0 ? (
              <Surface className="space-y-3 overflow-hidden p-0">
                <div className="border-b border-[var(--separator-subtle)] px-5 py-4">
                  <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                    By job
                  </h2>
                  <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                    Draft and open roles — people stages and completed screens.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--separator-subtle)]">
                        <th className="px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                          Job
                        </th>
                        <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                          {PIPELINE_STATUS_LABEL.new}
                        </th>
                        <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                          {PIPELINE_STATUS_LABEL.screening}
                        </th>
                        <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                          {PIPELINE_STATUS_LABEL.reviewed}
                        </th>
                        <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                          Screens done
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--separator-subtle)]">
                      {funnelRows.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-[var(--surface-secondary)]"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/jobs/${toPublicId(row.id)}/candidates`}
                              className="font-medium text-[var(--foreground)] no-underline hover:underline"
                            >
                              {row.title}
                            </Link>
                          </td>
                          <td className="px-3 py-3 tabular-nums text-[var(--foreground-secondary)]">
                            {row.inQueue}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-[var(--foreground-secondary)]">
                            {row.held}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-[var(--foreground-secondary)]">
                            {row.movedForward}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-[var(--foreground-secondary)]">
                            {row.completed}
                            {row.screens > row.completed
                              ? ` / ${row.screens}`
                              : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Surface>
            ) : null}

            {stats.chart.length > 0 ? (
              <Surface className="space-y-3">
                <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                  Screens by day
                </h2>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.chart}>
                      <CartesianGrid
                        stroke="var(--separator-subtle)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="day"
                        tick={{
                          fill: 'var(--foreground-tertiary)',
                          fontSize: 11,
                        }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{
                          fill: 'var(--foreground-tertiary)',
                          fontSize: 11,
                        }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--surface-secondary)' }}
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--separator)',
                          borderRadius: 8,
                          fontSize: 12,
                          boxShadow: 'var(--shadow-md)',
                        }}
                      />
                      <Bar
                        dataKey="screens"
                        fill="var(--accent)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Surface>
            ) : null}
          </>
        ) : null}
      </PageMain>
    </AppShell>
  );
}
