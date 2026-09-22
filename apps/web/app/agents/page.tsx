'use client';

/**
 * Hiring voice list — voices for open roles.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Sparkles } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState, Notice, PageHeader, PageMain } from '../../components/ui/page';
import {
  DataList,
  DataListBody,
  DataListHeader,
  DataListMeta,
  DataListRow,
  DataListTitle,
} from '../../components/ui/list';
import { SkeletonPage, SkeletonRows } from '../../components/ui/skeleton';
import { AGENT_STATUS_LABEL } from '../../lib/status-labels';
import { loginPathForReturn } from '../../lib/auth-redirect';
import { toPublicId } from '../../lib/public-id';
import {
  ApiClientError,
  listAgents,
  me,
  type Agent,
  type Me,
} from '../../lib/api';

export default function AgentsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([me(), listAgents()]);
      setProfile(p);
      setAgents(a.agents);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
      } else if (e instanceof ApiClientError && e.status === 403) {
        setNotice(e.message);
      } else setNotice('Could not load hiring voices.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain>
          {loading ? <SkeletonPage rows={4} /> : null}
          {notice ? <Notice kind="err">{notice}</Notice> : null}
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Hiring voice"
          description="The voice that calls candidates for your open roles."
          actions={
            can('agents.create') ? (
              <Button asChild>
                <Link href="/agents/new">
                  <Plus className="h-4 w-4" aria-hidden />
                  Set up hiring voice
                </Link>
              </Button>
            ) : null
          }
        />

        {notice ? <Notice kind="err">{notice}</Notice> : null}

        {loading ? (
          <SkeletonRows rows={4} />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            title="No hiring voice yet"
            description={
              can('agents.create')
                ? 'Set up a hiring voice, publish it, then use it on your open roles.'
                : 'No hiring voice in this company yet.'
            }
            action={
              can('agents.create') ? (
                <Button asChild>
                  <Link href="/agents/new">Set up hiring voice</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <DataList>
            <DataListHeader className="grid-cols-[minmax(0,1fr)_auto]">
              <span>Hiring voice</span>
              <span className="pr-1">Status</span>
            </DataListHeader>
            <DataListBody>
              {agents.map((a) => (
                <DataListRow
                  key={a.id}
                  href={`/agents/${toPublicId(a.id)}`}
                  className="grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <DataListTitle>{a.name}</DataListTitle>
                    <DataListMeta className="line-clamp-1">
                      {a.purpose || 'Phone screens for open roles'}
                    </DataListMeta>
                  </div>
                  <Badge tone={statusTone(a.status)}>
                    {AGENT_STATUS_LABEL[a.status] ?? a.status}
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
