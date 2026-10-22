import { describe, expect, it } from 'vitest';

import { accentColours, confirmation, contrast, indianMobile, serverMessage, validate } from './form';

const ok = { fullName: 'Priya Sharma', phone: '98765 43210', email: '', consent: true };

describe('careers-page form validation', () => {
  it('accepts a complete application', () => {
    expect(validate(ok)).toEqual({});
    expect(validate({ ...ok, email: 'priya@example.in' })).toEqual({});
  });

  it('names each missing or wrong field', () => {
    expect(validate({ fullName: ' ', phone: '', email: 'nope', consent: false })).toEqual({
      fullName: 'Enter your name.',
      phone: 'Enter your mobile number.',
      email: 'Enter a valid email, or leave it empty.',
      consent: 'Tick the box to agree to the screening call.',
    });
    expect(validate({ ...ok, phone: '12345' }).phone).toBe('Enter a 10-digit Indian mobile number.');
  });

  it('reads Indian mobiles the way people type them', () => {
    for (const typed of ['9876543210', '+91 98765 43210', '+91-98765-43210', '09876543210', '919876543210', '(98765) 43210']) {
      expect(indianMobile(typed), typed).toBe('9876543210');
    }
    for (const bad of ['5876543210', '987654321', '98765432100', '+1 9876543210', 'abc']) {
      expect(indianMobile(bad), bad).toBeNull();
    }
  });
});

describe('careers-page form wording', () => {
  it('thanks by first name, and says after 9 am outside calling hours', () => {
    expect(confirmation('Priya Sharma', null)).toBe(
      'Thanks, Priya. You’ll get a call from our hiring team’s screening assistant shortly.',
    );
    expect(confirmation('Priya', '2026-10-21T03:30:00.000Z')).toContain('after 9 am India time');
  });

  it('turns server errors into field or form messages', () => {
    expect(serverMessage(422, { code: 'consent_required' })).toEqual([
      { field: 'consent', message: 'Tick the box to agree to the screening call.' },
    ]);
    expect(serverMessage(422, { code: 'validation_failed', errors: [{ field: 'phone', message: 'Bad' }] })).toEqual([
      { field: 'phone', message: 'Bad' },
    ]);
    expect(serverMessage(429, null)[0]!.field).toBeUndefined();
    expect(serverMessage(500, null)[0]!.message).toMatch(/couldn’t send/);
  });
});

describe('careers-page form colours', () => {
  it('keeps the button text readable on any accent (4.5:1)', () => {
    for (const accent of ['#0F1A2E', '#FFD600', '#0B6E4F', '#E11D48', '#FFFFFF', '#777']) {
      const c = accentColours(accent);
      expect(contrast(c.accent, c.onAccent), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.ring, '#FFFFFF'), accent).toBeGreaterThanOrEqual(3);
    }
  });

  it('ignores anything that isn’t a hex colour', () => {
    expect(accentColours('red; background:url(x)').accent).toBe('#0F1A2E');
    expect(accentColours(undefined).accent).toBe('#0F1A2E');
  });
});
