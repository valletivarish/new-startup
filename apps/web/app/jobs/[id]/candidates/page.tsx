import { redirect } from 'next/navigation';
import { legacyBoardPath } from '@/components/jobs/job-routes';

/** The old board URL: kept so every saved link lands on People or Review with its filters. */
export default async function LegacyCandidatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyBoardPath((await params).id, await searchParams));
}
