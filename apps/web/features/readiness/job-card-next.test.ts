import { describe, expect, it } from 'vitest';
import type { Job } from '../../lib/api';
import type { JobFunnel } from '../../lib/hiring-people';
import { toPublicId } from '../../lib/public-id';
import { jobReadiness } from '../../components/jobs/setup';
import { jobCardNext } from './job-card-next';
import { nextAction } from './next-action';

const base: Job = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Warehouse supervisor',
  description: '',
  status: 'draft',
  agentId: null,
  screeningQuestions: [],
  screeningLanguage: 'en',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  hasJdDocs: false,
};
const id = toPublicId(base.id);
const ready: Job = { ...base, status: 'open', description: 'Run the night shift.', agentId: 'a1' };
const live = [{ id: 'a1', status: 'published' }];
const funnel = (f: Partial<JobFunnel>): JobFunnel => ({ total: 0, notCalled: 0, notConnected: 0, toReview: 0, onHold: 0, movedForward: 0, ...f });

describe('jobCardNext', () => {
  it('draft without a description: Add the job description', () => {
    expect(jobCardNext(base, { agents: undefined, funnel: undefined })?.label).toBe('Add the job description');
  });
  it('agent not live: Finish setting up the call', () => {
    const r = jobCardNext(ready, { agents: [{ id: 'a1', status: 'draft' }], funnel: funnel({ total: 3 }) });
    expect(r?.label).toBe('Finish setting up the call');
    expect(r?.href).toBe(`/jobs/${id}/setup`);
  });
  it('no people: Add people', () => {
    expect(jobCardNext(ready, { agents: live, funnel: funnel({}) })?.label).toBe('Add people');
  });
  it('undecided answers: Review N answers', () => {
    const r = jobCardNext(ready, { agents: live, funnel: funnel({ total: 6, notCalled: 2, toReview: 3 }) });
    expect(r?.label).toBe('Review 3 answers');
    expect(r?.href).toBe(`/jobs/${id}/review`);
  });
  it('calls that did not connect: Retry N calls, after review and before calling', () => {
    expect(jobCardNext(ready, { agents: live, funnel: funnel({ total: 9, notCalled: 2, notConnected: 5 }) })?.label).toBe(
      "Retry 5 calls that didn't connect",
    );
    expect(jobCardNext(ready, { agents: live, funnel: funnel({ total: 9, notConnected: 1 }) })?.label).toBe(
      "Retry 1 call that didn't connect",
    );
    expect(jobCardNext(ready, { agents: live, funnel: funnel({ total: 9, notConnected: 5, toReview: 1 }) })?.label).toBe(
      'Review 1 answer',
    );
  });
  it('the card and the job banner read one funnel, so they say the same thing, exact above 100', () => {
    const f = funnel({ total: 400, notCalled: 120, notConnected: 5, toReview: 130 });
    const r = jobReadiness(ready, [], true, 'connected');
    expect(jobCardNext(ready, { agents: live, funnel: f })).toEqual(nextAction(r, f, id));
    expect(nextAction(r, f, id).label).toBe('Review 130 answers');
    const retry = funnel({ total: 400, notConnected: 5 });
    expect(jobCardNext(ready, { agents: live, funnel: retry })).toEqual(nextAction(r, retry, id));
    expect(nextAction(r, retry, id).label).toBe("Retry 5 calls that didn't connect");
  });
  it('not called: Start calling', () => {
    expect(jobCardNext(ready, { agents: live, funnel: funnel({ total: 4, notCalled: 4 }) })?.label).toBe('Start calling');
  });
  it('everyone called and decided: All caught up', () => {
    expect(jobCardNext(ready, { agents: live, funnel: funnel({ total: 2, movedForward: 2 }) })?.label).toBe('All caught up');
  });
  it('missing agents or funnel: Open the job, never nothing', () => {
    for (const ctx of [
      { agents: undefined, funnel: funnel({ total: 1 }) },
      { agents: live, funnel: undefined },
    ]) {
      const r = jobCardNext(ready, ctx);
      expect(r?.label).toBe('Open the job');
      expect(r?.href).toBe(`/jobs/${id}`);
    }
  });
  it('closed job: null', () => {
    expect(jobCardNext({ ...ready, status: 'closed' }, { agents: live, funnel: funnel({ total: 1 }) })).toBeNull();
  });
});
