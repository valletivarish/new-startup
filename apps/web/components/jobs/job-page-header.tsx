'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ALL_CAUGHT_UP, type JobTabKey } from '../../features/readiness/next-action';
import { useJobReadiness } from '../../features/readiness/use-job-readiness';
import { Breadcrumb } from '../ui/breadcrumb';
import { Button } from '../ui/button';
import { Alert } from '../ui/notice';
import { StatusTag } from '../ui/state-tag';
import { TEST_ONLY_BANNER } from './job-copy';
import { JobTabs } from './job-tabs';
import { jobStatusLabel } from './setup';

/**
 * The job's header: title and status, the one Next action (and the test-calls-only note), then
 * the Set up / People / Review tabs with counts. Replaces the old Candidates/Setup header.
 */
export function JobPageHeader({
  jobId,
  title,
  status,
  testCallsOnly = false,
  current,
  readiness,
  actions,
  workItemLabel = 'Jobs',
}: {
  /** The id used in URLs. */
  jobId: string;
  title: string;
  status: string | null | undefined;
  testCallsOnly?: boolean;
  current: JobTabKey;
  /** One line on whether the job is ready for calls. */
  readiness?: ReactNode;
  /** Page actions: right of the title from md, below it on phones. */
  actions?: ReactNode;
  workItemLabel?: string;
}) {
  const job = useJobReadiness(jobId);
  const { next, counts } = job;
  const testOnly = job.readiness ? jobStatusLabel(job.readiness) !== null : false;
  return (
    <div className="mb-6">
      <Breadcrumb items={[{ label: workItemLabel, href: '/jobs' }, { label: title }]} className="mb-3 md:hidden" />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="m-0 min-w-0 text-page text-text [overflow-wrap:anywhere]">{title}</h1>
            <StatusTag domain="job" value={(testCallsOnly || testOnly) && status === 'open' ? 'open_test_only' : status} />
          </div>
          {readiness ? <div className="mt-1.5 text-body text-text-2">{readiness}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {next || testOnly ? (
        <div className="mt-4 space-y-2">
          {next ? (
            <Alert
              kind="info"
              title={next.label === ALL_CAUGHT_UP ? ALL_CAUGHT_UP : `Next: ${next.label}`}
              action={
                next.label === ALL_CAUGHT_UP ? undefined : (
                  <Button asChild size="sm">
                    <Link href={next.href}>
                      {next.label}
                      <ArrowRight aria-hidden strokeWidth={1.5} />
                    </Link>
                  </Button>
                )
              }
            />
          ) : null}
          {testOnly ? <Alert kind="info" title={TEST_ONLY_BANNER} /> : null}
        </div>
      ) : null}

      <div className="mt-5">
        <JobTabs
          jobId={jobId}
          current={current}
          counts={counts ? { people: counts.people, review: counts.undecided } : undefined}
        />
      </div>
    </div>
  );
}
