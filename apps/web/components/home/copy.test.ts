import { describe, expect, it } from 'vitest';
import { callGate, firstNameOf, greetingFor, namesLine } from './copy';

describe('greetingFor', () => {
  it('follows the local hour', () => {
    expect(greetingFor(5)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(16)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good evening');
    expect(greetingFor(2)).toBe('Good evening');
  });
});

describe('firstNameOf', () => {
  it('takes the first word, or nothing', () => {
    expect(firstNameOf('  Priya   Raman ')).toBe('Priya');
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf(null)).toBe('');
  });
});

describe('namesLine', () => {
  it('names two people at most and counts the rest from the true total', () => {
    expect(namesLine(['Priya Sharma'], 1)).toBe('Priya Sharma');
    expect(namesLine(['Priya Sharma', 'Ravi Kumar'], 2)).toBe('Priya Sharma and Ravi Kumar');
    expect(namesLine(['Priya Sharma', 'Ravi Kumar', 'Asha Rao'], 31)).toBe('Priya Sharma, Ravi Kumar and 29 more');
    expect(namesLine(['Priya Sharma'], 3)).toBe('Priya Sharma and 2 more');
    expect(namesLine([], 4)).toBe('');
  });
});

describe('callGate', () => {
  it('blocks Home’s call buttons until the calling number is connected, not on permission alone', () => {
    expect(callGate(false, { outboundPhone: true }, false)).toBe('hidden');
    expect(callGate(true, undefined, false)).toBe('checking');
    expect(callGate(true, { outboundPhone: false }, false)).toBe('no-line');
    expect(callGate(true, { outboundPhone: true }, false)).toBe('ready');
    expect(callGate(true, undefined, true)).toBe('ready');
  });
});
