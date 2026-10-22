import Link from 'next/link';
import { cn } from '../ui/cn';
import { TAB_LIST, TAB_LIST_FLUSH, TAB_TRIGGER } from '../ui/tabs';
import type { JobTabKey } from '../../features/readiness/next-action';

const TABS: { key: JobTabKey; label: string }[] = [
  { key: 'setup', label: 'Set up' },
  { key: 'people', label: 'People' },
  { key: 'review', label: 'Review' },
];

/** Links, not a tablist: each tab is its own page. Counts are a badge beside the label and never shorten it. */
export function JobTabs({
  jobId,
  current,
  counts,
}: {
  jobId: string;
  current: JobTabKey;
  counts?: Partial<Record<JobTabKey, number>>;
}) {
  return (
    <nav aria-label="Job sections">
      <ul role="list" className={cn('m-0 list-none p-0', TAB_LIST, TAB_LIST_FLUSH)}>
        {TABS.map((tab) => {
          const here = tab.key === current;
          const n = counts?.[tab.key];
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={`/jobs/${jobId}/${tab.key}`}
                aria-current={here ? 'page' : undefined}
                data-state={here ? 'active' : 'inactive'}
                className={cn(TAB_TRIGGER, 'whitespace-nowrap')}
              >
                {tab.label}
                {n != null ? (
                  <span className="ml-2 rounded-pill bg-muted px-1.5 text-meta tabular-nums text-text-2">{n}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
