import { describe, expect, it } from 'vitest';
import { composeE164, splitE164 } from '../lib/phone-field';

describe('phone-field', () => {
  it('defaults bare Indian mobiles to +91', () => {
    expect(splitE164('8919504427')).toEqual({ dial: '91', national: '8919504427' });
    expect(composeE164('91', '8919504427')).toBe('+918919504427');
  });

  it('splits existing E.164', () => {
    expect(splitE164('+918919504427')).toEqual({
      dial: '91',
      national: '8919504427',
    });
    expect(splitE164('+971501234567')).toEqual({
      dial: '971',
      national: '501234567',
    });
  });

  it('returns empty when national is blank', () => {
    expect(composeE164('91', '')).toBe('');
    expect(composeE164('91', '  ')).toBe('');
  });

  it('strips trunk 0 and spaces', () => {
    expect(composeE164('91', '08919 504427')).toBe('+918919504427');
  });
});
