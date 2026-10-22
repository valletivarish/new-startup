import { describe, expect, it } from 'vitest';
import { HIRING_USE_CASE } from '../../../lib/use-case-definitions';
import { adminLinks, buildNav, gate, isActive } from './nav';

describe('app shell nav', () => {
  const nav = buildNav(HIRING_USE_CASE.labels);

  it('has four items, in order', () => {
    expect(nav.main.map((i) => [i.href, i.label, i.permission])).toEqual([
      ['/jobs', 'Jobs', undefined],
      ['/people', 'People', 'candidates.read'],
      ['/reports', 'Reports', 'analytics.read'],
      ['/settings', 'Settings', undefined],
    ]);
  });

  it('keeps the platform pages out of the sidebar and gated to the platform owner', () => {
    expect(adminLinks.map((i) => [i.href, i.label])).toEqual([
      ['/admin/costs', 'Costs'],
      ['/admin/support', 'Support inbox'],
      ['/agents', 'Agents'],
    ]);
    expect(gate(adminLinks, ['candidates.read'])).toEqual([]);
    expect(gate(adminLinks, ['platform.admin'])).toHaveLength(3);
  });

  it('marks an item active on its page and the pages under it only', () => {
    expect(isActive('/jobs/abc/review', '/jobs')).toBe(true);
    expect(isActive('/jobs/abc/candidates', '/jobs')).toBe(true);
    expect(isActive('/jobsboard', '/jobs')).toBe(false);
    expect(isActive('/jobs/abc/review', '/people')).toBe(false);
    expect(isActive('/settings/team', '/settings')).toBe(true);
  });

  it('holds gated items as pending until permissions are known, then filters them', () => {
    expect(gate(nav.main, undefined).map((i) => [i.label, i.pending])).toEqual([
      ['Jobs', false],
      ['People', true],
      ['Reports', true],
      ['Settings', false],
    ]);
    expect(gate(nav.main, ['candidates.read']).map((i) => i.label)).toEqual(['Jobs', 'People', 'Settings']);
    // No workspace: only the ungated items.
    expect(gate(nav.main, null).map((i) => i.label)).toEqual(['Jobs', 'Settings']);
  });
});
