import { describe, expect, it } from 'vitest';
import { LEGACY_SECTION } from '../app/settings/sections';
import { staticRedirects } from './redirects';

describe('staticRedirects', () => {
  it('sends every retired page to its new home, temporarily', () => {
    const map = Object.fromEntries(staticRedirects().map((r) => [r.source, r.destination]));
    expect(map).toMatchObject({
      '/dashboard': '/jobs',
      '/candidates': '/people',
      '/analytics': '/reports',
      '/knowledge': '/settings/company',
      '/tools': '/jobs',
      '/status': '/',
    });
    expect(staticRedirects().every((r) => r.permanent === false)).toBe(true);
  });

  it('sends every old /settings?section= link to its page, and bare /settings to Company', () => {
    const settings = staticRedirects().filter((r) => r.source === '/settings');
    for (const [legacy, slug] of Object.entries(LEGACY_SECTION)) {
      const rule = settings.find((r) => (r as { has?: { key: string; value: string }[] }).has?.[0]?.value === legacy);
      expect(rule, legacy).toMatchObject({ destination: `/settings/${slug}`, permanent: false });
      expect((rule as { has: { type: string; key: string }[] }).has[0]).toMatchObject({ type: 'query', key: 'section' });
    }
    // Unknown ?section= values and no section at all: Company.
    expect(settings.at(-1)).toMatchObject({ destination: '/settings/company', permanent: false });
    expect(settings.at(-1)).not.toHaveProperty('has');
  });
});
