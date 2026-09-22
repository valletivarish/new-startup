'use client';

/**
 * Candidates index — people across open roles, deep-linked into each job sheet.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/input';
import {
  EmptyState,
  Notice,
  PageHeader,
  PageMain,
} from '../../components/ui/page';
import {
  DataList,
  DataListBody,
  DataListHeader,
  DataListMeta,
  DataListRow,
  DataListTitle,
} from '../../components/ui/list';
import { SkeletonRows } from '../../components/ui/skeleton';
import { loginPathForReturn } from '../../lib/auth-redirect';
import { toPublicId } from '../../lib/public-id';
import { PERSON_STATUS_LABEL } from '../../lib/status-labels';
import { useHiringPeople } from '../../lib/hiring-people';
import { ApiClientError, me, type Me } from '../../lib/api';

const CALL_LABEL: Record<string, string> = {
  not_called: 'Not called yet',
  calling: 'Call in progress',
  completed: 'Call finished',
  failed: 'Call failed',
};

type CallFilter = 'all' | 'not_called' | 'calling' | 'completed' | 'failed';

export default function CandidatesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [callFilter, setCallFilter] = useState<CallFilter>('all');
  const [authReady, setAuthReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canRead =
    profile?.activeOrganization?.permissions.includes('candidates.read') ??
    false;

  const { data, isLoading, isError, isFetching } = useHiringPeople(
    authReady && canRead,
    query,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await me();
        if (cancelled) return;
        setProfile(p);
        setAuthReady(true);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          router.push(loginPathForReturn('/candidates'));
        } else if (!cancelled) {
          setNotice('Could not load your workspace.');
          setAuthReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery(queryDraft.trim());
    }, 280);
    return () => window.clearTimeout(handle);
  }, [queryDraft]);

  const people = data?.people ?? [];
  const filteredPeople = useMemo(() => {
    if (callFilter === 'all') return people;
    return people.filter((row) => row.callStatus === callFilter);
  }, [people, callFilter]);
  const loading = !authReady || (canRead && isLoading && !data);
  const searching = Boolean(query.trim());
  const filteringCalls = callFilter !== 'all';

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="People"
          description="Everyone on your open roles. Open a person to call, review, and move them forward."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/jobs">All jobs</Link>
            </Button>
          }
        />

        {notice || isError ? (
          <Notice kind="err">{notice ?? 'Could not load candidates.'}</Notice>
        ) : null}

        {canRead &&
        (people.length > 0 || searching || filteringCalls || loading) ? (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <Field label="Find people" className="w-full sm:max-w-md">
              <Input
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                placeholder="Name, mobile, or job…"
                aria-label="Find people by name, mobile, or job"
              />
            </Field>
            <Field label="Call" className="w-full sm:w-auto sm:min-w-[10rem]">
              <Select
                value={callFilter}
                onChange={(e) => setCallFilter(e.target.value as CallFilter)}
                aria-label="Filter by call status"
              >
                <option value="all">All calls</option>
                <option value="not_called">Not called yet</option>
                <option value="calling">Call in progress</option>
                <option value="completed">Call finished</option>
                <option value="failed">Call failed</option>
              </Select>
            </Field>
          </div>
        ) : null}

        {loading ? (
          <SkeletonRows rows={5} />
        ) : !canRead ? (
          <EmptyState
            icon={<Users className="h-5 w-5" aria-hidden />}
            title="No access"
            description="You need permission to view people in this company."
          />
        ) : !searching && !filteringCalls && people.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" aria-hidden />}
            title="No people yet"
            description="Open a job and add people there. They’ll show up here across every open role."
            action={
              <Button asChild>
                <Link href="/jobs">Go to Jobs</Link>
              </Button>
            }
          />
        ) : filteredPeople.length === 0 ? (
          <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
            {isFetching
              ? 'Searching…'
              : searching
                ? `No people match “${query.trim()}”.`
                : filteringCalls
                  ? 'No people match this call filter.'
                  : 'No people match.'}
          </p>
        ) : (
          <DataList>
            <DataListHeader className="grid-cols-[minmax(0,1fr)_auto_auto]">
              <span>Person</span>
              <span className="hidden sm:inline">Review</span>
              <span className="pr-1">Call</span>
            </DataListHeader>
            <DataListBody>
              {filteredPeople.map((row) => (
                <DataListRow
                  key={`${row.jobId}-${row.candidateId}`}
                  href={`/jobs/${toPublicId(row.jobId)}/candidates?c=${encodeURIComponent(toPublicId(row.candidateId))}`}
                  className="grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <div className="min-w-0">
                    <DataListTitle>{row.fullName}</DataListTitle>
                    <DataListMeta>
                      {row.jobTitle}
                      {row.phone ? ` · ${row.phone}` : ''}
                    </DataListMeta>
                  </div>
                  <Badge
                    tone={statusTone(row.status)}
                    className="hidden sm:inline-flex"
                  >
                    {PERSON_STATUS_LABEL[row.status] ?? row.status}
                  </Badge>
                  <Badge
                    tone={
                      row.callStatus === 'completed'
                        ? 'success'
                        : row.callStatus === 'failed'
                          ? 'danger'
                          : row.callStatus === 'calling'
                            ? 'accent'
                            : 'neutral'
                    }
                  >
                    {CALL_LABEL[row.callStatus] ?? row.callStatus}
                  </Badge>
                </DataListRow>
              ))}
            </DataListBody>
          </DataList>
        )}
      </PageMain>
    </AppShell>
  );
}
