'use client';

/**
 * Support inbox (platform owner only): every chat, email, API and dashboard ticket in one list,
 * the conversation beside it, and what support needs to know without asking: the company, the
 * job and candidate it is about, and that company's recent integration errors. Refreshes every
 * 4 seconds; with alerts on, a new customer message raises a browser notification.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, BellOff, Inbox } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Select } from '@/components/ui/input';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { Composer, Thread } from '@/components/support/thread';
import { formatApiError } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMe } from '@/lib/use-me';
import {
  CHANNEL_LABEL,
  latestMessageAt,
  newCustomerMessages,
  POLL_MS,
  STAFF_STATUS,
  type AdminTicket,
  type TicketStatus,
} from '@/lib/support';
import {
  adminLink,
  adminOrganizations,
  adminReply,
  adminSetStatus,
  adminTicket,
  adminTickets,
} from '@/lib/support-api';

type Filter = 'open' | 'waiting_on_us' | 'waiting_on_customer' | 'solved' | 'unassigned' | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'New' },
  { value: 'waiting_on_us', label: 'Waiting on us' },
  { value: 'waiting_on_customer', label: 'Waiting on customer' },
  { value: 'unassigned', label: 'No company' },
  { value: 'solved', label: 'Solved' },
];

const CARD = 'rounded-card border border-border bg-canvas';

function selectedFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('t');
}

export default function SupportInboxPage() {
  const me = useMe();
  const allowed = me.data?.isPlatformAdmin === true;
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(selectedFromUrl()), []);

  const list = useQuery({
    queryKey: ['admin-support', 'list', filter],
    queryFn: () =>
      adminTickets(
        filter === 'all' ? {} : filter === 'unassigned' ? { unassigned: true } : { status: filter as TicketStatus },
      ),
    enabled: allowed,
    refetchInterval: POLL_MS,
  });
  useNewMessageAlerts(list.data?.tickets);

  function choose(id: string) {
    setSelected(id);
    const url = new URL(window.location.href);
    url.searchParams.set('t', id);
    window.history.replaceState(null, '', url);
  }

  if (me.isSuccess && !allowed) {
    return (
      <AppShell profile={me.data}>
        <PageMain>
          <EmptyState title="Page not found" description="This page isn't available in your workspace." />
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={me.data ?? null} title="Support inbox">
      <PageMain>
        <PageHeader
          title="Support inbox"
          description="Chats, emails and tickets from every company, and from people without an account yet."
          actions={<AlertsButton />}
        />
        <Segmented
          label="Filter tickets"
          options={FILTERS}
          value={filter}
          onValueChange={setFilter}
          collapseBelow="lg"
        />

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)]">
          <section aria-label="Tickets" className={cn(CARD, 'min-h-0 overflow-hidden')}>
            {list.isError ? (
              <ErrorState
                title="Couldn't load tickets"
                cause={toUserMessage(list.error).detail}
                onRetry={() => void list.refetch()}
                retrying={list.isFetching}
              />
            ) : !list.data ? (
              <SkeletonGroup className="p-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="mb-2 h-20 w-full" />
                ))}
              </SkeletonGroup>
            ) : list.data.tickets.length === 0 ? (
              <p className="m-0 p-5 text-body text-text-2">Nothing here.</p>
            ) : (
              <ul role="list" className="m-0 max-h-[70dvh] list-none divide-y divide-border overflow-y-auto p-0">
                {list.data.tickets.map((t) => (
                  <li key={t.id}>
                    <TicketItem ticket={t} active={t.id === selected} onSelect={() => choose(t.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selected ? (
            <Conversation key={selected} id={selected} />
          ) : (
            <div className={cn(CARD, 'grid place-items-center p-10')}>
              <EmptyState
                icon={<Inbox aria-hidden />}
                title="Pick a conversation"
                description="It opens here, with the company's context beside it."
              />
            </div>
          )}
        </div>
      </PageMain>
    </AppShell>
  );
}

function TicketItem({ ticket: t, active, onSelect }: { ticket: AdminTicket; active: boolean; onSelect: () => void }) {
  const s = STAFF_STATUS[t.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active || undefined}
      className={cn(
        'grid min-h-20 w-full grid-cols-[minmax(0,1fr)] gap-1 px-4 py-3 text-left transition-colors',
        active ? 'bg-muted' : 'hover:bg-subtle',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-label font-medium text-text">{t.subject}</span>
        {t.unanswered > 0 && t.status !== 'solved' ? (
          <span className="rounded-pill bg-primary px-2 text-caption font-medium tabular-nums text-primary-foreground">
            {t.unanswered}
            <span className="sr-only"> unanswered</span>
          </span>
        ) : null}
      </span>
      <span className="truncate text-meta text-text-2">
        {t.organizationName ?? 'No company'} · {t.requesterName ?? t.requesterEmail}
      </span>
      {t.lastMessage ? <span className="line-clamp-1 text-meta text-text-3">{t.lastMessage.body}</span> : null}
      <span className="flex items-center gap-2">
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        <span className="text-caption text-text-3">
          {CHANNEL_LABEL[t.channel]} · {formatWhen(t.lastMessageAt)}
        </span>
      </span>
    </button>
  );
}

function Conversation({ id }: { id: string }) {
  const qc = useQueryClient();
  const key = ['admin-support', 'ticket', id];
  const ticket = useQuery({
    queryKey: key,
    queryFn: () => adminTicket(id),
    refetchInterval: POLL_MS,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['admin-support', 'list'] });
  };
  const reply = useMutation({
    mutationFn: (body: string) => adminReply(id, body),
    onSuccess: refresh,
    onError: (e) => toast.error(formatApiError(e, 'The reply didn’t send. Try again.')),
  });
  const status = useMutation({
    mutationFn: (s: TicketStatus) => adminSetStatus(id, s),
    onSuccess: refresh,
    onError: (e) => toast.error(formatApiError(e, 'The status didn’t change. Try again.')),
  });

  if (ticket.isError) {
    return (
      <ErrorState
        title="Couldn't load this conversation"
        cause={toUserMessage(ticket.error).detail}
        onRetry={() => void ticket.refetch()}
        retrying={ticket.isFetching}
      />
    );
  }
  const t = ticket.data;
  if (!t) {
    return (
      <SkeletonGroup>
        <Skeleton className="h-96 w-full" />
      </SkeletonGroup>
    );
  }

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <section aria-labelledby="conv-title" className={cn(CARD, 'flex min-w-0 flex-col')}>
        <header className="grid gap-2 border-b border-border px-5 py-4">
          <h2 id="conv-title" className="m-0 text-title font-medium text-text">
            {t.subject}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-meta text-text-3">
              #{t.ref} · {CHANNEL_LABEL[t.channel]} · opened {formatWhen(t.createdAt)}
            </p>
            <label className="flex items-center gap-2 text-label text-text-2">
              Status
              <Select
                value={t.status}
                disabled={status.isPending}
                onChange={(e) => status.mutate(e.target.value as TicketStatus)}
                className="w-56"
              >
                {(Object.keys(STAFF_STATUS) as TicketStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STAFF_STATUS[s].label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </header>
        <div className="max-h-[52dvh] min-h-48 overflow-y-auto px-5 py-5">
          <Thread messages={t.messages ?? []} viewer="staff" customerName={t.requesterName ?? t.requesterEmail} />
        </div>
        <div className="border-t border-border px-5 py-4">
          <Composer
            label={`Reply to ${t.requesterEmail}`}
            placeholder={`Reply to ${t.requesterName ?? t.requesterEmail}. They also get it by email.`}
            sending={reply.isPending}
            onSend={(body) => reply.mutateAsync(body)}
          />
        </div>
      </section>
      <ContextPanel ticket={t} onLinked={refresh} />
    </div>
  );
}

function ContextPanel({ ticket: t, onLinked }: { ticket: AdminTicket; onLinked: () => void }) {
  const errors = t.context?.recentErrors ?? [];
  return (
    <aside aria-label="Context" className={cn(CARD, 'grid content-start gap-5 p-5')}>
      <dl className="m-0 grid gap-3">
        <Fact term="Company">{t.organizationName ?? <span className="text-text-3">No company yet</span>}</Fact>
        <Fact term="From">
          {t.requesterName ? `${t.requesterName}, ` : ''}
          <span className="break-all">{t.requesterEmail}</span>
        </Fact>
        {t.context?.jobTitle ? <Fact term="Job">{t.context.jobTitle}</Fact> : null}
        {t.context?.candidateName ? <Fact term="Candidate">{t.context.candidateName}</Fact> : null}
        {t.callId ? <Fact term="Call">#{t.callId.slice(0, 8)}</Fact> : null}
      </dl>
      {t.organizationId ? null : <LinkCompany id={t.id} onLinked={onLinked} />}
      <section aria-labelledby="ctx-errors" className="grid gap-2">
        <h3 id="ctx-errors" className="m-0 text-label font-medium text-text">
          Recent integration errors
        </h3>
        {!t.organizationId ? (
          <p className="m-0 text-meta text-text-3">Shown once the ticket belongs to a company.</p>
        ) : errors.length === 0 ? (
          <p className="m-0 text-meta text-text-3">
            None when the ticket was opened
            {t.context?.snapshotAt ? ` (${formatWhen(t.context.snapshotAt)})` : ''}.
          </p>
        ) : (
          <ul role="list" className="m-0 grid max-h-80 list-none gap-2 overflow-y-auto p-0">
            {errors.map((e, i) => (
              <li key={i} className="rounded-input bg-subtle px-3 py-2">
                <span className="block text-meta font-medium text-text">{e.summary}</span>
                {e.detail ? <span className="block break-words text-caption text-text-2">{e.detail}</span> : null}
                <span className="block text-caption text-text-3">{formatWhen(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-caption text-text-3">{term}</dt>
      <dd className="m-0 text-body text-text">{children}</dd>
    </div>
  );
}

function LinkCompany({ id, onLinked }: { id: string; onLinked: () => void }) {
  const orgs = useQuery({
    queryKey: ['admin-support', 'orgs'],
    queryFn: adminOrganizations,
    staleTime: 60_000,
  });
  const [orgId, setOrgId] = useState('');
  const link = useMutation({
    mutationFn: () => adminLink(id, orgId),
    onSuccess: () => {
      toast.success('Linked. The company now sees this conversation.');
      onLinked();
    },
    onError: (e) => toast.error(formatApiError(e, 'That didn’t link. Try again.')),
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (orgId) link.mutate();
      }}
    >
      <label htmlFor="link-org" className="text-label font-medium text-text">
        Give to a company
      </label>
      <Select id="link-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
        <option value="">Choose a company…</option>
        {orgs.data?.organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <p className="m-0 text-caption text-text-3">Or leave it here and answer it as a sales lead.</p>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={!orgId}
        loading={link.isPending}
        className="justify-self-start"
      >
        Link to company
      </Button>
    </form>
  );
}

/** Asks for notification permission only from this click, never on page load. */
function AlertsButton() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  useEffect(() => setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission), []);
  if (perm === 'unsupported') return null;
  if (perm === 'granted') {
    return (
      <p className="m-0 flex min-h-11 items-center gap-2 text-label text-text-2">
        <Bell aria-hidden strokeWidth={1.5} className="size-4" /> Alerts on while this tab is open
      </p>
    );
  }
  if (perm === 'denied') {
    return (
      <p className="m-0 flex min-h-11 items-center gap-2 text-label text-text-2">
        <BellOff aria-hidden strokeWidth={1.5} className="size-4" /> Alerts are blocked in this browser’s site settings
      </p>
    );
  }
  return (
    <Button variant="secondary" onClick={() => void Notification.requestPermission().then(setPerm)}>
      <Bell aria-hidden strokeWidth={1.5} /> Turn on alerts
    </Button>
  );
}

/** A browser notification per ticket with a new customer message, after the first load. */
function useNewMessageAlerts(tickets: AdminTicket[] | undefined) {
  const since = useRef<string | null>(null);
  useEffect(() => {
    if (!tickets) return;
    const fresh = newCustomerMessages(tickets, since.current);
    since.current = latestMessageAt(tickets, since.current) ?? new Date(0).toISOString();
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const t of fresh) {
      const n = new Notification(`${t.requesterName ?? t.requesterEmail}: ${t.subject}`, {
        body: t.lastMessage?.body.slice(0, 140),
        tag: `support-${t.id}`,
      });
      n.onclick = () => {
        window.focus();
        window.location.search = `?t=${t.id}`;
      };
    }
  }, [tickets]);
}
