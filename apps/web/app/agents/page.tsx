'use client';

/**
 * Agents (D2): the workspace's AI hiring agents as tiles, each with the agent's face and its
 * state in words, then where the agent's words come from.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AudioLines, ChevronRight, Plus } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { agentStateCopy } from '@/components/agents/copy';
import { AgentSources } from '@/components/agents/sources';
import { HiringVoiceFace } from '@/components/fx/HiringVoiceFace';
import { Button } from '@/components/ui/button';
import { EmptyState, IconTile } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup, useHeldLoading } from '@/components/ui/skeleton';
import { StatusTag } from '@/components/ui/state-tag';
import { listAgents, me, type Agent, type Me } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { toPublicId } from '@/lib/public-id';
import { useUseCase } from '@/lib/use-cases';

// One tile when there is one agent, two across once there are more (24rem each at least).
const GRID = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))]';

// The sidebar's brand is one animated agent already: at most two more on screen.
const FACES = 2;

export default function AgentsPage() {
  const { labels } = useUseCase();
  const [profile, setProfile] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([me(), listAgents()]);
      setProfile(p);
      setAgents(a.agents);
      setError(null);
    } catch (e) {
      // A 401 is already on its way to sign-in (lib/api).
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const skeleton = useHeldLoading(agents === null && !error);
  const contacts = labels.contact.many.toLowerCase();
  const job = labels.workItem.one.toLowerCase();

  const setUp = can('agents.create') ? (
    <Button asChild>
      <Link href="/agents/new">
        <Plus aria-hidden strokeWidth={1.5} />
        Set up an agent
      </Link>
    </Button>
  ) : null;

  let body;
  if (skeleton) {
    body = (
      <SkeletonGroup>
        <div className={GRID}>
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-4 rounded-card border border-border bg-canvas p-5">
              <Skeleton className="size-12 shrink-0 rounded-pill" />
              <div className="flex-1 space-y-3 pt-1">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonGroup>
    );
  } else if (agents === null) {
    const message = toUserMessage(error, 'load your agents');
    body = (
      <ErrorState
        title={message.title}
        cause={message.detail}
        onRetry={() => void reload()}
        retrying={loading}
      />
    );
  } else if (agents.length === 0) {
    body = (
      <div className="rounded-card border border-border bg-canvas">
        <EmptyState
          agent="idle"
          title="No AI hiring agent yet"
          description={
            can('agents.create')
              ? `Set it up once. It calls each of your ${contacts}, asks your questions and writes down what they said.`
              : 'Ask a workspace admin to set one up.'
          }
          action={setUp}
        />
      </div>
    );
  } else {
    body = (
      <>
        <ul role="list" aria-label="Agents" className={`m-0 list-none p-0 ${GRID}`}>
          {agents.map((agent, i) => (
            <li key={agent.id}>
              <AgentTile agent={agent} face={i < FACES} />
            </li>
          ))}
        </ul>
        <AgentSources can={can} className="md:grid-cols-2" />
      </>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain>
        <PageHeader
          title="Your"
          accent={agents && agents.length > 1 ? 'AI hiring agents' : 'AI hiring agent'}
          description={`It phones your ${contacts}, asks each ${job}’s questions and writes down what they said. You decide what happens next.`}
          actions={agents?.length ? setUp : null}
        />
        {body}
      </PageMain>
    </AppShell>
  );
}

/** One agent: its face (or a plain tile past the first two), name, purpose and state. The whole tile opens it. */
function AgentTile({ agent, face }: { agent: Agent; face: boolean }) {
  const { labels } = useUseCase();
  const { line } = agentStateCopy(agent.status, labels);
  return (
    <article className="relative flex h-full items-start gap-4 rounded-card border border-border bg-canvas p-5 transition-shadow duration-fast has-[a:hover]:shadow-card has-[a:focus-visible]:[outline:2px_solid_var(--focus-ring)] has-[a:focus-visible]:[outline-offset:2px]">
      {face ? (
        <HiringVoiceFace size={48} />
      ) : (
        <IconTile>
          <AudioLines />
        </IconTile>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h2 className="m-0 min-w-0 text-title font-semibold text-text">
            <Link
              href={`/agents/${toPublicId(agent.id)}`}
              // Stretched over the tile; the tile draws the focus ring.
              className="[overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-card focus-visible:shadow-none focus-visible:outline-none"
            >
              {agent.name}
            </Link>
          </h2>
          <StatusTag domain="agent" value={agent.status} />
        </div>
        <p className="mb-0 mt-1 line-clamp-2 max-w-[65ch] text-text-2">
          {agent.purpose || 'No description yet.'}
        </p>
        <p className="mb-0 mt-3 flex items-center gap-1 text-meta text-text-3">
          {line}
          <ChevronRight aria-hidden strokeWidth={1.5} className="ml-auto size-4 shrink-0" />
        </p>
      </div>
    </article>
  );
}
