import { describe, expect, it } from 'vitest';
import { hasJobDescription, jobReadiness, jobStatusLabel, lineState, readinessLine, sameQuestions } from './setup';

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
    const r = jobReadiness({ ...job, description: longText }, [], true, 'connected');
    expect(r.ready).toBe(true);
    expect(r.phoneReady).toBe(true);
    expect(readinessLine(r)).toBe('Ready for calls.');
    expect(readinessLine({ ...r, status: 'draft' })).toBe('Set up for calls. Make the job active when you start calling.');
  });

  it('never says ready for calls while the calling number isn’t connected', () => {
    const r = jobReadiness({ ...job, description: longText }, [], true, lineState(false));
    expect(r.ready).toBe(true);
    expect(r.phoneReady).toBe(false);
    expect(readinessLine(r)).toBe(
      'Phone calls start once your calling number is connected. Test calls in your browser work now.',
    );
    expect(jobStatusLabel(r)).toBe('Active · browser test calls only');
    expect(jobStatusLabel({ ...r, line: 'connected' })).toBeNull();
    expect(readinessLine(jobReadiness({ ...job, description: longText }, [], true, lineState(null)))).toBeNull();
    expect(lineState(undefined, true)).toBe('unknown');
  });

  it('names every missing step', () => {
    expect(readinessLine(jobReadiness({ ...job, agentId: null }, [], null, 'connected'))).toBe(
      'Before calling, add the job description and choose the AI hiring agent.',
    );
    expect(readinessLine(jobReadiness(job, [{ readyDocs: 0, pendingDocs: 1 }], false, 'connected'))).toBe(
      'Before calling, wait for the description file to be read and publish the AI hiring agent.',
    );
  });

  it('says nothing while the agent is being checked', () => {
    expect(readinessLine(jobReadiness(job, [], null, 'connected'))).toBeNull();
  });

  it('compares questions as they will be saved', () => {
    expect(sameQuestions([' Notice period? ', ''], ['Notice period?'])).toBe(true);
    expect(sameQuestions(['A', 'B'], ['B', 'A'])).toBe(false);
  });
});
