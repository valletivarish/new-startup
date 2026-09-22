import { describe, expect, it } from 'vitest';
import { fromPublicId, toPublicId } from './public-id';

describe('public-id', () => {
  const uuid = 'c05164d8-0aef-4e0b-9d0a-f993a289e6f5';

  it('round-trips a uuid to an opaque token', () => {
    const token = toPublicId(uuid);
    expect(token).toMatch(/^v1\./);
    expect(token).not.toContain(uuid);
    expect(fromPublicId(token)).toBe(uuid);
  });

  it('accepts legacy raw uuids', () => {
    expect(fromPublicId(uuid)).toBe(uuid);
  });

  it('returns null for garbage', () => {
    expect(fromPublicId('nope')).toBeNull();
    expect(fromPublicId('v1.!!!')).toBeNull();
  });
});
