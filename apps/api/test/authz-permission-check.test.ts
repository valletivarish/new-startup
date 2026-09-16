import { describe, expect, it } from 'vitest';
import { firstMatchingPermission } from '../src/authz/permission-check.js';

describe('firstMatchingPermission', () => {
  it('returns the first required permission the actor holds', () => {
    const granted = firstMatchingPermission(new Set(['agents.create']), [
      'agents.read',
      'agents.create',
    ]);
    expect(granted).toBe('agents.create');
  });

  it('returns undefined when the actor holds none of the required permissions', () => {
    const granted = firstMatchingPermission(new Set(['knowledge.read']), [
      'agents.read',
      'agents.create',
    ]);
    expect(granted).toBeUndefined();
  });
});
