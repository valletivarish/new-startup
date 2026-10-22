import type { HiringQueueItem } from '../../lib/api';
import type { HomeSnapshot } from '../../lib/hiring-people';
import { toPublicId } from '../../lib/public-id';
import type { callGate } from '../../components/home/copy';

export type Task = {
  kind: 'review' | 'retry' | 'not-called' | 'clear' | 'note';
  text: string;
  /** The link-button's label; absent on "All caught up." */
  action?: string;
  href?: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Jobs seen in the rows, most rows first. */
function jobsByCount(items: readonly HiringQueueItem[]): { jobId: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const { jobId } of items) counts.set(jobId, (counts.get(jobId) ?? 0) + 1);
  return [...counts].map(([jobId, n]) => ({ jobId, n })).sort((x, y) => y.n - x.n);
}

/**
 * Needs you in at most three lines, in the order a recruiter acts: answers to decide, calls that
 * didn't connect, people not called. The summary lists only the first rows of each queue, so the
 * job is known only from those rows: when they are fewer than the total, a single job in view is
 * not proof that every answer is on it (ponytail: the summary would need per-job counts to be exact).
 * The calling-number note comes last, once, only when the number isn't connected.
 */
export function needsYouTasks(snapshot: HomeSnapshot, gate: ReturnType<typeof callGate> = 'ready'): Task[] {
  const q = snapshot.queues;
  if (!q) return [];
  const lines: Task[] = [];

  const review = q.readyForReview;
  if (review.total > 0) {
    const jobs = jobsByCount(review.items);
    const complete = review.items.length >= review.total;
    const top = jobs[0];
    lines.push({
      kind: 'review',
      text:
        `Review ${plural(review.total, 'answer', 'answers')}` + (jobs.length > 1 ? ` across ${jobs.length} jobs` : ''),
      action: 'Review',
      href: top && (complete || jobs.length > 1) ? `/jobs/${toPublicId(top.jobId)}/review` : '/people?stage=review',
    });
  }

  if (q.notConnected.total > 0) {
    lines.push({
      kind: 'retry',
      text: `${plural(q.notConnected.total, 'call', 'calls')} didn’t connect`,
      action: 'Retry',
      href: '/people?stage=retry',
    });
  }

  if (q.notCalled.total > 0) {
    const top = jobsByCount(q.notCalled.items)[0];
    lines.push({
      kind: 'not-called',
      text: `${plural(q.notCalled.total, 'person', 'people')} not called yet`,
      action: 'See who',
      href: top ? `/jobs/${toPublicId(top.jobId)}/people?stage=new` : '/people?stage=new',
    });
  }

  if (lines.length === 0) return [{ kind: 'clear', text: 'All caught up.' }];
  const tasks = lines.slice(0, 3);
  if (gate === 'no-line') {
    tasks.push({
      kind: 'note',
      text: 'Phone calls start once your calling number is set up.',
      action: 'Set it up',
      href: '/settings/calling',
    });
  }
  return tasks;
}
