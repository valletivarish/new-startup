'use client';

/**
 * Home — attention inbox for hiring.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Briefcase, Users } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/input';
import { EmptyState, Notice, PageHeader, PageMain, Surface } from '../../components/ui/page';
import { SkeletonCard, SkeletonList } from '../../components/ui/skeleton';
import { toPublicId } from '../../lib/public-id';
import { loginPathForReturn } from '../../lib/auth-redirect';
import {
  ApiClientError,
  ensureOrganization,
  listJobCandidates,
  listJobs,
  me,
  myOrganizations,
  signOut,
  switchOrganization,
  type Job,
  type Me,
  type OrganizationSummary,
} from '../../lib/api';

interface PersonRow {
  jobTitle: string;
  jobId: string;
  candidateId: string;
  candidateName: string;
  status: string;
  callStatus?: 'not_called' | 'calling' | 'completed' | 'failed';
}

interface JobHealth {
  job: Job;
  total: number;
  awaitingScreen: number;
  inProgress: number;
  needsReview: number;
}

interface HiringSnapshot {
  jobs: JobHealth[];
  attention: PersonRow[];
  needsReview: PersonRow[];
  inProgress: PersonRow[];
}

import { JOB_STATUS_LABEL, PERSON_STATUS_LABEL, PIPELINE_STATUS_LABEL } from '../../lib/status-labels';

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([]);
  const [newOrgName, setNewOrgName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HiringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      let profileData = await me();
      let orgData = await myOrganizations();

      if (
        !profileData.activeOrganization &&
        orgData.organizations.length === 0
      ) {
        const base = (profileData.user.name || 'My').trim() || 'My';
        const fallback = `${base}'s company`.slice(0, 100);
        await ensureOrganization(fallback.length >= 2 ? fallback : 'My company');
        [profileData, orgData] = await Promise.all([me(), myOrganizations()]);
      } else if (
        !profileData.activeOrganization &&
        orgData.organizations[0]
      ) {
        await switchOrganization(orgData.organizations[0].id);
        profileData = await me();
      }

      setProfile(profileData);
      setOrgs(orgData.organizations);

      if (profileData.activeOrganization) {
        const permissions = new Set(profileData.activeOrganization.permissions);

        if (permissions.has('jobs.read')) {
          const { jobs } = await listJobs();
          const canCandidates = permissions.has('candidates.read');
          const jobHealth: JobHealth[] = [];
          const attention: PersonRow[] = [];
          const needsReview: PersonRow[] = [];
          const inProgress: PersonRow[] = [];

          for (const job of jobs) {
            let rows: PersonRow[] = [];
            if (canCandidates) {
              try {
                const { candidates } = await listJobCandidates(job.id);
                rows = candidates.map((row) => ({
                  jobId: job.id,
                  jobTitle: job.title,
                  candidateId: row.candidateId,
                  candidateName: row.candidate.fullName,
                  status: row.status,
                  callStatus: row.callStatus,
                }));
              } catch {
                rows = [];
              }
            }
            const awaitingScreen = rows.filter((r) => r.status === 'new').length;
            const screening = rows.filter((r) => r.status === 'screening').length;
            const reviewReady = rows.filter(
              (r) =>
                r.callStatus === 'completed' && r.status !== 'reviewed',
            );
            jobHealth.push({
              job,
              total: rows.length,
              awaitingScreen,
              inProgress: screening,
              needsReview: reviewReady.length,
            });
            needsReview.push(...reviewReady);
            attention.push(
              ...rows.filter(
                (r) =>
                  r.status === 'new' &&
                  r.callStatus !== 'completed',
              ),
            );
            inProgress.push(
              ...rows.filter(
                (r) =>
                  r.status === 'screening' &&
                  r.callStatus !== 'completed',
              ),
            );
          }

          setSnapshot({
            jobs: jobHealth,
            attention: attention.slice(0, 8),
            needsReview: needsReview.slice(0, 8),
            inProgress: inProgress.slice(0, 8),
          });
        } else {
          setSnapshot(null);
        }
      } else {
        setSnapshot(null);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
      } else {
        setNotice('Could not load your workspace. Refresh to retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const greeting = useMemo(() => {
    const name = profile?.user.name?.split(' ')[0] || 'there';
    if (!mounted) return `Hello, ${name}`;
    const hour = new Date().getHours();
    if (hour < 12) return `Good morning, ${name}`;
    if (hour < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  }, [profile?.user.name, mounted]);

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain className="space-y-4">
          <SkeletonCard />
          <SkeletonList />
        </PageMain>
      </AppShell>
    );
  }

  const active = profile.activeOrganization;
  const permissions = new Set(active?.permissions ?? []);

  async function onCreateOrg(event: FormEvent) {
    event.preventDefault();
    await ensureOrganization(newOrgName);
    setNewOrgName('');
    await reload();
  }

  async function onSwitch(id: string) {
    await switchOrganization(id);
    await reload();
  }

  const jobsNeedingCandidates =
    snapshot?.jobs.filter((j) => j.total === 0 && j.job.status !== 'closed') ??
    [];

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title={greeting}
          description="What needs your attention in hiring today."
          actions={
            <>
              {orgs.length > 1 ? (
                <Select
                  value={active?.id ?? ''}
                  onChange={(e) => void onSwitch(e.target.value)}
                  aria-label="Company"
                  className="w-auto min-w-[10rem]"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm text-[var(--foreground-tertiary)]">
                  {orgs[0]?.name ?? 'Your company'}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => void signOut().then(() => router.push('/'))}
              >
                Sign out
              </Button>
            </>
          }
        />

        {notice ? <Notice kind="ok">{notice}</Notice> : null}

        {!active ? (
          <Surface>
            <h2 className="m-0 font-display text-base font-semibold tracking-tight">Name your company</h2>
            <p className="mt-1 text-sm text-[var(--foreground-tertiary)]">
              Add a company name to open your hiring desk. If you were invited,
              use the invite link from your email.
            </p>
            <form
              onSubmit={onCreateOrg}
              className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <Field label="Company name" className="sm:flex-1">
                <Input
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Your company"
                  required
                  minLength={2}
                />
              </Field>
              <Button type="submit">Continue</Button>
            </form>
          </Surface>
        ) : null}

        {active && loading ? (
          <>
            <SkeletonCard />
            <SkeletonList />
          </>
        ) : null}

        {active && !loading && permissions.has('jobs.read') ? (
          <>
            <section className="space-y-3">
              <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                Needs attention
              </h2>
              {snapshot &&
              (snapshot.needsReview.length > 0 ||
                snapshot.attention.length > 0 ||
                snapshot.inProgress.length > 0 ||
                jobsNeedingCandidates.length > 0) ? (
                <Surface className="overflow-hidden p-0">
                  <ul className="m-0 list-none divide-y divide-[var(--separator-subtle)] p-0">
                    {jobsNeedingCandidates.slice(0, 3).map(({ job }) => (
                      <li key={`empty-${job.id}`}>
                        <Link
                          href={`/jobs/${toPublicId(job.id)}/candidates`}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[var(--foreground)] no-underline transition-colors duration-fast hover:bg-[var(--surface-secondary)]"
                        >
                          <div className="min-w-0">
                            <p className="m-0 text-sm font-medium">{job.title}</p>
                            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                              No people yet — add people to start screening.
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)]">
                            Add people
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        </Link>
                      </li>
                    ))}
                    {snapshot.needsReview.map((row, i) => (
                      <li key={`rev-${row.jobId}-${row.candidateId}-${i}`}>
                        <Link
                          href={`/jobs/${toPublicId(row.jobId)}/candidates?c=${encodeURIComponent(toPublicId(row.candidateId))}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[var(--foreground)] no-underline transition-colors duration-fast hover:bg-[var(--surface-secondary)]"
                        >
                          <div className="min-w-0">
                            <p className="m-0 text-sm font-medium">
                              {row.candidateName}
                            </p>
                            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                              Screen done · {row.jobTitle}
                            </p>
                          </div>
                          <Badge tone="accent">Review answers</Badge>
                        </Link>
                      </li>
                    ))}
                    {snapshot.attention.map((row, i) => (
                      <li key={`att-${row.jobId}-${row.candidateId}-${i}`}>
                        <Link
                          href={`/jobs/${toPublicId(row.jobId)}/candidates?c=${encodeURIComponent(toPublicId(row.candidateId))}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[var(--foreground)] no-underline transition-colors duration-fast hover:bg-[var(--surface-secondary)]"
                        >
                          <div className="min-w-0">
                            <p className="m-0 text-sm font-medium">
                              {row.candidateName}
                            </p>
                            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                              In queue · {row.jobTitle}
                            </p>
                          </div>
                          <Badge tone={statusTone(row.status)}>
                            {PERSON_STATUS_LABEL[row.status] ?? row.status}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                    {snapshot.inProgress.map((row, i) => (
                      <li key={`prog-${row.jobId}-${row.candidateId}-${i}`}>
                        <Link
                          href={`/jobs/${toPublicId(row.jobId)}/candidates?c=${encodeURIComponent(toPublicId(row.candidateId))}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[var(--foreground)] no-underline transition-colors duration-fast hover:bg-[var(--surface-secondary)]"
                        >
                          <div className="min-w-0">
                            <p className="m-0 text-sm font-medium">
                              {row.candidateName}
                            </p>
                            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                              {PERSON_STATUS_LABEL.screening} · {row.jobTitle}
                            </p>
                          </div>
                          <Badge tone="accent">
                            {PERSON_STATUS_LABEL.screening}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Surface>
              ) : (
                <EmptyState
                  icon={<Briefcase className="h-5 w-5" aria-hidden />}
                  title="You are caught up"
                  description="Create a job or add candidates when you are ready to screen."
                  action={
                    <Button asChild>
                      <Link href="/jobs">
                        Go to Jobs
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  }
                />
              )}
            </section>

            {snapshot && snapshot.jobs.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                    Hiring pipeline
                  </h2>
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/jobs">View all</Link>
                  </Button>
                </div>
                <Surface className="overflow-hidden p-0">
                  <ul className="m-0 list-none divide-y divide-[var(--separator-subtle)] p-0">
                    {snapshot.jobs.map(
                      ({
                        job,
                        total,
                        awaitingScreen,
                        inProgress,
                        needsReview,
                      }) => (
                        <li key={job.id}>
                          <Link
                            href={`/jobs/${toPublicId(job.id)}/candidates`}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[var(--foreground)] no-underline transition-colors duration-fast hover:bg-[var(--surface-secondary)]"
                          >
                            <div className="min-w-0">
                              <span className="block text-sm font-semibold">
                                {job.title}
                              </span>
                              <p className="mt-1 mb-0 text-[13px] text-[var(--foreground-tertiary)]">
                                {[
                                  total === 1 ? '1 person' : `${total} people`,
                                  awaitingScreen > 0
                                    ? `${awaitingScreen} ${PIPELINE_STATUS_LABEL.new.toLowerCase()}`
                                    : null,
                                  inProgress > 0
                                    ? `${inProgress} ${PIPELINE_STATUS_LABEL.screening.toLowerCase()}`
                                    : null,
                                  needsReview > 0
                                    ? `${needsReview} ${PIPELINE_STATUS_LABEL.reviewed.toLowerCase()}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            <Badge tone={statusTone(job.status)}>
                              {JOB_STATUS_LABEL[job.status] ?? job.status}
                            </Badge>
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </Surface>
              </section>
            ) : null}
          </>
        ) : null}

        {active &&
        (permissions.has('users.read') || permissions.has('users.invite')) ? (
          <Link
            href="/settings#team"
            className="block text-[var(--foreground)] no-underline"
          >
            <Surface className="flex items-center justify-between gap-3 transition-colors duration-fast hover:bg-[var(--surface-secondary)]">
              <div className="flex min-w-0 items-start gap-3">
                <Users
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--foreground-tertiary)]"
                  aria-hidden
                />
                <div className="min-w-0">
                  <h2 className="m-0 font-display text-sm font-semibold tracking-tight">
                    Team
                  </h2>
                  <p className="m-0 mt-1 text-sm text-[var(--foreground-tertiary)]">
                    Invite people and manage roles in Settings.
                  </p>
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]"
                aria-hidden
              />
            </Surface>
          </Link>
        ) : null}
      </PageMain>
    </AppShell>
  );
}
