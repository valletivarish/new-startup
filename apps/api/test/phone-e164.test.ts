import { describe, expect, it } from 'vitest';

import { toE164Phone } from '../src/providers/elevenlabs/phone-e164.js';

describe('toE164Phone', () => {
  it('keeps valid E.164', () => {
    expect(toE164Phone('+919876543210')).toBe('+919876543210');
  });

  it('adds +91 for 10-digit Indian mobiles', () => {
    expect(toE164Phone('9876543210')).toBe('+919876543210');
  });

  it('strips leading 0 for Indian locals', () => {
    expect(toE164Phone('09876543210')).toBe('+919876543210');
  });

  it('rejects empty / garbage', () => {
    expect(toE164Phone('')).toBeNull();
    expect(toE164Phone('abc')).toBeNull();
  });
});
