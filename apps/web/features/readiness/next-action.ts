import type { Readiness } from '../../components/jobs/setup';

export type JobTabKey = 'setup' | 'people' | 'review';
export type JobStatus = 'draft' | 'open' | 'closed';
export interface NextAction {
  label: string;
  href: string;
  tab: JobTabKey;
}
export interface JobCounts {
  people: number;
  /** People whose call ended with answers. */
  answered: number;
  /** Answered people nobody has decided on yet. */
  undecided: number;
}

export const ALL_CAUGHT_UP = 'All caught up';

/** A Draft job opens on Set up, every other job on People. Stateless: no cookie, no memory. */
export const openingTab = (status: JobStatus | string): 'setup' | 'people' => (status === 'draft' ? 'setup' : 'people');

/** The one thing to do next on a job, in priority order. `jobId` is the id used in URLs. */
export function nextAction(r: Readiness, counts: JobCounts, jobId = ''): NextAction {
  const to = (label: string, tab: JobTabKey): NextAction => ({ label, href: `/jobs/${jobId}/${tab}`, tab });
  if (r.description === 'missing') return to('Add the job description', 'setup');
  if (r.description === 'preparing' || r.agent !== 'live') return to('Finish setting up the call', 'setup');
  if (counts.people === 0) return to('Add people', 'people');
  if (counts.answered > 0 && counts.undecided > 0) {
    return to(`Review ${counts.undecided} ${counts.undecided === 1 ? 'answer' : 'answers'}`, 'review');
  }
  if (counts.people > counts.answered) return to('Start calling', 'people');
  return to(ALL_CAUGHT_UP, 'people');
}
