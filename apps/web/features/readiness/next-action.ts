import type { Readiness } from '../../components/jobs/setup';
import type { JobFunnel } from '../../lib/hiring-people';

export type JobTabKey = 'setup' | 'people' | 'review';
export type JobStatus = 'draft' | 'open' | 'closed';
export interface NextAction {
  label: string;
  href: string;
  tab: JobTabKey;
}
/** The per-job funnel from GET /hiring/summary: the one source for the card, the banner and the tabs. */
export type JobCounts = Pick<JobFunnel, 'total' | 'notCalled' | 'notConnected' | 'toReview'>;

/** Nobody has an answer to read: Review is empty. Exact, whatever the size of the job. */
export function noAnswersYet(counts: JobCounts | undefined): boolean {
  return counts !== undefined && counts.toReview === 0;
}

export const ALL_CAUGHT_UP = 'All caught up';

/** A Draft job opens on Set up, every other job on People. Stateless: no cookie, no memory. */
export const openingTab = (status: JobStatus | string): 'setup' | 'people' => (status === 'draft' ? 'setup' : 'people');

/** The one thing to do next on a job, in priority order. `jobId` is the id used in URLs. */
export function nextAction(r: Readiness, counts: JobCounts, jobId = ''): NextAction {
  const to = (label: string, tab: JobTabKey): NextAction => ({ label, href: `/jobs/${jobId}/${tab}`, tab });
  if (r.description === 'missing') return to('Add the job description', 'setup');
  if (r.description === 'preparing' || r.agent !== 'live') return to('Finish setting up the call', 'setup');
  if (counts.total === 0) return to('Add people', 'people');
  if (counts.toReview > 0) return to(`Review ${counts.toReview} ${counts.toReview === 1 ? 'answer' : 'answers'}`, 'review');
  if (counts.notConnected > 0) {
    return to(`Retry ${counts.notConnected} ${counts.notConnected === 1 ? 'call' : 'calls'} that didn't connect`, 'people');
  }
  if (counts.notCalled > 0) return to('Start calling', 'people');
  return to(ALL_CAUGHT_UP, 'people');
}
