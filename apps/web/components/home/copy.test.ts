import { describe, expect, it } from 'vitest';
import { callGate, firstNameOf, greetingFor } from './copy';

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

describe('callGate', () => {
  it('blocks Home’s call buttons until the calling number is connected, not on permission alone', () => {
    expect(callGate(false, { outboundPhone: true }, false)).toBe('hidden');
    expect(callGate(true, undefined, false)).toBe('checking');
    expect(callGate(true, { outboundPhone: false }, false)).toBe('no-line');
    expect(callGate(true, { outboundPhone: true }, false)).toBe('ready');
    expect(callGate(true, undefined, true)).toBe('ready');
  });
});
