import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Job } from '../../lib/api';
import { jobFunnel } from '../../lib/hiring-people';
import { JobList } from './job-list';

const job = (i: number, status = 'open'): Job => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  title: `Job ${i}`,
  description: 'Run the night shift.',
  status,
  agentId: 'a1',
  screeningQuestions: [],
  screeningLanguage: 'en',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  hasJdDocs: false,
});

function render(n: number) {
  const client = new QueryClient();
  client.setQueryData(['me'], { activeOrganization: { permissions: ['jobs.read', 'agents.read'] } });
  client.setQueryData(['agents', 'list'], { agents: [{ id: 'a1', status: 'published' }] });
  const jobs = Array.from({ length: n }, (_, i) => job(i + 1, i === 0 && n > 1 ? 'closed' : 'open'));
  const funnels = Object.fromEntries(jobs.map((j) => [j.id, jobFunnel([{ status: 'new', callStatus: 'not_called' }])]));
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <JobList jobs={jobs} funnels={funnels} />
    </QueryClientProvider>,
  );
  const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey)).sort();
  return { html, keys, open: jobs.filter((j) => j.status !== 'closed').length };
}

describe('JobList', () => {
  it('registers the same queries for 1 job and for 30', () => {
    const one = render(1);
    const thirty = render(30);
    expect(thirty.keys).toEqual(one.keys);
    expect(one.keys.length).toBeLessThanOrEqual(3);
  });

  it('every open job shows a Next line', () => {
    const { html, open } = render(30);
    expect(html.split('Next: ').length - 1).toBe(open);
  });
});
