'use client';

/**
 * Public status: is calling working right now? One row per part (dashboard and API, phone
 * calls, results to your systems), each with a word and an icon, never colour alone. Fed by the
 * API's own health checks; refreshes every 30 seconds.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BrandLink } from '@/components/brand/logo-mark';
import { StatusBadge } from '@/components/ui/state-tag';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { formatWhen } from '@/lib/format';
import { overallState, STATE_LABEL } from '@/lib/support';
import { getStatus } from '@/lib/support-api';

const HEADLINE = {
  operational: 'Everything is working',
  degraded: 'Some things are slow or partly down',
  down: 'Something is down',
} as const;

export default function StatusPage() {
  const status = useQuery({ queryKey: ['status'], queryFn: getStatus, refetchInterval: 30_000, retry: 1 });
  const components = status.data?.components ?? [];
  const overall = status.isError ? 'down' : overallState(components);

  return (
    <div className="min-h-dvh bg-ground px-4 py-8 text-text sm:px-6">
      <div className="mx-auto grid w-full max-w-[42rem] gap-6">
        <BrandLink href="/" />
        <main className="rounded-canvas bg-canvas p-6 shadow-card sm:p-8">
          <h1 className="m-0 text-page font-medium tracking-tight">Service status</h1>
          {status.isPending ? (
            <SkeletonGroup className="mt-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="mb-3 h-16 w-full" />
              ))}
            </SkeletonGroup>
          ) : status.isError ? (
            <p role="status" className="m-0 mt-3 text-body text-text-2">
              We couldn’t reach the service to check it. It may be down, or your connection may be. This page tries again
              every 30 seconds.
            </p>
          ) : (
            <>
              <p role="status" className="m-0 mt-3 flex flex-wrap items-center gap-2 text-md text-text-2">
                <StatusBadge tone={STATE_LABEL[overall].tone}>{STATE_LABEL[overall].label}</StatusBadge>
                {HEADLINE[overall]}
              </p>
              <ul role="list" className="m-0 mt-6 grid list-none divide-y divide-border rounded-card border border-border p-0">
                {components.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="m-0 text-title font-medium text-text">{c.name}</h2>
                      <p className="m-0 mt-0.5 text-body text-text-2">{c.note}</p>
                    </div>
                    <StatusBadge tone={STATE_LABEL[c.state].tone}>{STATE_LABEL[c.state].label}</StatusBadge>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-4 text-meta text-text-3">
                Checked <time dateTime={status.data.checkedAt}>{formatWhen(status.data.checkedAt)}</time>. Updates every 30
                seconds.
              </p>
            </>
          )}
        </main>
        <p className="m-0 text-meta text-text-2">
          Something not working for you? Use Get help in the app, or{' '}
          <Link href="/#contact-support" className="text-accent underline underline-offset-4">
            write to us from the website
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
