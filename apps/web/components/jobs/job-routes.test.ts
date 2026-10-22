import { describe, expect, it } from 'vitest';
import { legacyBoardPath, openingPath } from './job-routes';

describe('old job URLs', () => {
  it('sends the old candidates board to People, keeping its params', () => {
    expect(legacyBoardPath('j1', {})).toBe('/jobs/j1/people');
    expect(legacyBoardPath('j1', { c: 'p9', stage: 'new' })).toBe('/jobs/j1/people?c=p9&stage=new');
  });

  it('sends answered or fit-lane links to Review with the same filter', () => {
    expect(legacyBoardPath('j1', { stage: 'reviewed', lane: 'meets_all' })).toBe(
      '/jobs/j1/review?stage=reviewed&lane=meets_all',
    );
    expect(legacyBoardPath('j1', { fit: 'check' })).toBe('/jobs/j1/review?fit=check');
    expect(legacyBoardPath('j1', { stage: ['reviewed', 'x'] })).toMatch(/^\/jobs\/j1\/review/);
  });

  it('opens a Draft job on Set up and the rest on People, keeping the query', () => {
    expect(openingPath('j1', 'draft', {})).toBe('/jobs/j1/setup');
    expect(openingPath('j1', 'open', { c: 'p9' })).toBe('/jobs/j1/people?c=p9');
    expect(openingPath('j1', 'closed', {})).toBe('/jobs/j1/people');
    expect(openingPath('j1', null, {})).toBe('/jobs/j1/people');
  });
});
