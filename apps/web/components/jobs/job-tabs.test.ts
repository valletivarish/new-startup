import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobTabs } from './job-tabs';

describe('JobTabs', () => {
  const html = renderToStaticMarkup(
    createElement(JobTabs, { jobId: 'abc', current: 'people', counts: { people: 17, review: 5 } }),
  );

  it('links Set up, People and Review in order, with the counts beside the labels', () => {
    expect(html.indexOf('Set up')).toBeLessThan(html.indexOf('People'));
    expect(html.indexOf('People')).toBeLessThan(html.indexOf('Review'));
    expect(html).toContain('href="/jobs/abc/setup"');
    expect(html).toContain('href="/jobs/abc/people"');
    expect(html).toContain('href="/jobs/abc/review"');
    expect(html).toMatch(/People[^]*17/);
    expect(html).toMatch(/Review[^]*5/);
  });

  it('marks only the current tab with aria-current="page"', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>People/);
  });

  it('shows no badge while counts are unknown', () => {
    const bare = renderToStaticMarkup(createElement(JobTabs, { jobId: 'abc', current: 'setup' }));
    expect(bare).not.toMatch(/tabular-nums/);
  });
});
