import { describe, expect, it } from 'vitest';
import {
  BULK_CONFIRM_AT,
  defaultCallFor,
  defaultStageFor,
  needsTypedConfirm,
  peopleListFilters,
} from './people-filters';

describe('people filters', () => {
  it('Review asks the server for answered, undecided people; People for everyone', () => {
    const review = peopleListFilters({ stage: defaultStageFor('review'), fit: 'all', call: defaultCallFor('review'), q: '' });
    expect(review).toEqual({ status: 'new', fit: undefined, call: 'completed', q: undefined });
    const people = peopleListFilters({ stage: defaultStageFor('people'), fit: 'all', call: defaultCallFor('people'), q: ' ' });
    expect(people).toEqual({ status: undefined, fit: undefined, call: undefined, q: undefined });
  });

  it('asks for the typed confirmation at 24 people and not at 23', () => {
    expect(BULK_CONFIRM_AT).toBe(24);
    expect(needsTypedConfirm(23)).toBe(false);
    expect(needsTypedConfirm(24)).toBe(true);
  });
});
