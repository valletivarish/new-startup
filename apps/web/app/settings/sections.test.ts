import { describe, expect, it } from 'vitest';
import { LEGACY_SECTION, SETTINGS_SECTIONS, visibleSections, type SettingsContext } from './sections';

const ctx = (perms: string[], over: Partial<SettingsContext> = {}): SettingsContext => ({
  hasOrg: true,
  can: (p) => perms.includes(p),
  sourcesAvailable: true,
  ...over,
});
const slugs = (c: SettingsContext) => visibleSections(c).map((s) => s.slug);

describe('settings sections', () => {
  it('keeps the agreed order', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.slug)).toEqual([
      'company', 'calling', 'team', 'sources', 'activity', 'account', 'advanced',
    ]);
  });

  it('shows Advanced only with integrations.read', () => {
    expect(slugs(ctx([]))).not.toContain('advanced');
    expect(slugs(ctx(['integrations.read']))).toContain('advanced');
  });

  it('hides Sources when nothing can be connected, or without integrations.read', () => {
    expect(slugs(ctx(['integrations.read']))).toContain('sources');
    expect(slugs(ctx(['integrations.read'], { sourcesAvailable: false }))).not.toContain('sources');
    expect(slugs(ctx([]))).not.toContain('sources');
  });

  it('gates Team and Activity, and leaves only Account without a workspace', () => {
    expect(slugs(ctx([]))).not.toContain('team');
    expect(slugs(ctx(['users.invite']))).toContain('team');
    expect(slugs(ctx(['audit.read']))).toContain('activity');
    expect(slugs(ctx(['users.read', 'audit.read', 'integrations.read'], { hasOrg: false }))).toEqual(['account']);
  });

  it('maps the old ?section= values', () => {
    expect(LEGACY_SECTION).toEqual({
      workspace: 'company', team: 'team', access: 'team', activity: 'activity',
      connected: 'sources', developers: 'advanced', account: 'account',
    });
  });
});
