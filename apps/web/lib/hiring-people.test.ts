import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from './api';
import {
  ApiClientError,
  getHiringSummary,
  listAgents,
  listJobCandidates,
  listJobs,
  NotAvailableError,
  type HiringQueueItem,
  type HiringSummary,
  type Job,
  type JobCandidateAssignment,
} from './api';
import {
  fetchHiringPeople,
  fetchJobsOverview,
  fetchHomeSnapshot,
  filterPeopleByJob,
  formatJobPeopleSummary,
  groupQueueByJob,
  homeQueueOf,
  jobFunnel,
  homeSnapshotFromLists,
  homeSnapshotFromSummary,
  needsSetup,
  type HomeSnapshot,
  type JobFunnel,
} from './hiring-people';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  getHiringSummary: vi.fn(),
  listAgents: vi.fn(),
  listJobCandidates: vi.fn(),
  listJobs: vi.fn(),
}));

const job = (id: string, status = 'open'): Job => ({
  id,
  title: `Job ${id}`,
  description: '',
  status,
  agentId: null,
  screeningQuestions: [],
  screeningLanguage: 'en',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  hasJdDocs: true,
});

const row = (
  id: string,
  status: string,
  callStatus: JobCandidateAssignment['callStatus'] = 'not_called',
): JobCandidateAssignment => ({
  id,
  candidateId: id,
  status,
  callStatus,
  candidate: { id, fullName: `Person ${id}`, source: 'manual' },
});

const failure = (status: number) => new ApiClientError(status, { code: 'http_error', message: '' });

const empty: JobFunnel = { total: 0, notCalled: 0, notConnected: 0, toReview: 0, onHold: 0, movedForward: 0 };

describe('jobFunnel', () => {
  it('sorts people by Home’s rules: called and undecided is to review, never "not called"', () => {
    expect(
      jobFunnel([
        row('1', 'new'),
        row('2', 'new', 'completed'),
        row('3', 'new', 'failed'),
        row('4', 'screening', 'completed'),
        row('5', 'reviewed', 'completed'),
        row('6', 'declined'),
      ]),
    ).toEqual({ total: 6, notCalled: 1, notConnected: 1, toReview: 1, onHold: 1, movedForward: 1 });
  });
});

describe('formatJobPeopleSummary', () => {
  it('leads with a named total, then the parts that wait on you, skipping zeros', () => {
    expect(formatJobPeopleSummary({ ...empty, total: 1, notCalled: 1 })).toBe('1 candidate: 1 not called yet');
    expect(formatJobPeopleSummary({ total: 6, notCalled: 2, notConnected: 0, toReview: 1, onHold: 1, movedForward: 1 })).toBe(
      '6 candidates: 1 ready for review, 2 not called yet, 1 on hold, 1 moved forward',
    );
    expect(formatJobPeopleSummary({ ...empty, total: 2 })).toBe('2 candidates');
    expect(formatJobPeopleSummary(empty)).toBe('No candidates yet');
    expect(formatJobPeopleSummary(empty, { one: 'applicant', many: 'applicants' })).toBe('No applicants yet');
  });
});

describe('filterPeopleByJob', () => {
  it('keeps one job when a job is selected', () => {
    const rows = [
      { jobId: 'job-a', fullName: 'Ada' },
      { jobId: 'job-b', fullName: 'Priya' },
    ];
    expect(filterPeopleByJob(rows, 'all')).toHaveLength(2);
    expect(filterPeopleByJob(rows, 'job-b').map((r) => r.fullName)).toEqual(['Priya']);
  });
});

describe('unknown funnels (audit H6)', () => {
  it('claims nothing about a job whose people did not load', () => {
    expect(formatJobPeopleSummary(undefined)).toBe('');
  });
});

describe('homeQueueOf', () => {
  it('follows the backend order: review, then didn’t connect, then on hold, then not called', () => {
    expect(homeQueueOf('screening', 'completed')).toBe('readyForReview');
    expect(homeQueueOf('new', 'failed')).toBe('notConnected');
    expect(homeQueueOf('screening', 'not_called')).toBe('onHold');
    expect(homeQueueOf('new', 'not_called')).toBe('notCalled');
    expect(homeQueueOf('new', undefined)).toBe('notCalled');
  });

  it('leaves out decided people and calls in progress', () => {
    expect(homeQueueOf('reviewed', 'completed')).toBeNull();
    expect(homeQueueOf('declined', 'failed')).toBeNull();
    expect(homeQueueOf('new', 'calling')).toBeNull();
  });
});

describe('homeSnapshotFromLists', () => {
  it('counts before slicing, so totals are true (audit H5)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`c${i}`, 'new'));
    const snapshot = homeSnapshotFromLists([job('a')], 1, [{ job: job('a'), rows }]);
    expect(snapshot.queues?.notCalled.total).toBe(10);
    expect(snapshot.queues?.notCalled.items).toHaveLength(8);
    expect(snapshot.candidates).toBe(10);
  });

  it('puts each person in one queue and names their job', () => {
    const snapshot = homeSnapshotFromLists([job('a'), job('b', 'draft')], 2, [
      { job: job('a'), rows: [row('1', 'new', 'completed'), row('2', 'new', 'failed'), row('3', 'reviewed', 'completed')] },
      { job: job('b', 'draft'), rows: [row('4', 'screening')] },
    ]);
    expect(snapshot.queues?.readyForReview.items.map((i) => i.fullName)).toEqual(['Person 1']);
    expect(snapshot.queues?.notConnected.items[0]).toMatchObject({ jobTitle: 'Job a', failureReason: null });
    expect(snapshot.queues?.onHold.total).toBe(1);
    expect(snapshot.queues?.notCalled.total).toBe(0);
    expect(snapshot).toMatchObject({ agents: 2, jobs: 2, openJobs: 1, firstJobId: 'a', candidates: 4 });
  });

  it('says unknown, not zero, without permission to read candidates', () => {
    const snapshot = homeSnapshotFromLists([job('a', 'closed')], null, null);
    expect(snapshot).toEqual({ agents: null, jobs: 1, openJobs: 0, firstJobId: 'a', candidates: null, queues: null });
  });
});

const summary = (extra: object = {}): HiringSummary => {
  const queue = { total: 0, items: [] };
  return {
    counts: { agents: 1, openJobs: 2, candidates: 7 },
    queues: { readyForReview: queue, notConnected: queue, notCalled: queue, onHold: queue },
    ...extra,
  };
};

describe('homeSnapshotFromSummary', () => {
  it('reads every job and the first open one from the per-job list', () => {
    const snapshot = homeSnapshotFromSummary({
      ...summary(),
      jobs: [
        { jobId: 'd', jobStatus: 'draft' },
        { jobId: 'o', jobStatus: 'open' },
      ],
      totals: { jobs: 3 },
    } as HiringSummary);
    expect(snapshot).toMatchObject({ agents: 1, jobs: 3, openJobs: 2, firstJobId: 'o', candidates: 7 });
  });

  it('falls back to open jobs when the summary has no job list', () => {
    expect(homeSnapshotFromSummary(summary())).toMatchObject({ jobs: 2, firstJobId: null });
  });
});

describe('needsSetup', () => {
  const ready: HomeSnapshot = { agents: 1, jobs: 1, openJobs: 1, firstJobId: 'a', candidates: 1, queues: null };
  it('asks for setup while an agent, a job or a candidate is missing', () => {
    expect(needsSetup(ready)).toBe(false);
    expect(needsSetup({ ...ready, agents: 0 })).toBe(true);
    expect(needsSetup({ ...ready, jobs: 0 })).toBe(true);
    expect(needsSetup({ ...ready, candidates: 0 })).toBe(true);
  });
  it('does not treat a number it can’t see as missing', () => {
    expect(needsSetup({ ...ready, agents: null, candidates: null })).toBe(false);
  });
});

describe('groupQueueByJob', () => {
  it('keeps jobs in order of first appearance', () => {
    const item = (jobId: string, candidateId: string) =>
      ({ jobId, jobTitle: `Job ${jobId}`, candidateId, fullName: candidateId }) as HiringQueueItem;
    const groups = groupQueueByJob([item('b', '1'), item('a', '2'), item('b', '3')]);
    expect(groups.map((g) => [g.jobId, g.items.map((i) => i.candidateId)])).toEqual([
      ['b', ['1', '3']],
      ['a', ['2']],
    ]);
  });
});

describe('fetchHomeSnapshot', () => {
  const all = () => true;
  beforeEach(() => vi.resetAllMocks());

  it('uses the summary when the backend has it', async () => {
    vi.mocked(getHiringSummary).mockResolvedValue(summary());
    await expect(fetchHomeSnapshot(all)).resolves.toMatchObject({ candidates: 7 });
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('loads every job list when the summary is not available (older backends)', async () => {
    vi.mocked(getHiringSummary).mockRejectedValue(new NotAvailableError(404, { code: 'http_error', message: '' }));
    vi.mocked(listJobs).mockResolvedValue({ jobs: [job('a'), job('b')] });
    vi.mocked(listAgents).mockResolvedValue({
      agents: [{ status: 'published' }, { status: 'archived' }] as Awaited<ReturnType<typeof listAgents>>['agents'],
    });
    vi.mocked(listJobCandidates).mockImplementation(async (jobId) => ({
      candidates: jobId === 'a' ? [row('1', 'new', 'completed')] : [],
      nextCursor: null,
      totals: { all: 0, new: 0, screening: 0, reviewed: 0 },
    }));
    const snapshot = await fetchHomeSnapshot(all);
    expect(listJobCandidates).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({ agents: 1, jobs: 2, candidates: 1 });
    expect(snapshot.queues?.readyForReview.total).toBe(1);
  });

  it('skips what the person may not read', async () => {
    vi.mocked(getHiringSummary).mockRejectedValue(new NotAvailableError(404, { code: 'http_error', message: '' }));
    vi.mocked(listJobs).mockResolvedValue({ jobs: [job('a')] });
    const snapshot = await fetchHomeSnapshot((permission) => permission === 'jobs.read');
    expect(listAgents).not.toHaveBeenCalled();
    expect(listJobCandidates).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({ agents: null, candidates: null, queues: null });
  });

  it('fails loudly instead of showing zeros (audit H6)', async () => {
    vi.mocked(getHiringSummary).mockRejectedValue(failure(500));
    await expect(fetchHomeSnapshot(all)).rejects.toBeInstanceOf(ApiClientError);
    expect(listJobs).not.toHaveBeenCalled();
  });
});

const unavailable = () => new NotAvailableError(404, { code: 'http_error', message: '' });
const funnelOf = (total: number): JobFunnel => ({ ...empty, total, notCalled: total });
const summaryOfJobs = (n: number): HiringSummary =>
  summary({
    jobs: Array.from({ length: n }, (_, i) => ({
      jobId: `j${i}`,
      jobTitle: `Job ${i}`,
      jobStatus: 'open',
      funnel: i % 2 ? null : funnelOf(i + 1),
    })),
    totals: { jobs: n },
  });
const jobsOf = (n: number) => Array.from({ length: n }, (_, i) => job(`j${i}`));

describe('fetchHiringPeople', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getHiringSummary).mockRejectedValue(unavailable());
  });

  it('lists a job whose people it may not read, with no funnel', async () => {
    vi.mocked(listJobs).mockResolvedValue({ jobs: [job('a')] });
    vi.mocked(listJobCandidates).mockRejectedValue(failure(403));
    const { jobs, funnels, people } = await fetchHiringPeople();
    expect(jobs).toHaveLength(1);
    expect(funnels).toEqual({});
    expect(people).toEqual([]);
  });

  it('fails the load when a job’s people fail to load (audit H6)', async () => {
    vi.mocked(listJobs).mockResolvedValue({ jobs: [job('a')] });
    vi.mocked(listJobCandidates).mockRejectedValue(failure(500));
    await expect(fetchHiringPeople()).rejects.toBeInstanceOf(ApiClientError);
  });

  it('takes funnels from the summary, whole even while a search narrows the rows', async () => {
    vi.mocked(getHiringSummary).mockResolvedValue(summaryOfJobs(1));
    vi.mocked(listJobs).mockResolvedValue({ jobs: jobsOf(1) });
    vi.mocked(listJobCandidates).mockResolvedValue({
      candidates: [row('1', 'new')],
      nextCursor: null,
      totals: { all: 0, new: 0, screening: 0, reviewed: 0 },
    });
    const { funnels, people } = await fetchHiringPeople('ada');
    expect(funnels).toEqual({ j0: funnelOf(1) });
    expect(people).toHaveLength(1);
  });
});

describe('fetchJobsOverview: a fixed number of requests (audit H8)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([1, 30])('makes 2 requests for %i jobs and none per job', async (n) => {
    vi.mocked(getHiringSummary).mockResolvedValue(summaryOfJobs(n));
    vi.mocked(listJobs).mockResolvedValue({ jobs: jobsOf(n) });
    const { jobs, funnels } = await fetchJobsOverview();
    expect(jobs).toHaveLength(n);
    expect(listJobs).toHaveBeenCalledTimes(1);
    expect(getHiringSummary).toHaveBeenCalledTimes(1);
    expect(listJobCandidates).not.toHaveBeenCalled();
    // Jobs whose people can't be read have no funnel (null in the summary).
    expect(Object.keys(funnels)).toHaveLength(Math.ceil(n / 2));
    expect(funnels['j0']).toEqual(funnelOf(1));
  });

  it('shares one summary request with Home when both load together', async () => {
    vi.mocked(getHiringSummary).mockResolvedValue(summaryOfJobs(3));
    vi.mocked(listJobs).mockResolvedValue({ jobs: jobsOf(3) });
    await Promise.all([fetchJobsOverview(), fetchHomeSnapshot(() => true)]);
    expect(getHiringSummary).toHaveBeenCalledTimes(1);
  });

  it('counts from the lists only where the backend has no summary', async () => {
    vi.mocked(getHiringSummary).mockRejectedValue(unavailable());
    vi.mocked(listJobs).mockResolvedValue({ jobs: jobsOf(2) });
    vi.mocked(listJobCandidates).mockResolvedValue({
      candidates: [row('1', 'new')],
      nextCursor: null,
      totals: { all: 0, new: 0, screening: 0, reviewed: 0 },
    });
    const { funnels } = await fetchJobsOverview();
    expect(listJobCandidates).toHaveBeenCalledTimes(2);
    expect(funnels['j1']).toEqual(funnelOf(1));
  });

  it('fails on a real error rather than guessing', async () => {
    vi.mocked(getHiringSummary).mockRejectedValue(failure(500));
    vi.mocked(listJobs).mockResolvedValue({ jobs: jobsOf(1) });
    await expect(fetchJobsOverview()).rejects.toBeInstanceOf(ApiClientError);
    expect(listJobCandidates).not.toHaveBeenCalled();
  });
});
