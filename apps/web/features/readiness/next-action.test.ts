import { describe, expect, it } from 'vitest';
import type { Readiness } from '../../components/jobs/setup';
import { nextAction, noAnswersYet, openingTab } from './next-action';

const ok: Readiness = {
  description: 'saved',
  questions: 3,
  requirements: 2,
  agent: 'live',
  line: 'connected',
  status: 'open',
  ready: true,
  phoneReady: true,
};
const none = { total: 0, notCalled: 0, notConnected: 0, toReview: 0 };
const counts = (c: Partial<typeof none>) => ({ ...none, ...c });

describe('nextAction', () => {
  it('asks for the description first', () => {
    const n = nextAction({ ...ok, description: 'missing', ready: false, phoneReady: false }, none, 'abc');
    expect(n).toEqual({ label: 'Add the job description', href: '/jobs/abc/setup', tab: 'setup' });
  });

  it('then for a live agent', () => {
    const n = nextAction(
      { ...ok, agent: 'not-live', ready: false, phoneReady: false },
      counts({ total: 5, toReview: 2 }),
      'abc',
    );
    expect(n).toMatchObject({ label: 'Finish setting up the call', tab: 'setup' });
  });

  it('then for people', () => {
    expect(nextAction(ok, none, 'abc')).toEqual({ label: 'Add people', href: '/jobs/abc/people', tab: 'people' });
  });

  it('then for answers to review, ahead of calling', () => {
    expect(nextAction(ok, counts({ total: 10, notCalled: 6, toReview: 3 }), 'abc')).toEqual({
      label: 'Review 3 answers',
      href: '/jobs/abc/review',
      tab: 'review',
    });
    expect(nextAction(ok, counts({ total: 10, toReview: 1 }), 'abc').label).toBe('Review 1 answer');
  });

  it('then for retrying calls that did not connect, ahead of calling', () => {
    expect(nextAction(ok, counts({ total: 10, notCalled: 3, notConnected: 5 }), 'abc')).toEqual({
      label: "Retry 5 calls that didn't connect",
      href: '/jobs/abc/people',
      tab: 'people',
    });
  });

  it('counts above 100 are exact', () => {
    expect(nextAction(ok, counts({ total: 900, toReview: 340 }), 'abc').label).toBe('Review 340 answers');
  });

  it('then for calling people who have not been called', () => {
    expect(nextAction(ok, counts({ total: 10, notCalled: 6 }), 'abc')).toMatchObject({
      label: 'Start calling',
      tab: 'people',
    });
  });

  it('otherwise says all caught up', () => {
    expect(nextAction(ok, counts({ total: 4 }), 'abc')).toMatchObject({
      label: 'All caught up',
      tab: 'people',
    });
  });
});

describe('openingTab', () => {
  it('opens a draft on Set up and every other job on People', () => {
    expect(openingTab('draft')).toBe('setup');
    expect(openingTab('open')).toBe('people');
    expect(openingTab('closed')).toBe('people');
  });

  it('Review is empty only when the exact funnel has nothing to review', () => {
    expect(noAnswersYet(counts({ total: 3 }))).toBe(true);
    expect(noAnswersYet(counts({ total: 250, notCalled: 250 }))).toBe(true);
    expect(noAnswersYet(counts({ total: 3, toReview: 1 }))).toBe(false);
    expect(noAnswersYet(undefined)).toBe(false);
  });
});
