import { describe, expect, it } from 'vitest';
import { HIRING_USE_CASE } from './use-cases';

describe('HIRING_USE_CASE', () => {
  it('is HRVoice with hiring nouns', () => {
    expect(HIRING_USE_CASE).toMatchObject({
      id: 'hiring',
      moduleName: 'HRVoice',
      live: true,
      labels: {
        workItem: { one: 'Job', many: 'Jobs' },
        contact: { one: 'Candidate', many: 'Candidates' },
        agentDefaultName: 'Hiring agent',
      },
    });
  });

  it('has the four stages, with decisions closing the queue', () => {
    expect(HIRING_USE_CASE.stages).toEqual([
      { value: 'new', label: 'No decision yet', family: 'queued', glyph: 'Clock', closing: false },
      { value: 'screening', label: 'On hold', family: 'decided', glyph: 'CirclePause', closing: false },
      { value: 'reviewed', label: 'Moved forward', family: 'decided', glyph: 'CircleCheck', closing: true },
      { value: 'declined', label: 'Not moving forward', family: 'decided', glyph: 'CircleX', closing: true },
    ]);
  });
});
