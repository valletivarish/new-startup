import { describe, expect, it } from 'vitest';
import type { Readiness } from '../../components/jobs/setup';
import { nextAction, openingTab } from './next-action';

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
const none = { people: 0, answered: 0, undecided: 0 };

describe('nextAction', () => {
  it('asks for the description first', () => {
    const n = nextAction({ ...ok, description: 'missing', ready: false, phoneReady: false }, none, 'abc');
    expect(n).toEqual({ label: 'Add the job description', href: '/jobs/abc/setup', tab: 'setup' });
  });

  it('then for a live agent', () => {
    const n = nextAction(
      { ...ok, agent: 'not-live', ready: false, phoneReady: false },
      { people: 5, answered: 2, undecided: 2 },
      'abc',
    );
    expect(n).toMatchObject({ label: 'Finish setting up the call', tab: 'setup' });
  });

  it('then for people', () => {
    expect(nextAction(ok, none, 'abc')).toEqual({ label: 'Add people', href: '/jobs/abc/people', tab: 'people' });
  });

  it('then for answers to review, ahead of calling', () => {
    expect(nextAction(ok, { people: 10, answered: 4, undecided: 3 }, 'abc')).toEqual({
      label: 'Review 3 answers',
      href: '/jobs/abc/review',
      tab: 'review',
    });
    expect(nextAction(ok, { people: 10, answered: 1, undecided: 1 }, 'abc').label).toBe('Review 1 answer');
  });

  it('then for calling people who have not been called', () => {
    expect(nextAction(ok, { people: 10, answered: 4, undecided: 0 }, 'abc')).toMatchObject({
      label: 'Start calling',
      tab: 'people',
    });
  });

  it('otherwise says all caught up', () => {
    expect(nextAction(ok, { people: 4, answered: 4, undecided: 0 }, 'abc')).toMatchObject({
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
});
