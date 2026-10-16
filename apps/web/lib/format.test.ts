import { describe, expect, it } from 'vitest';
import { formatDuration, formatPhone, formatPhoneMasked, formatWhen, shortRef } from './format';

describe('formatWhen', () => {
  const now = new Date(2026, 9, 1, 18, 0);

  it('reads en-IN with a 24-hour time', () => {
    expect(formatWhen(new Date(2026, 9, 1, 14, 5).toISOString(), now)).toBe('1 Oct, 14:05');
    expect(formatWhen(new Date(2026, 2, 9, 9, 7).toISOString(), now)).toBe('9 Mar, 09:07');
  });

  it('adds the year outside the current one', () => {
    expect(formatWhen(new Date(2025, 0, 3, 0, 5).toISOString(), now)).toBe('3 Jan 2025, 00:05');
  });

  it('reads Postgres text timestamps, bare hour offset included (Safari refuses it)', () => {
    expect(formatWhen('2026-10-01 14:05:09.123456', now)).toBe('1 Oct, 14:05');
    const utc = new Date(Date.UTC(2026, 9, 1, 8, 35));
    expect(formatWhen('2026-10-01 08:35:09.123456+00', now)).toBe(formatWhen(utc.toISOString(), now));
    expect(formatWhen('2026-10-01 08:35:09.123456+00', now)).not.toBe('');
  });

  it('shows missing as missing', () => {
    expect(formatWhen(null)).toBe('');
    expect(formatWhen(undefined)).toBe('');
    expect(formatWhen('not a date')).toBe('');
  });
});

describe('formatDuration', () => {
  it('is m:ss', () => {
    expect(formatDuration(347)).toBe('5:47');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(1200)).toBe('20:00');
  });

  it('shows missing as missing', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatDuration(-3)).toBe('');
  });
});

describe('formatPhone', () => {
  it('writes a mobile one way, however it was saved', () => {
    expect(formatPhone('9000000101')).toBe('+91 90000 00101');
    expect(formatPhone('+919000000211')).toBe('+91 90000 00211');
    expect(formatPhone('+91 98765 43210')).toBe('+91 98765 43210');
    expect(formatPhone('+6512345678')).toBe('+65 12345678');
  });

  it('shows missing as missing', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('  ')).toBe('');
  });
});

describe('formatPhoneMasked', () => {
  it('hides the middle of an Indian mobile however it was typed', () => {
    expect(formatPhoneMasked('+919876544410')).toBe('+91 98•••• 4410');
    expect(formatPhoneMasked('9876544410')).toBe('+91 98•••• 4410');
    expect(formatPhoneMasked('+91 98765 44410')).toBe('+91 98•••• 4410');
  });

  it('masks other countries and short numbers without revealing them', () => {
    expect(formatPhoneMasked('+447911123456')).toBe('+44 79•••• 3456');
    expect(formatPhoneMasked('+6512345')).toBe('+65 •••45');
  });

  it('shows missing as missing', () => {
    expect(formatPhoneMasked(null)).toBe('');
    expect(formatPhoneMasked('  ')).toBe('');
  });
});

describe('shortRef', () => {
  it('is the first 8 characters, uppercase', () => {
    expect(shortRef('4f2a91c3-0b9d-4a7e')).toBe('4F2A91C3');
    expect(shortRef(null)).toBe('');
  });
});
