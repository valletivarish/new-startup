import { describe, expect, it } from 'vitest';
import { HIRING_USE_CASE } from '../../../lib/use-case-definitions';
import { buildNav, gate, isActive } from './nav';

describe('app shell nav', () => {
  const nav = buildNav(HIRING_USE_CASE.labels);

  it('names the hiring items from the use case', () => {
    expect(nav.main.map((i) => i.label)).toEqual(['Home', 'Jobs', 'Candidates', 'Calls']);
    expect(nav.workspace.map((i) => i.label)).toEqual(['Agents', 'Knowledge', 'Tools', 'Analytics', 'Settings']);
  });

  it('marks an item active on its page and the pages under it only', () => {
    expect(isActive('/jobs/abc/candidates', '/jobs')).toBe(true);
    expect(isActive('/dashboard', '/dashboard')).toBe(true);
    expect(isActive('/jobsboard', '/jobs')).toBe(false);
    expect(isActive('/jobs/abc/candidates', '/candidates')).toBe(false);
    expect(isActive('/tools', '/tools')).toBe(true);
  });

  it('holds gated items as pending until permissions are known, then filters them', () => {
    expect(gate(nav.main, undefined).map((i) => [i.label, i.pending])).toEqual([
      ['Home', false],
      ['Jobs', true],
      ['Candidates', true],
      ['Calls', true],
    ]);
    expect(gate(nav.main, ['jobs.read']).map((i) => i.label)).toEqual(['Home', 'Jobs']);
    // No workspace: only the ungated items.
    expect(gate(nav.workspace, null).map((i) => i.label)).toEqual(['Settings']);
  });
});
