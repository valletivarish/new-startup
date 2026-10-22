import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { jobReadiness } from '../../components/jobs/setup';
import { nextAction, type JobCounts } from '../../features/readiness/next-action';
import type { Job } from '../../lib/api';
import { toPublicId } from '../../lib/public-id';
import { JobCard } from './job-card';

const base: Job = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Warehouse supervisor',
  description: '',
  status: 'draft',
  agentId: null,
  screeningQuestions: [],
  screeningLanguage: 'en',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  hasJdDocs: false,
};
const id = toPublicId(base.id);
const contact = { one: 'person', many: 'people' };
const render = (job: Job, counts: JobCounts, live: boolean) => {
  const next = nextAction(jobReadiness(job, [], live, 'connected'), counts, id);
  return renderToStaticMarkup(<JobCard job={job} funnel={undefined} next={next} contact={contact} />);
};

describe('JobCard', () => {
  it('sends a Draft job with no description to Set up', () => {
    const html = render(base, { total: 0, notCalled: 0, notConnected: 0, toReview: 0 }, false);
    expect(html).toContain('Next:');
    expect(html).toContain('Add the job description');
    expect(html).toContain(`href="/jobs/${id}/setup"`);
  });

  it('sends an Active job with undecided answers to Review', () => {
    const job = { ...base, status: 'open', description: 'Run the night shift, 20 people.', agentId: 'a1' };
    const html = render(job, { total: 6, notCalled: 1, notConnected: 0, toReview: 2 }, true);
    expect(html).toContain('Review 2 answers');
    expect(html).toContain(`href="/jobs/${id}/review"`);
  });

  it('shows no Next line for a closed job', () => {
    const html = renderToStaticMarkup(<JobCard job={base} funnel={undefined} next={null} contact={contact} />);
    expect(html).not.toContain('Next:');
  });
});
