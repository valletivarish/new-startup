import { describe, expect, it } from 'vitest';
import { HIRING_USE_CASE, mergeUseCase } from './use-cases';

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

describe('mergeUseCase', () => {
  it('takes the server words and keeps our stage colours and glyphs', () => {
    const merged = mergeUseCase(HIRING_USE_CASE, {
      id: 'hiring',
      displayName: 'HRVoice',
      workUnit: { label: 'Role', pluralLabel: 'Roles' },
      contact: { label: 'Applicant', pluralLabel: 'Applicants' },
      stages: [
        { key: 'new', label: 'Not called yet' },
        { key: 'screening', label: 'Paused' },
        { key: 'interview', label: 'Interview' },
      ],
    });
    expect(merged.labels.workItem).toEqual({ one: 'Role', many: 'Roles' });
    expect(merged.labels.contact).toEqual({ one: 'Applicant', many: 'Applicants' });
    expect(merged.labels.agentDefaultName).toBe('Hiring agent');
    // The undecided stage keeps "No decision yet": the server's word is a call's state.
    expect(merged.stages.map((s) => s.label)).toEqual(['No decision yet', 'Paused', 'Moved forward', 'Not moving forward']);
    expect(merged.stages[1]).toMatchObject({ family: 'decided', glyph: 'CirclePause', closing: false });
    expect(merged.stages).toHaveLength(4);
  });

  it('a sparse server entry changes nothing', () => {
    expect(mergeUseCase(HIRING_USE_CASE, { id: 'hiring' })).toEqual(HIRING_USE_CASE);
    const partial = { id: 'hiring', displayName: '', workUnit: { label: 'Role' } } as Parameters<typeof mergeUseCase>[1];
    expect(mergeUseCase(HIRING_USE_CASE, partial)).toEqual(HIRING_USE_CASE);
  });
});
