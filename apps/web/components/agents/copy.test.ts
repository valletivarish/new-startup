import { describe, expect, it } from 'vitest';
import { STATE_MAP } from '../../lib/status-labels';
import { HIRING_USE_CASE } from '../../lib/use-case-definitions';
import { agentStateCopy } from './copy';

describe('agentStateCopy', () => {
  it('has words for every agent state the status map knows', () => {
    for (const status of Object.keys(STATE_MAP.agent)) {
      expect(agentStateCopy(status, HIRING_USE_CASE.labels).title).not.toBe('State unknown');
    }
  });

  it('speaks in the use case’s nouns and never shows a raw value', () => {
    expect(agentStateCopy('published', HIRING_USE_CASE.labels).line).toBe(
      'It calls candidates for the jobs that use it.',
    );
    expect(agentStateCopy('mystery_state', HIRING_USE_CASE.labels).line).not.toContain('mystery');
  });
});
