'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { openingPath, searchRecord } from '@/components/jobs/job-routes';
import { PageMain } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getJob } from '@/lib/api';
import { fromPublicId } from '@/lib/public-id';

/**
 * The opening rule: a Draft job opens on Set up, every other job on People. It reads the job the
 * way every other job page does (browser, /backend, retried), so one refused request cannot send
 * a Draft to People. Stateless.
 */
export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const rawId = fromPublicId(id) ?? id;
  const search = useSearchParams();
  const router = useRouter();
  const job = useQuery({ queryKey: ['job', rawId], queryFn: () => getJob(rawId), staleTime: 10_000 });
  const settled = job.data !== undefined || job.isError;
  useEffect(() => {
    // An unreadable job goes to People, which shows its own load error.
    if (settled) router.replace(openingPath(id, job.data?.status ?? null, searchRecord(search), window.location.hash));
  }, [settled, job.data, id, search, router]);
  return (
    <AppShell profile={null}>
      <PageMain>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </PageMain>
    </AppShell>
  );
}
