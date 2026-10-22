import { describe, expect, it } from 'vitest';
import type { HiringQueueItem } from '../../lib/api';
import type { HomeSnapshot } from '../../lib/hiring-people';
import { toPublicId } from '../../lib/public-id';
import { needsYouTasks } from './needs-you-tasks';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const item = (jobId: string, n: number): HiringQueueItem => ({
  jobId,
  jobTitle: jobId === A ? 'Warehouse' : 'Driver',
  candidateId: `c${n}`,
  fullName: `P${n}`,
  stage: 'new',
  callStatus: 'not_called',
});
const queue = (jobIds: string[], total = jobIds.length) => ({ total, items: jobIds.map((j, i) => item(j, i)) });
type Queues = Partial<Record<'readyForReview' | 'notConnected' | 'notCalled' | 'onHold', ReturnType<typeof queue>>>;
const snap = (q: Queues): HomeSnapshot => ({
  agents: 1,
  jobs: 2,
  openJobs: 2,
  firstJobId: A,
  candidates: 9,
  queues: {
    readyForReview: queue([]),
    notConnected: queue([]),
    notCalled: queue([]),
    onHold: queue([]),
    ...q,
  },
});
const a = toPublicId(A);
const b = toPublicId(B);

describe('needsYouTasks', () => {
  it('says all caught up when nothing needs doing, with no calling note', () => {
    expect(needsYouTasks(snap({ onHold: queue([A]) }), 'no-line')).toEqual([{ kind: 'clear', text: 'All caught up.' }]);
  });

  it('orders answers, calls that did not connect, people not called', () => {
    const tasks = needsYouTasks(
      snap({ notCalled: queue([A, A, A]), notConnected: queue([A, A]), readyForReview: queue([A, A, A]) }),
      'ready',
    );
    expect(tasks.map((t) => t.kind)).toEqual(['review', 'retry', 'not-called']);
    expect(tasks.map((t) => t.text)).toEqual(['Review 3 answers', '2 calls didn’t connect', '3 people not called yet']);
  });

  it('sends answers on one job straight to its review page', () => {
    const [t] = needsYouTasks(snap({ readyForReview: queue([A]) }), 'ready');
    expect(t).toMatchObject({ text: 'Review 1 answer', href: `/jobs/${a}/review` });
  });

  it('says across 2 jobs and opens the job with the most', () => {
    const [t] = needsYouTasks(snap({ readyForReview: queue([A, B, B]) }), 'ready');
    expect(t).toMatchObject({ text: 'Review 3 answers across 2 jobs', href: `/jobs/${b}/review` });
  });

  it('uses the true total, and goes to People when the rows in view may not be every job', () => {
    const [t] = needsYouTasks(snap({ readyForReview: queue([A, A], 12) }), 'ready');
    expect(t).toMatchObject({ text: 'Review 12 answers', href: '/people?stage=review' });
  });

  it('links calls that did not connect to the filtered People list and not-called to the job', () => {
    const tasks = needsYouTasks(snap({ notConnected: queue([A, B]), notCalled: queue([B]) }), 'ready');
    expect(tasks[0]).toMatchObject({ href: '/people?stage=retry' });
    expect(tasks[1]).toMatchObject({ text: '1 person not called yet', href: `/jobs/${b}/people?stage=new` });
  });

  it('never returns more than three lines', () => {
    const tasks = needsYouTasks(
      snap({ readyForReview: queue([A]), notConnected: queue([A]), notCalled: queue([A]), onHold: queue([A]) }),
      'no-line',
    );
    expect(tasks.filter((t) => t.kind !== 'note')).toHaveLength(3);
  });

  it('adds the calling-number note once, only when the number is not connected', () => {
    const q = snap({ notCalled: queue([A]), notConnected: queue([A]) });
    const notes = (g: Parameters<typeof needsYouTasks>[1]) => needsYouTasks(q, g).filter((t) => t.kind === 'note');
    expect(notes('no-line')).toEqual([
      {
        kind: 'note',
        text: 'Phone calls start once your calling number is set up.',
        action: 'Set it up',
        href: '/settings/calling',
      },
    ]);
    expect(notes('ready')).toEqual([]);
    expect(notes('checking')).toEqual([]);
    expect(notes('hidden')).toEqual([]);
  });

  it('is empty when the person cannot see candidates', () => {
    expect(needsYouTasks({ ...snap({}), queues: null }, 'ready')).toEqual([]);
  });
});
