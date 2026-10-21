'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  CirclePause,
  Clock,
  FileCheckCorner,
  PhoneOff,
  PhoneOutgoing,
  UsersRound,
} from 'lucide-react';
import { getTelephonyStatus, startOutboundCall, type HiringQueueItem } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import {
  groupQueueByJob,
  hiringPeopleQueryKey,
  homeQueryKey,
  type HomeQueue,
  type HomeSnapshot,
} from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { getStateMeta } from '@/lib/status-labels';
import { useUseCase } from '@/lib/use-cases';
import { Agent } from '@/components/brand/agent';
import type { AgentState } from '@/components/brand/agent-draw';
import { UserInitials } from '@/components/shared/user-initials';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ConfirmDialog } from '@/components/ui/confirm';
import { EmptyState, IconTile } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/notice';
import { StatusTag } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, RowLayoutContext } from '@/components/ui/strip';
import { callGate, NO_LINE_REASON, namesLine } from './copy';

/*
  Home in the D2 language: a sky-gradient hero for the queue that matters most (ready for
  review), where the agent shows how its calls went, beside a white card for calls that didn't
  connect, then three counts and the people not called yet, grouped by job. Every number is
  the true total from the server; lists say "Showing 5 of 9" when they hold fewer.
*/

const CARD = 'rounded-card border border-border bg-canvas';

/**
 * The sky card. White text passes 4.5:1 on both ends of the gradient (4.53 at the light end).
 * The transparent border draws an edge in forced colours, where the gradient is dropped.
 */
export const HERO =
  'relative isolate flex flex-col overflow-hidden rounded-canvas border border-transparent bg-sky p-6 text-primary-foreground sm:p-7';

/**
 * The agent in the hero's top right corner, in pearl glass on the sky, with soft rings around it
 * (the voice motif). Its state mirrors the queue: a tick once calls are done and waiting, idle
 * otherwise. The words beside it carry the same news, so it stays decorative. The rings are
 * drawn from sm up, where the text keeps clear of the corner.
 */
export function HeroAgent({ state }: { state: AgentState }) {
  const ring = 'absolute rounded-pill border border-[var(--glass-border)]';
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 -z-10 hidden size-64 rounded-pill [background:radial-gradient(closest-side,var(--glass),transparent)] forced-colors:hidden sm:block"
      >
        {/* Centred on the agent (64px in from the corner), the outer ring clear of the heading. */}
        <span className={cn(ring, 'inset-7 opacity-40')} />
        <span className={cn(ring, 'inset-[3.25rem] opacity-60')} />
        <span className={cn(ring, 'inset-[4.75rem] opacity-80')} />
      </span>
      <Agent size={72} state={state} hoverable className="absolute right-5 top-5 size-14 sm:right-7 sm:top-7 sm:size-[4.5rem]" />
    </>
  );
}

/** The hero's top row: a frosted icon chip and the section's name (D2's chips). */
export function HeroLabel({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-pill border border-[var(--glass-border)] bg-[var(--glass)] [&_svg]:size-[1.125rem] [&_svg]:[stroke-width:1.5]"
      >
        {icon}
      </span>
      <h2 id={id} className="m-0 text-label font-medium">
        {children}
      </h2>
    </div>
  );
}

/** A person's page on their job's board; `results` opens their answers. */
function personHref(item: HiringQueueItem, results = false): string {
  const href = `/jobs/${toPublicId(item.jobId)}/candidates?c=${encodeURIComponent(toPublicId(item.candidateId))}`;
  return results ? `${href}&tab=results` : href;
}

const itemKey = (item: HiringQueueItem) => `${item.jobId}:${item.candidateId}`;

function CardHeader({
  id,
  title,
  count,
  headingRef,
}: {
  id: string;
  title: string;
  count: number;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex min-h-[4.25rem] items-center px-5 pt-3">
      {/* Focus lands here after a call is placed, when the row that opened the dialog is gone. */}
      <h2 id={id} ref={headingRef} tabIndex={-1} className="m-0 flex items-center gap-2.5 text-section text-text">
        {title}{' '}
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-subtle px-2 text-caption font-medium tabular-nums text-text-2">
          {count}
        </span>
      </h2>
    </div>
  );
}

/** Under a list that holds fewer than the total: how many are shown, and where the rest are. */
function Showing({ shown, total, children }: { shown: number; total: number; children?: ReactNode }) {
  return (
    <div className="mt-auto flex min-h-12 items-center justify-between gap-3 border-t border-border px-5 py-1">
      <p className="m-0 text-meta tabular-nums text-text-3">
        Showing {shown} of {total}
      </p>
      {children}
    </div>
  );
}

/** Totals are real but names need permission (the summary leaves items empty). */
function NoNames({ who }: { who: string }) {
  return (
    <p className="m-0 border-t border-border px-5 py-6 text-text-2">
      Ask a workspace admin for access to {who} to see who.
    </p>
  );
}

// --- Calling -------------------------------------------------------------------------------

type AskCall = (item: HiringQueueItem, again: boolean, returnFocus: HTMLElement | null) => void;

/** Call now and Call again place a real phone call, so both confirm first. */
function useCallAction() {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<{
    item: HiringQueueItem;
    again: boolean;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placed = useRef(false);

  const ask: AskCall = (item, again, returnFocus) => {
    setRequest({ item, again, returnFocus });
    setError(null);
    setOpen(true);
  };

  async function place() {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startOutboundCall(request.item.jobId, request.item.candidateId);
      placed.current = true;
      setOpen(false);
      toast.success(`Calling ${request.item.fullName}`);
      // The person leaves this queue for a call in progress.
      void queryClient.invalidateQueries({ queryKey: homeQueryKey });
      void queryClient.invalidateQueries({ queryKey: hiringPeopleQueryKey });
    } catch (e) {
      const message = toUserMessage(e, 'place the call');
      setError(messageText(message));
    } finally {
      setBusy(false);
    }
  }

  const dialog = request ? (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={`Call ${request.item.fullName} ${request.again ? 'again' : 'now'}?`}
      body={`This places a real phone call. The agent asks ${request.item.fullName} the questions you set for ${request.item.jobTitle}.`}
      confirmLabel={request.again ? 'Call again' : 'Call now'}
      tone="real-world"
      busy={busy}
      error={error}
      onConfirm={() => void place()}
      onCloseAutoFocus={(event) => {
        // The row that opened the dialog leaves the list once the call is placed.
        if (!placed.current) return;
        placed.current = false;
        event.preventDefault();
        request.returnFocus?.focus();
      }}
    />
  ) : null;

  return { ask, dialog };
}

// --- Cards -----------------------------------------------------------------------------------

function ReviewHero({ queue, canSeeCalls }: { queue: HomeQueue; canSeeCalls: boolean }) {
  const first = queue.items[0];
  const names = namesLine(
    queue.items.map((item) => item.fullName),
    queue.total,
  );
  return (
    <section aria-labelledby="home-review" className={cn(HERO, 'xl:col-span-5')}>
      <HeroAgent state={queue.total > 0 ? 'done' : 'idle'} />
      <HeroLabel id="home-review" icon={<FileCheckCorner />}>
        Ready for review
      </HeroLabel>
      {/* Centred between the label and the pill when the card beside it makes this one taller. */}
      <div className="my-auto py-7">
        {queue.total > 0 ? (
          <>
            <p className="m-0 flex items-baseline gap-2.5">
              {/* The number Home leads with: proportional figures, the same sans. */}
              <span className="text-[3.5rem] font-semibold leading-none tracking-[-0.045em]">{queue.total}</span>
              <span className="text-section font-medium">{queue.total === 1 ? 'call' : 'calls'}</span>
            </p>
            <p className="mb-0 mt-3 max-w-[34ch] text-body">
              {names
                ? `${names} ${queue.total === 1 ? 'is' : 'are'} waiting on your decision.`
                : 'Ask a workspace admin for access to candidates to review them.'}
            </p>
          </>
        ) : (
          <>
            <p className="m-0 text-section">Nothing to review right now</p>
            <p className="mb-0 mt-2 max-w-[34ch] text-body">Answers land here as soon as a call ends.</p>
          </>
        )}
      </div>
      <div className="flex">
        {first ? (
          <Button asChild>
            <Link href={personHref(first, true)}>
              Review now
              <ArrowUpRight aria-hidden strokeWidth={1.5} />
            </Link>
          </Button>
        ) : queue.total === 0 && canSeeCalls ? (
          <Button asChild variant="secondary">
            <Link href="/calls">See recent calls</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

const VISIBLE_NOT_CONNECTED = 5;

type CallGate = ReturnType<typeof callGate>;

/** Why the call buttons are off, said once per card; each button points at it. */
function NoLineNote({ id }: { id: string }) {
  return (
    <p id={id} className="m-0 px-5 pb-3 text-meta text-text-2">
      {NO_LINE_REASON}{' '}
      <Link
        href="/settings?section=workspace"
        className="font-medium text-text underline underline-offset-4 hover:decoration-2"
      >
        See your calling number
      </Link>
    </p>
  );
}

function NotConnectedCard({
  queue,
  gate,
  canSeeCalls,
  onCall,
}: {
  queue: HomeQueue;
  gate: CallGate;
  canSeeCalls: boolean;
  onCall: AskCall;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Five rows keep this card level with the hero beside it; the rest are a click away.
  const shown = queue.items.slice(0, VISIBLE_NOT_CONNECTED);
  return (
    <section aria-labelledby="home-not-connected" className={cn(CARD, 'flex flex-col overflow-hidden xl:col-span-7')}>
      <CardHeader id="home-not-connected" headingRef={heading} title="Calls that didn’t connect" count={queue.total} />
      {queue.total === 0 ? (
        // An icon, not the agent: the hero beside this card already shows it.
        <EmptyState
          headingLevel={3}
          icon={<PhoneOff />}
          title="No calls to retry"
          description="When a call doesn’t connect, it shows up here with the reason."
          className="my-auto py-10"
        />
      ) : shown.length === 0 ? (
        <NoNames who="candidates" />
      ) : (
        <>
          {gate === 'no-line' ? <NoLineNote id="home-not-connected-no-line" /> : null}
          <ul role="list" className="m-0 mt-2 list-none divide-y divide-border border-t border-border p-0">
            <RowLayoutContext.Provider value="rows">
              {shown.map((item) => (
                <li key={itemKey(item)}>
                  <ListRow className="px-5">
                    <ListRowPrimary
                      avatar={<UserInitials name={item.fullName} />}
                      title={item.fullName}
                      meta={item.jobTitle}
                      href={personHref(item)}
                    />
                    <ListCell kind="tag">
                      <StatusTag domain="call" value={item.callStatus} failureReason={item.failureReason} />
                    </ListCell>
                    {gate !== 'hidden' ? (
                      <ListCell kind="actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={gate !== 'ready'}
                          aria-describedby={gate === 'no-line' ? 'home-not-connected-no-line' : undefined}
                          onClick={() => onCall(item, true, heading.current)}
                        >
                          <PhoneOutgoing aria-hidden strokeWidth={1.5} />
                          Call again<span className="sr-only"> {item.fullName}</span>
                        </Button>
                      </ListCell>
                    ) : null}
                  </ListRow>
                </li>
              ))}
            </RowLayoutContext.Provider>
          </ul>
          {shown.length < queue.total ? (
            <Showing shown={shown.length} total={queue.total}>
              {canSeeCalls ? (
                <Button asChild variant="tertiary" size="sm" className="-mr-2">
                  <Link href="/calls?status=failed">
                    See all<span className="sr-only"> calls that didn’t connect</span>
                    <ChevronRight aria-hidden strokeWidth={1.5} />
                  </Link>
                </Button>
              ) : null}
            </Showing>
          ) : null}
        </>
      )}
    </section>
  );
}

interface Stat {
  label: string;
  /** null: this person can't see the number. */
  value: number | null;
  icon: ReactNode;
  href?: string;
}

function StatCard({ label, value, icon, href }: Stat) {
  const body = (
    <>
      {/* Three across anything narrower than xl leaves no room for the tile: the label keeps it. */}
      <IconTile className="max-xl:hidden">{icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className="block text-meta text-text-2 sm:truncate sm:text-label">{label}</span>
        {value === null ? (
          <span className="mt-1 block text-meta text-text-3">Not shared with you</span>
        ) : (
          <span className="mt-0.5 block text-subpage text-text sm:text-page">{value}</span>
        )}
      </span>
      {href ? (
        <ChevronRight
          aria-hidden
          strokeWidth={1.5}
          className="size-5 shrink-0 text-text-3 transition-[translate] duration-fast group-hover:translate-x-0.5 max-sm:hidden"
        />
      ) : null}
    </>
  );
  // Phones: three small tiles in a row, label over the number.
  const box = cn(CARD, 'flex h-full min-h-[5.75rem] items-center gap-4 p-3 sm:p-4');
  return href && value !== null ? (
    <Link href={href} className={cn(box, 'group transition-shadow duration-fast hover:shadow-card')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function StatCards({ snapshot, canReadCandidates }: { snapshot: HomeSnapshot; canReadCandidates: boolean }) {
  const { labels, stages } = useUseCase();
  const stageLabel = (value: string) => stages.find((stage) => stage.value === value)?.label ?? value;
  const stats: Stat[] = [
    {
      label: `Open ${labels.workItem.many.toLowerCase()}`,
      value: snapshot.openJobs,
      icon: <BriefcaseBusiness />,
      href: '/jobs',
    },
    {
      // The not-called queue: a call's state, in the call map's words, not the undecided stage's.
      label: getStateMeta('call', 'not_called').label,
      value: snapshot.queues?.notCalled.total ?? null,
      icon: <Clock />,
      href: '#not-called',
    },
    {
      label: stageLabel('screening'),
      value: snapshot.queues?.onHold.total ?? null,
      icon: <CirclePause />,
      href: canReadCandidates ? '/candidates?stage=screening' : undefined,
    },
  ];
  return (
    <ul role="list" aria-label="At a glance" className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:gap-4">
      {stats.map((stat) => (
        <li key={stat.label}>
          <StatCard {...stat} />
        </li>
      ))}
    </ul>
  );
}

// The whole tile opens the person; the focus ring is drawn on the tile, not around the name.
const TILE_OPENER =
  'min-w-0 flex-1 truncate font-medium text-text after:absolute after:inset-0 after:rounded-card-sm focus-visible:shadow-none focus-visible:outline-none focus-visible:after:[outline:2px_solid_var(--focus-ring)] focus-visible:after:[outline-offset:2px]';

function NotCalledCard({
  queue,
  gate,
  canSeeCandidates,
  onCall,
}: {
  queue: HomeQueue;
  gate: CallGate;
  canSeeCandidates: boolean;
  onCall: AskCall;
}) {
  const { labels } = useUseCase();
  const heading = useRef<HTMLHeadingElement>(null);
  const groups = groupQueueByJob(queue.items);
  const contacts = labels.contact.many.toLowerCase();
  return (
    <section id="not-called" aria-labelledby="home-not-called" className={cn(CARD, 'scroll-mt-6')}>
      <CardHeader id="home-not-called" headingRef={heading} title="Not called yet" count={queue.total} />
      {queue.total === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={<UsersRound />}
          title="Everyone has been called"
          description={`New ${contacts} you add to a ${labels.workItem.one.toLowerCase()} wait here until they’re called.`}
          className="pb-10 pt-4"
        />
      ) : groups.length === 0 ? (
        <NoNames who={contacts} />
      ) : (
        <div className="space-y-4 px-5 pb-5">
          {gate === 'no-line' ? (
            <div className="-mx-5">
              <NoLineNote id="home-not-called-no-line" />
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.jobId}>
              <h3 className="m-0">
                <Link
                  href={`/jobs/${toPublicId(group.jobId)}/candidates?stage=new`}
                  className="-ml-1 inline-flex min-h-11 max-w-full items-center gap-1 rounded-input px-1 text-label font-medium text-text-2 transition-colors hover:text-text"
                >
                  <span className="truncate">{group.jobTitle}</span>
                  <ChevronRight aria-hidden strokeWidth={1.5} className="size-4 shrink-0" />
                </Link>
              </h3>
              <ul role="list" className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => (
                  <li
                    key={itemKey(item)}
                    className="relative flex min-h-16 items-center gap-3 rounded-card-sm border border-border bg-canvas py-2 pl-3 pr-2 transition-shadow duration-fast has-[a:hover]:shadow-card"
                  >
                    <UserInitials name={item.fullName} />
                    <Link href={personHref(item)} className={TILE_OPENER}>
                      {item.fullName}
                    </Link>
                    {gate !== 'hidden' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="relative z-10"
                        disabled={gate !== 'ready'}
                        aria-describedby={gate === 'no-line' ? 'home-not-called-no-line' : undefined}
                        onClick={() => onCall(item, false, heading.current)}
                      >
                        <PhoneOutgoing aria-hidden strokeWidth={1.5} />
                        Call now<span className="sr-only"> {item.fullName}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {queue.items.length > 0 && queue.items.length < queue.total ? (
        <Showing shown={queue.items.length} total={queue.total}>
          {canSeeCandidates ? (
            <Button asChild variant="tertiary" size="sm" className="-mr-2">
              <Link href="/candidates?stage=new">
                See all<span className="sr-only"> {contacts} not called yet</span>
                <ChevronRight aria-hidden strokeWidth={1.5} />
              </Link>
            </Button>
          ) : null}
        </Showing>
      ) : null}
    </section>
  );
}

/** Home once setup is done: the queues and the counts behind them. */
export function Queues({ snapshot, can }: { snapshot: HomeSnapshot; can: (permission: string) => boolean }) {
  const call = useCallAction();
  const queues = snapshot.queues;
  // The same calling-number check as Settings and the job pages: a permission alone can't place a call.
  const canCall = can('calls.initiate');
  const telephony = useQuery({ queryKey: ['telephony-status'], queryFn: getTelephonyStatus, enabled: canCall });
  const gate = callGate(canCall, telephony.data, telephony.isError);
  return (
    <div className="space-y-4">
      {queues ? (
        <div className="grid gap-4 xl:grid-cols-12">
          <ReviewHero queue={queues.readyForReview} canSeeCalls={can('agents.sessions.read')} />
          <NotConnectedCard
            queue={queues.notConnected}
            gate={gate}
            canSeeCalls={can('agents.sessions.read')}
            onCall={call.ask}
          />
        </div>
      ) : (
        <Alert kind="info" title="Candidates aren’t shared with you">
          Ask a workspace admin for access to see calls to review and retry.
        </Alert>
      )}
      <StatCards snapshot={snapshot} canReadCandidates={can('candidates.read')} />
      {queues ? (
        <NotCalledCard
          queue={queues.notCalled}
          gate={gate}
          canSeeCandidates={can('candidates.read')}
          onCall={call.ask}
        />
      ) : null}
      {call.dialog}
    </div>
  );
}

