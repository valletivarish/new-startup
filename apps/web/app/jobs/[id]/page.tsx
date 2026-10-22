import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { openingPath } from '@/components/jobs/job-routes';
import { fromPublicId } from '@/lib/public-id';

/** The opening rule: a Draft job opens on Set up, every other job on People. Stateless. */
export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  let status: string | null = null;
  try {
    // The same call the browser makes through /backend, with the visitor's session cookie.
    const api = process.env.API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${api}/jobs/${fromPublicId(id) ?? id}`, {
      headers: { cookie: (await cookies()).toString() },
      cache: 'no-store',
    });
    if (res.ok) status = ((await res.json()) as { status?: string }).status ?? null;
  } catch {
    // The People tab shows its own load error.
  }
  redirect(openingPath(id, status, query));
}
