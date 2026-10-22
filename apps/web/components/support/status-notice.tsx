'use client';

import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '../ui/state-tag';
import { STATE_LABEL } from '../../lib/support';
import { getStatus } from '../../lib/support-api';

/**
 * Top of the Get help drawer: one line per part that is slow or down, from the API's own checks.
 * Nothing when all is well, while loading, or if the check itself fails. Mounted only while the
 * drawer is open, so it only fetches then.
 */
export function StatusNotice() {
  const status = useQuery({ queryKey: ['status'], queryFn: getStatus, retry: false, staleTime: 15_000 });
  const trouble = (status.data?.components ?? []).filter((c) => c.state !== 'operational');
  if (trouble.length === 0) return null;
  return (
    <ul role="status" className="m-0 grid list-none gap-2 p-0">
      {trouble.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-border bg-subtle px-3 py-2 text-body text-text">
          <StatusBadge tone={STATE_LABEL[c.state].tone}>{STATE_LABEL[c.state].label}</StatusBadge>
          <span>
            <span className="font-medium">{c.name}.</span> {c.note}
          </span>
        </li>
      ))}
    </ul>
  );
}
