import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Me } from './api';
import { meQueryKey, usePermissions } from './use-me';

function Probe() {
  const { can, ready } = usePermissions();
  return createElement('p', null, `${ready}:${can('jobs.read')}:${can('roles.manage')}`);
}

function render(me?: Me) {
  const client = new QueryClient();
  if (me) client.setQueryData(meQueryKey, me);
  return renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
}

describe('usePermissions', () => {
  it('answers from the active workspace once me() has loaded', () => {
    const html = render({
      user: { id: 'u1', name: 'Asha', email: 'asha@example.in', emailVerified: true },
      activeOrganization: { id: 'o1', role: 'recruiter', permissions: ['jobs.read'] },
    });
    expect(html).toContain('true:true:false');
  });

  it('says no until ready, and with no workspace', () => {
    expect(render()).toContain('false:false:false');
    expect(
      render({ user: { id: 'u1', name: 'A', email: 'a@b.co', emailVerified: true }, activeOrganization: null }),
    ).toContain('true:false:false');
  });
});
