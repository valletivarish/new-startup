import { describe, expect, it } from 'vitest';
import { hasJobDescription, jobReadiness, readinessLine, sameQuestions } from './setup';

const job = {
  description: '',
  hasJdDocs: false,
  agentId: 'agent-1',
  status: 'open',
  screeningQuestions: [{ id: 'q1', label: 'Notice period?' }],
};
const longText = 'Warehouse supervisor, Chakan. Runs a shift of 30.';

describe('job readiness', () => {
  it('counts saved text of 20+ characters or attached files as the description', () => {
    expect(hasJobDescription({ description: 'Too short', hasJdDocs: false })).toBe(false);
    expect(hasJobDescription({ description: longText, hasJdDocs: false })).toBe(true);
    expect(hasJobDescription({ description: '', hasJdDocs: true })).toBe(true);
  });

  it('is ready once the description is in and the agent is live', () => {
    const r = jobReadiness({ ...job, description: longText }, [], true);
    expect(r.ready).toBe(true);
    expect(readinessLine(r)).toBe('Ready for calls.');
    expect(readinessLine({ ...r, status: 'draft' })).toBe('Set up for calls. Open the job when you start calling.');
  });

  it('names every missing step', () => {
    expect(readinessLine(jobReadiness({ ...job, agentId: null }, [], null))).toBe(
      'Before calling, add the job description and choose the AI hiring agent.',
    );
    expect(readinessLine(jobReadiness(job, [{ readyDocs: 0, pendingDocs: 1 }], false))).toBe(
      'Before calling, wait for the description file to be read and publish the AI hiring agent.',
    );
  });

  it('says nothing while the agent is being checked', () => {
    expect(readinessLine(jobReadiness(job, [], null))).toBeNull();
  });

  it('compares questions as they will be saved', () => {
    expect(sameQuestions([' Notice period? ', ''], ['Notice period?'])).toBe(true);
    expect(sameQuestions(['A', 'B'], ['B', 'A'])).toBe(false);
  });
});
