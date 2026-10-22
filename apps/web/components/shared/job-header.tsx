import type { ReactNode } from 'react';
import Link from 'next/link';
import { Breadcrumb } from '../ui/breadcrumb';
import { cn } from '../ui/cn';
import { StatusTag } from '../ui/state-tag';
import { TAB_LIST, TAB_LIST_FLUSH, TAB_TRIGGER } from '../ui/tabs';
import { HIRING_USE_CASE } from '../../lib/use-case-definitions';

export type JobTab = 'candidates' | 'setup';

const PATH: Record<JobTab, (jobId: string) => string> = {
  candidates: (id) => `/jobs/${id}/people`,
  setup: (id) => `/jobs/${id}/setup`,
};

export interface JobHeaderProps {
  jobId: string;
  title: string;
  /** Raw job status: draft, open or closed. */
  status: string | null | undefined;
  /** The workspace has no calling number yet: an open job stays Active and shows the test-calls-only banner. */
  testCallsOnly?: boolean;
  /** The page this header sits on. */
  current: JobTab;
  /** One line on whether the job is ready for calls, from saved data. */
  readiness?: ReactNode;
  /** Page actions: right of the title from md, below it on phones. */
  actions?: ReactNode;
  /** The use case's word for work items, plural (spec 9): the breadcrumb root. Pass useUseCase().labels.workItem.many. */
  workItemLabel?: string;
  /** The use case's word for contacts, plural: the first tab. Pass useUseCase().labels.contact.many. */
  contactLabel?: string;
  className?: string;
}

/**
 * The h1 with the job's status pill, actions, and the Candidates and Setup tabs, drawn like every
 * page's tabs. The trail is the shell's on desktop (pass the same crumbs to AppShell): here it
 * shows on phones only.
 */
export function JobHeader({
  jobId,
  title,
  status,
  testCallsOnly = false,
  current,
  readiness,
  actions,
  workItemLabel = HIRING_USE_CASE.labels.workItem.many,
  contactLabel = HIRING_USE_CASE.labels.contact.many,
  className,
}: JobHeaderProps) {
  const tabs: { key: JobTab; label: string }[] = [
    { key: 'candidates', label: contactLabel },
    { key: 'setup', label: 'Set up' },
  ];
  return (
    <div className={cn('mb-6', className)}>
      <Breadcrumb items={[{ label: workItemLabel, href: '/jobs' }, { label: title }]} className="mb-3 md:hidden" />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="m-0 min-w-0 text-page text-text [overflow-wrap:anywhere]">{title}</h1>
            <StatusTag domain="job" value={testCallsOnly && status === 'open' ? 'open_test_only' : status} />
          </div>
          {readiness ? <div className="mt-1.5 text-body text-text-2">{readiness}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <nav aria-label="Job sections" className="mt-5">
        <ul role="list" className={cn('m-0 list-none p-0', TAB_LIST, TAB_LIST_FLUSH)}>
          {tabs.map((tab) => {
            const here = tab.key === current;
            return (
              <li key={tab.key} className="shrink-0">
                <Link
                  href={PATH[tab.key](jobId)}
                  aria-current={here ? 'page' : undefined}
                  data-state={here ? 'active' : 'inactive'}
                  className={TAB_TRIGGER}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
