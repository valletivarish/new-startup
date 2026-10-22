import { describe, expect, it } from 'vitest';
import type { Job } from '../../lib/api';
import type { JobFunnel } from '../../lib/hiring-people';
import { toPublicId } from '../../lib/public-id';
import { jobCardNext } from './job-card-next';

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
const funnel = (f: Partial<JobFunnel>): JobFunnel => ({ total: 0, notCalled: 0, toReview: 0, onHold: 0, movedForward: 0, ...f });

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
