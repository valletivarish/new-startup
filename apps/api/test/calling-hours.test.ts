import { describe, expect, it } from 'vitest';

import { nextCallingTime } from '../src/integrations/calling-hours.js';

const ist = (iso: string) => new Date(`${iso}+05:30`);

describe('nextCallingTime (09:00–20:00 Asia/Kolkata)', () => {
  it('is null inside calling hours', () => {
    expect(nextCallingTime(ist('2026-10-16T10:00:00'))).toBeNull();
    expect(nextCallingTime(ist('2026-10-16T19:59:30'))).toBeNull();
  });

  it('holds until the next 09:00 IST outside them', () => {
    expect(nextCallingTime(ist('2026-10-16T20:00:00'))).toEqual(ist('2026-10-17T09:00:00'));
    expect(nextCallingTime(ist('2026-10-16T03:00:00'))).toEqual(ist('2026-10-16T09:00:00'));
    expect(nextCallingTime(ist('2026-10-31T21:00:00'))).toEqual(ist('2026-11-01T09:00:00'));
  });
});
