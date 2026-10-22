import { describe, expect, it } from 'vitest';
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
    });
    expect(staticRedirects().every((r) => r.permanent === false)).toBe(true);
  });
});
