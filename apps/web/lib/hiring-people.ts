'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ApiClientError,
  getHiringSummary,
  listAgents,
  listJobCandidates,
  listJobs,
  NotAvailableError,
  type CandidateStage,
  type HiringQueueItem,
  type HiringSummary,
  type Job,
  type JobCandidateAssignment,
  type Me,
} from '../lib/api';
import { meetsAllFirst } from '../components/candidates/fit';

export interface HiringPerson {
  candidateId: string;
  fullName: string;
  jobId: string;
  jobTitle: string;
  status: string;
  callStatus: string;
  /** Why the latest call didn't connect, when the backend says. */
  failureReason?: string | null;
  phone?: string | null;
}

/** Where a job's people stand, by Home's queues. "Not moving forward" counts only toward the total. */
export interface JobFunnel {
  total: number;
  /** No decision and never called. */
  notCalled: number;
  /** No decision, and their call ended: answers to read. */
  toReview: number;
  onHold: number;
  movedForward: number;
}

/** The job's people in one funnel, by the same rules as Home's queues. */
export function jobFunnel(rows: readonly { status: string; callStatus?: string | null }[]): JobFunnel {
  const funnel: JobFunnel = { total: rows.length, notCalled: 0, toReview: 0, onHold: 0, movedForward: 0 };
  for (const row of rows) {
    if (row.status === 'reviewed') funnel.movedForward += 1;
    else if (row.status === 'screening') funnel.onHold += 1;
    const queue = homeQueueOf(row.status, row.callStatus);
    if (queue === 'notCalled') funnel.notCalled += 1;
    else if (queue === 'readyForReview' && row.status === 'new') funnel.toReview += 1;
  }
  return funnel;
}

type Noun = { one: string; many: string };
const CANDIDATE: Noun = { one: 'candidate', many: 'candidates' };
const counted = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.one : noun.many}`;

export function filterPeopleByJob<T extends { jobId: string }>(
  people: readonly T[],
  jobId: string | 'all',
): T[] {
  if (!jobId || jobId === 'all') return [...people];
  return people.filter((row) => row.jobId === jobId);
}

/**
 * Jobs list: who is on the job, as a count and the named parts that wait on you. '' when the
 * funnel is unknown (people not loaded, or no permission to read them): never "No candidates
 * yet" for a job whose people we couldn't see (audit H6). `noun`: the use case's contact words.
 */
export function formatJobPeopleSummary(funnel: JobFunnel | undefined, noun: Noun = CANDIDATE): string {
  if (!funnel) return '';
  if (funnel.total === 0) return `No ${noun.many} yet`;
  const parts = [
    funnel.toReview > 0 ? `${funnel.toReview} ready for review` : '',
    funnel.notCalled > 0 ? `${funnel.notCalled} not called yet` : '',
    funnel.onHold > 0 ? `${funnel.onHold} on hold` : '',
    funnel.movedForward > 0 ? `${funnel.movedForward} moved forward` : '',
  ].filter(Boolean);
  return parts.length ? `${counted(funnel.total, noun)}: ${parts.join(', ')}` : counted(funnel.total, noun);
}

/** The job's next step, in Home's order. '' when it depends on people we couldn't see. */
export function formatJobNextStep(
  hasJdDocs: boolean,
  funnel: JobFunnel | undefined,
  noun: Noun = CANDIDATE,
): string {
  if (!hasJdDocs) return 'Add a job description';
  if (!funnel) return '';
  if (funnel.total === 0) return `Add ${noun.many}`;
  if (funnel.toReview > 0) return `Review ${counted(funnel.toReview, noun)}`;
  if (funnel.notCalled > 0) return `Call ${counted(funnel.notCalled, noun)}`;
  if (funnel.onHold > 0) return `Review ${counted(funnel.onHold, noun)} on hold`;
  return `Open ${noun.many}`;
}

export interface HiringPeopleSnapshot {
  jobs: Job[];
  people: HiringPerson[];
  funnels: Record<string, JobFunnel>;
}

export async function fetchHiringPeople(q?: string): Promise<HiringPeopleSnapshot> {
  const { jobs } = await listJobs();
  const openJobs = jobs.filter((j) => j.status !== 'closed');
  const qTrim = q?.trim() ?? '';
  const qLower = qTrim.toLowerCase();

  const batches = await Promise.all(
    openJobs.map(async (job) => {
      try {
        const titleHit =
          qLower.length > 0 && job.title.toLowerCase().includes(qLower);
        const { candidates } = await listJobCandidates(job.id, {
          // Job-title hits need the full roster; otherwise search name/mobile on the API.
          q: titleHit ? undefined : qTrim || undefined,
        });
        return { job, candidates };
      } catch (error) {
        // No permission to read candidates: the job still lists, its people unknown (no funnel).
        // Any other failure fails the load, so pages show an error, not "No people yet" (audit H6).
        if (error instanceof ApiClientError && error.status === 403) return { job, candidates: null };
        throw error;
      }
    }),
  );

  const people: HiringPerson[] = [];
  const funnels: Record<string, JobFunnel> = {};

  for (const { job, candidates } of batches) {
    if (!candidates) continue;
    funnels[job.id] = jobFunnel(candidates);
    for (const row of candidates) {
      people.push({
        candidateId: row.candidateId,
        fullName: row.candidate.fullName,
        jobId: job.id,
        jobTitle: job.title,
        status: row.status,
        callStatus: row.callStatus ?? 'not_called',
        failureReason: row.failureReason ?? null,
        phone: row.candidate.phone ?? null,
      });
    }
  }

  return { jobs, people, funnels };
}

export const hiringPeopleQueryKey = ['hiring-people'] as const;

export function useHiringPeople(enabled = true, q = '') {
  const trimmed = q.trim();
  return useQuery({
    queryKey: [...hiringPeopleQueryKey, trimmed],
    queryFn: () => fetchHiringPeople(trimmed || undefined),
    enabled,
    staleTime: 30_000,
  });
}

// --- Home ------------------------------------------------------------------------------------

/** People Home lists per queue, as GET /hiring/summary returns them. `total` is always the true count. */
export const HOME_QUEUE_LIMIT = 8;

export type HomeQueueKey = keyof HiringSummary['queues'];
export type HomeQueue = HiringSummary['queues'][HomeQueueKey];

/** Home in one shape, whichever backend answered. null means this person can't see that number. */
export interface HomeSnapshot {
  /** Agents that aren't archived. */
  agents: number | null;
  /** Jobs in any status. */
  jobs: number;
  openJobs: number;
  /** Where "Add candidates" goes: the first open job, else the first job. */
  firstJobId: string | null;
  candidates: number | null;
  /** Without permission to read candidates, the summary keeps real totals with no items. */
  queues: Record<HomeQueueKey, HomeQueue> | null;
}

/**
 * The one queue a person sits in, checked in the backend's order (MIGRATION_STATUS.md,
 * GET /hiring/summary). null: decided, or a call in progress.
 */
export function homeQueueOf(stage: string, callStatus: string | null | undefined): HomeQueueKey | null {
  if (stage === 'reviewed' || stage === 'declined') return null;
  if (callStatus === 'completed') return 'readyForReview';
  if (callStatus === 'failed') return 'notConnected';
  if (stage === 'screening') return 'onHold';
  return stage === 'new' && (callStatus ?? 'not_called') === 'not_called' ? 'notCalled' : null;
}

// The Java summary adds a per-job list; older shapes may not carry it.
type SummaryWithJobs = HiringSummary & {
  jobs?: { jobId: string; jobStatus?: string }[];
  totals?: { jobs?: number };
};

export function homeSnapshotFromSummary(summary: SummaryWithJobs): HomeSnapshot {
  const jobs = summary.jobs ?? [];
  const first = jobs.find((job) => job.jobStatus === 'open') ?? jobs[0];
  return {
    agents: summary.counts.agents,
    // Without the job list, open jobs is the count we have.
    jobs: summary.totals?.jobs ?? (summary.jobs ? jobs.length : summary.counts.openJobs),
    openJobs: summary.counts.openJobs,
    firstJobId: first?.jobId ?? null,
    candidates: summary.counts.candidates,
    queues: {
      ...summary.queues,
      readyForReview: { ...summary.queues.readyForReview, items: meetsAllFirst(summary.queues.readyForReview.items) },
    },
  };
}

/** The summary's numbers from the job lists (older backends). `lists` null: no permission to read candidates. */
export function homeSnapshotFromLists(
  jobs: readonly Job[],
  agents: number | null,
  lists: readonly { job: Job; rows: readonly JobCandidateAssignment[] }[] | null,
): HomeSnapshot {
  const open = jobs.filter((job) => job.status === 'open');
  const base = { agents, jobs: jobs.length, openJobs: open.length, firstJobId: (open[0] ?? jobs[0])?.id ?? null };
  if (!lists) return { ...base, candidates: null, queues: null };

  const queued: Record<HomeQueueKey, HiringQueueItem[]> = {
    readyForReview: [],
    notConnected: [],
    notCalled: [],
    onHold: [],
  };
  let candidates = 0;
  for (const { job, rows } of lists) {
    candidates += rows.length;
    for (const row of rows) {
      const callStatus = row.callStatus ?? 'not_called';
      const queue = homeQueueOf(row.status, callStatus);
      if (!queue) continue;
      queued[queue].push({
        jobId: job.id,
        jobTitle: job.title,
        candidateId: row.candidateId,
        fullName: row.candidate.fullName,
        stage: row.status as CandidateStage,
        callStatus,
        failureReason: row.failureReason ?? null,
        lastCallAt: null,
        fit: row.fit ?? null,
      });
    }
  }
  // Count first, then slice: the totals never shrink to what is shown (audit H5).
  const queue = (items: HiringQueueItem[]): HomeQueue => ({
    total: items.length,
    items: items.slice(0, HOME_QUEUE_LIMIT),
  });
  return {
    ...base,
    candidates,
    queues: {
      // Candidates who meet every requirement HR set lead the review list.
      readyForReview: queue(meetsAllFirst(queued.readyForReview)),
      notConnected: queue(queued.notConnected),
      notCalled: queue(queued.notCalled),
      onHold: queue(queued.onHold),
    },
  };
}

/** Setup isn't finished: no agent, no job or no candidates yet. A number we can't see doesn't count as missing. */
export function needsSetup(snapshot: HomeSnapshot): boolean {
  return snapshot.agents === 0 || snapshot.jobs === 0 || snapshot.candidates === 0;
}

/** Queue items under their job, jobs in order of first appearance. */
export function groupQueueByJob(items: readonly HiringQueueItem[]) {
  const groups = new Map<string, { jobId: string; jobTitle: string; items: HiringQueueItem[] }>();
  for (const item of items) {
    const group = groups.get(item.jobId) ?? { jobId: item.jobId, jobTitle: item.jobTitle, items: [] };
    group.items.push(item);
    groups.set(item.jobId, group);
  }
  return [...groups.values()];
}

/** One request where the backend has GET /hiring/summary; otherwise the job lists, in parallel (audit H8). */
export async function fetchHomeSnapshot(can: (permission: string) => boolean): Promise<HomeSnapshot> {
  try {
    return homeSnapshotFromSummary(await getHiringSummary());
  } catch (error) {
    if (!(error instanceof NotAvailableError)) throw error;
  }
  const [{ jobs }, agents] = await Promise.all([
    listJobs(),
    can('agents.read')
      ? listAgents().then((res) => res.agents.filter((agent) => agent.status !== 'archived').length)
      : null,
  ]);
  const lists = can('candidates.read')
    ? await Promise.all(jobs.map(async (job) => ({ job, rows: (await listJobCandidates(job.id)).candidates })))
    : null;
  return homeSnapshotFromLists(jobs, agents, lists);
}

/** Invalidate after anything that moves a person between queues (a call placed, a decision). */
export const homeQueryKey = ['home'] as const;

/** Home's numbers for the active workspace. Waits until the profile says the person can read jobs. */
export function useHomeSnapshot(profile: Me | null | undefined) {
  const org = profile?.activeOrganization ?? null;
  const permissions = org?.permissions ?? [];
  return useQuery({
    queryKey: [...homeQueryKey, org?.id ?? null],
    queryFn: () => fetchHomeSnapshot((permission) => permissions.includes(permission)),
    enabled: permissions.includes('jobs.read'),
    // Coming back to the tab is when a recruiter expects new results.
    refetchOnWindowFocus: true,
  });
}
