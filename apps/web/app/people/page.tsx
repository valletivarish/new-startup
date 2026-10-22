'use client';

/**
 * Candidates (D2): everyone on your open jobs in one list, one tag each for where they stand, in
 * Home's words. Search by name or mobile, narrow by job or by state, then open a person on their
 * job to call, review or decide.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Lock, SearchX, UserPlus, UsersRound } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PersonStateTag, personState, type PersonState } from '@/components/candidates/person-state';
import { UserInitials } from '@/components/shared/user-initials';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SearchInput, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import { SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import { ApiClientError, type Job } from '@/lib/api';
import { loginPathForReturn } from '@/lib/auth-redirect';
import { toUserMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/format';
import { fetchHiringPeople, filterPeopleByJob, hiringPeopleQueryKey, type HiringPerson } from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { useMe } from '@/lib/use-me';
import { useOnline } from '@/lib/use-online';

// A call in progress shows under All only: it lasts minutes, too short to filter by. Decisions
// split as on the job's board: moved forward, not moving forward.
type Filter = 'all' | Exclude<PersonState, 'calling' | 'decided'> | 'reviewed' | 'declined';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'review', label: 'Ready for review' },
  { value: 'retry', label: 'Didn’t connect' },
  { value: 'new', label: 'Not called yet' },
  { value: 'hold', label: 'On hold' },
  { value: 'reviewed', label: 'Moved forward' },
  { value: 'declined', label: 'Not moving forward' },
];

/** The filter a person shows under: their one state, a decision by its own name. */
function filterOf(row: HiringPerson): Filter | null {
  const state = personState(row.status, row.callStatus);
  if (state === 'calling') return null;
  if (state === 'decided') return row.status === 'declined' ? 'declined' : 'reviewed';
  return state;
}

/** Their row on the job's board; a call waiting on review opens on its answers. */
function personHref(row: HiringPerson): string {
  const href = `/jobs/${toPublicId(row.jobId)}/people?c=${encodeURIComponent(toPublicId(row.candidateId))}`;
  return personState(row.status, row.callStatus) === 'review' ? `${href}&tab=results` : href;
}

export default function PeoplePage() {
  const router = useRouter();
  const me = useMe();
  const profile = me.data ?? null;
  const can = (permission: string) => profile?.activeOrganization?.permissions.includes(permission) ?? false;
  const canRead = can('candidates.read');

  useEffect(() => {
    if (me.error instanceof ApiClientError && me.error.status === 401) router.push(loginPathForReturn('/people'));
  }, [me.error, router]);

  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [jobFilter, setJobFilter] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');

  // Home links here with the server's stage name (?stage=new, or ?stage=screening for on
  // hold): open on that filter.
  useEffect(() => {
    const stage = new URLSearchParams(window.location.search).get('stage');
    const linked = stage === 'screening' ? 'hold' : FILTERS.find((f) => f.value === stage)?.value;
    if (linked) setFilter(linked);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(queryDraft.trim()), 280);
    return () => window.clearTimeout(handle);
  }, [queryDraft]);

  // useHiringPeople's query (same key, so Home's invalidations reach it), keeping the last
  // results on screen while a new search runs.
  const people = useQuery({
    queryKey: [...hiringPeopleQueryKey, query],
    queryFn: () => fetchHiringPeople(query || undefined),
    enabled: canRead,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  // The jobs whose people are listed (fetchHiringPeople skips closed ones).
  const openJobs = useMemo<Job[]>(
    () => (people.data?.jobs ?? []).filter((job) => job.status !== 'closed'),
    [people.data],
  );
  // Adding happens on a job: the one in view, or the only one; with several, the jobs list.
  const addTo = openJobs.find((job) => job.id === jobFilter) ?? (openJobs.length === 1 ? openJobs[0] : null);
  const addHref = can('candidates.create') ? (addTo ? `/jobs/${toPublicId(addTo.id)}/people` : '/jobs') : null;

  const loadingProfile = useHeldLoading(me.isPending);
  const loadingPeople = useHeldLoading(people.isPending && people.fetchStatus !== 'idle');

  return (
    <AppShell profile={profile}>
      <PageMain>
        <PageHeader
          title="People"
          accent="across your jobs"
          description="Everyone on your open jobs and where they stand. Open someone to call them, read what they said, or decide."
          actions={
            // In an empty workspace the empty state holds the one main action instead.
            canRead && addHref && openJobs.length > 0 && !(people.data?.people.length === 0 && !query) ? (
              <Button asChild>
                <Link href={addHref}>
                  <UserPlus aria-hidden strokeWidth={1.5} />
                  Add candidates
                </Link>
              </Button>
            ) : undefined
          }
        />
        {loadingProfile || (!me.data && !me.isError) ? (
          <SkeletonRows rows={6} />
        ) : me.isError ? (
          <LoadError error={me.error} context="load your account" onRetry={() => void me.refetch()} retrying={me.isFetching} />
        ) : !canRead ? (
          <EmptyState
            icon={<Lock />}
            title="Candidates aren’t shared with you"
            description="Ask a workspace admin to add you to the people who can see candidates."
          />
        ) : loadingPeople || !people.data ? (
          people.isError ? (
            <LoadError
              error={people.error}
              context="load candidates"
              onRetry={() => void people.refetch()}
              retrying={people.isFetching}
            />
          ) : (
            <SkeletonRows rows={6} />
          )
        ) : (
          <People
            people={people.data.people}
            jobs={openJobs}
            jobFilter={jobFilter}
            setJobFilter={setJobFilter}
            filter={filter}
            setFilter={setFilter}
            queryDraft={queryDraft}
            setQueryDraft={setQueryDraft}
            query={query}
            searching={people.isPlaceholderData}
            showPhone={can('candidates.read_pii')}
            refreshError={people.isError ? people.error : null}
            onRetry={() => void people.refetch()}
            retrying={people.isFetching}
            addHref={addHref}
            canCreateJob={can('jobs.create')}
          />
        )}
      </PageMain>
    </AppShell>
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
  const message = toUserMessage(error, context);
  return <ErrorState title={message.title} cause={message.detail} onRetry={onRetry} retrying={retrying} />;
}

function People({
  people,
  jobs,
  jobFilter,
  setJobFilter,
  filter,
  setFilter,
  queryDraft,
  setQueryDraft,
  query,
  searching,
  showPhone,
  refreshError,
  onRetry,
  retrying,
  addHref,
  canCreateJob,
}: {
  people: HiringPerson[];
  jobs: Job[];
  jobFilter: string;
  setJobFilter: (id: string) => void;
  filter: Filter;
  setFilter: (filter: Filter) => void;
  queryDraft: string;
  setQueryDraft: (value: string) => void;
  query: string;
  searching: boolean;
  showPhone: boolean;
  refreshError: unknown;
  onRetry: () => void;
  retrying: boolean;
  addHref: string | null;
  canCreateJob: boolean;
}) {
  const byJob = useMemo(() => filterPeopleByJob(people, jobFilter), [people, jobFilter]);
  // True totals for the job and search in view: the API returns every candidate on each job.
  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: byJob.length,
      review: 0,
      retry: 0,
      new: 0,
      hold: 0,
      reviewed: 0,
      declined: 0,
    };
    for (const row of byJob) {
      const key = filterOf(row);
      if (key) out[key] += 1;
    }
    return out;
  }, [byJob]);
  const shown = filter === 'all' ? byJob : byJob.filter((row) => filterOf(row) === filter);
  const oneJob = jobFilter !== 'all';

  // A workspace with nobody yet: no filters to show, only the way to add people.
  if (people.length === 0 && !query && !queryDraft) {
    return jobs.length === 0 ? (
      <EmptyState
        icon={<UsersRound />}
        title="No candidates yet"
        description="Candidates belong to a job. Create one, then add the people you want HRVoice to call."
        action={
          canCreateJob ? (
            <Button asChild>
              <Link href="/jobs?create=1">Create job</Link>
            </Button>
          ) : undefined
        }
      />
    ) : (
      <EmptyState
        icon={<UsersRound />}
        title="No candidates yet"
        description="Add candidates to a job one at a time, from a spreadsheet or from resumes. Everyone shows up here."
        action={
          addHref ? (
            <Button asChild>
              <Link href={addHref}>
                <UserPlus aria-hidden strokeWidth={1.5} />
                Add candidates
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const filterOptions = FILTERS.map((option) => ({ ...option, count: counts[option.value] }));
  // Why the list is empty, so the way out fits: the search found nobody, the job has nobody on
  // it, or the state filter leaves nobody.
  const why = byJob.length > 0 ? 'filters' : query ? 'search' : oneJob ? 'job' : 'filters';

  return (
    <>
      {refreshError ? <RefreshFailed error={refreshError} onRetry={onRetry} retrying={retrying} /> : null}
      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchInput
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            placeholder="Search by name or mobile"
            aria-label="Search candidates by name or mobile"
            className="sm:max-w-sm"
          />
          <Select
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
            aria-label="Show candidates from"
            className="sm:w-64"
          >
            <option value="all">All open jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </Select>
        </div>
        <Segmented
          label="Show candidates who are"
          options={filterOptions}
          value={filter}
          onValueChange={setFilter}
          // Seven options with counts need about 920px: a native select below xl.
          collapseBelow="xl"
          className="justify-self-start"
        />
      </div>

      <p role="status" className={searching ? 'm-0 text-meta text-text-3' : 'sr-only'}>
        {searching ? 'Searching…' : `${shown.length} ${shown.length === 1 ? 'candidate' : 'candidates'}`}
      </p>

      {shown.length === 0 ? (
        why === 'search' ? (
          <EmptyState
            icon={<SearchX />}
            title={`No candidates match “${query}”`}
            description="Search by first or last name, or by mobile number."
            action={
              <Button variant="secondary" onClick={() => setQueryDraft('')}>
                Clear search
              </Button>
            }
          />
        ) : why === 'job' ? (
          <EmptyState
            icon={<UsersRound />}
            title="Nobody on this job yet"
            description="Add candidates on the job and they show up here."
            action={
              addHref ? (
                <Button asChild>
                  <Link href={addHref}>
                    <UserPlus aria-hidden strokeWidth={1.5} />
                    Add candidates
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={<SearchX />}
            title="No candidates match these filters"
            description="Show everyone, or pick another state or job."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter('all');
                  setJobFilter('all');
                }}
              >
                Show everyone
              </Button>
            }
          />
        )
      ) : (
        <ListRows
          aria-label="Candidates"
          columns={oneJob ? 'minmax(0,1fr) auto' : 'minmax(0,1.2fr) minmax(0,1fr) auto'}
          header={
            <>
              <span>Candidate</span>
              {oneJob ? null : <span>Job</span>}
              <span>Status</span>
            </>
          }
        >
          {shown.map((row) => (
            <ListRow key={`${row.jobId}-${row.candidateId}`}>
              <ListRowPrimary
                avatar={<UserInitials name={row.fullName} />}
                title={row.fullName}
                // Without permission to see numbers, the API leaves them out: say nothing rather than "none".
                meta={showPhone ? formatPhone(row.phone) || 'No mobile number' : undefined}
                href={personHref(row)}
              />
              {oneJob ? null : (
                <ListCell kind="meta" className="truncate">
                  {row.jobTitle}
                </ListCell>
              )}
              <ListCell kind="tag">
                <PersonStateTag stage={row.status} callStatus={row.callStatus} failureReason={row.failureReason} />
              </ListCell>
            </ListRow>
          ))}
        </ListRows>
      )}
    </>
  );
}

/** The list is still on screen, but the last refresh failed: say so, with the way back. */
function RefreshFailed({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const message = toUserMessage(error, 'refresh candidates');
  return (
    <Alert
      kind="warning"
      title={message.title}
      action={
        <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {message.detail}
    </Alert>
  );
}
