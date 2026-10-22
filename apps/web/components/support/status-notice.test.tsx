import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StatusComponent } from '../../lib/support';
import { StatusNotice } from './status-notice';

const c = (id: StatusComponent['id'], name: string, state: StatusComponent['state'], note: string): StatusComponent => ({
  id,
  name,
  state,
  note,
});

function render(components?: StatusComponent[]) {
  const client = new QueryClient();
  if (components) client.setQueryData(['status'], { checkedAt: '2026-10-22T10:00:00Z', components });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StatusNotice />
    </QueryClientProvider>,
  );
}

describe('StatusNotice', () => {
  it('shows nothing when everything is operational', () => {
    expect(
      render([
        c('api', 'Dashboard and API', 'operational', 'Dashboard and API are answering.'),
        c('calls', 'Phone calls', 'operational', 'Calls are being placed.'),
      ]),
    ).toBe('');
  });

  it('shows one line for the part that is not operational, and none for the rest', () => {
    const html = render([
      c('api', 'Dashboard and API', 'operational', 'Dashboard and API are answering.'),
      c('calls', 'Phone calls', 'degraded', 'Calls are delayed. We are on it.'),
    ]);
    expect(html).toContain('Phone calls');
    expect(html).toContain('Calls are delayed. We are on it.');
    expect(html).not.toContain('Dashboard and API');
  });

  it('shows nothing before the status has loaded', () => {
    expect(render()).toBe('');
  });
});
