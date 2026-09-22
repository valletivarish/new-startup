import { describe, expect, it } from 'vitest';
import { computeFitPercent } from '../src/hiring/fit-percent.js';

describe('computeFitPercent', () => {
  it('returns null when there are no criteria', () => {
    expect(computeFitPercent([], { a: '1' })).toBeNull();
    expect(computeFitPercent([], null)).toBeNull();
  });

  it('scores answered must-ask keys by label slug', () => {
    const criteria = [
      { id: 'q1', label: 'How many years of relevant experience?' },
      { id: 'q2', label: 'What is your notice period?' },
    ];
    expect(
      computeFitPercent(criteria, {
        how_many_years_of_relevant_experience: '5',
        what_is_your_notice_period: '',
      }),
    ).toBe(50);
    expect(
      computeFitPercent(criteria, {
        how_many_years_of_relevant_experience: '5',
        what_is_your_notice_period: '30 days',
      }),
    ).toBe(100);
  });

  it('treats missing answers as unanswered', () => {
    expect(
      computeFitPercent([{ id: 'q1', label: 'City?' }], {}),
    ).toBe(0);
  });

  it('withholds the score until answers land', () => {
    expect(
      computeFitPercent([{ id: 'q1', label: 'City?' }], null),
    ).toBeNull();
    expect(
      computeFitPercent([{ id: 'q1', label: 'City?' }], undefined),
    ).toBeNull();
  });
});
