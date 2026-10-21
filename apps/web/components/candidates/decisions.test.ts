import { describe, expect, it } from 'vitest';
import { decisionDone, decisionLabel, isStage, moveTotals, noConnectReason } from './decisions';

const STAGES = [
  { value: 'new', label: 'No decision yet' },
  { value: 'screening', label: 'On hold' },
  { value: 'reviewed', label: 'Moved forward' },
  { value: 'declined', label: 'Not moving forward' },
];

describe('decisions', () => {
  it('reads the stage in the use case’s words, and no stage as undecided', () => {
    expect(decisionLabel('new', STAGES)).toBe('No decision yet');
    expect(decisionLabel(null, STAGES)).toBe('No decision yet');
    expect(decisionLabel('screening', STAGES)).toBe('On hold');
    expect(decisionLabel('archived', STAGES)).toBe('Unknown');
  });

  it('says what a decision did, for one person or many', () => {
    expect(decisionDone('reviewed', 'Priya Deshmukh')).toBe('Moved Priya Deshmukh forward');
    expect(decisionDone('screening', '3 candidates')).toBe('Put 3 candidates on hold');
    expect(decisionDone('declined', 'Rahul Patil')).toBe('Marked Rahul Patil as not moving forward');
    expect(decisionDone('new', 'Sneha Kulkarni')).toBe('Cleared the decision for Sneha Kulkarni');
  });

  it('knows the four stages only', () => {
    expect(isStage('declined')).toBe(true);
    expect(isStage('ready')).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });

  it('moves counts between stages and never below zero', () => {
    const totals = { all: 5, new: 3, screening: 1, reviewed: 1 };
    expect(moveTotals(totals, [{ from: 'new', to: 'reviewed' }, { from: 'screening', to: 'declined' }])).toEqual({
      all: 5,
      new: 2,
      screening: 0,
      reviewed: 2,
      declined: 1,
    });
    expect(moveTotals({ all: 0, new: 0, screening: 0, reviewed: 0 }, [{ from: 'new', to: 'screening' }]).new).toBe(0);
  });
});

describe('noConnectReason', () => {
  it('names why a call never connected, and stays out of the way when it did', () => {
    expect(noConnectReason('failed', 'no_answer')).toBe('Didn’t answer');
    expect(noConnectReason('failed', 'busy')).toBe('Number busy');
    expect(noConnectReason('failed', 'carrier_blocked')).toBe('Couldn’t connect');
    expect(noConnectReason('failed', null)).toBe('Couldn’t connect');
    expect(noConnectReason('completed', null)).toBeNull();
    expect(noConnectReason('not_called', null)).toBeNull();
  });
});
