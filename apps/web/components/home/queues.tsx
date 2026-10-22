'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  getJob,
  getJobCandidateResults,
  getTelephonyStatus,
  startOutboundCall,
  type HiringQueueItem,
} from '@/lib/api';
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
import { answerItems } from '@/components/candidates/answers';
import { FitChip } from '@/components/candidates/fit-chips';
import { answerCoverage } from '@/components/shared/answers-list';
import { UserInitials } from '@/components/shared/user-initials';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ConfirmDialog } from '@/components/ui/confirm';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/notice';
import { StatusTag } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, RowLayoutContext } from '@/components/ui/strip';
import { callGate, NO_LINE_REASON } from './copy';

/*
  Home once setup is done. What needs the recruiter now leads: calls ready for review, full
  width, each row with how many questions were answered and the call's one-line summary, so a
  phone review needs fewer opens. Then calls that didn't connect beside a short "at a glance"
  list, then the people not called yet, grouped by job. Every number is the true total from
  the server; lists say "Showing 5 of 9" when they hold fewer.
*/

const CARD = 'rounded-card border border-border bg-canvas';

/** A person's page on their job's board; `results` opens their answers. */
function personHref(item: HiringQueueItem, results = false): string {
  // Answers are read on Review; everyone else is found on People.
  const href = `/jobs/${toPublicId(item.jobId)}/${results ? 'review' : 'people'}?c=${encodeURIComponent(toPublicId(item.candidateId))}`;
  return results ? `${href}&tab=results` : href;
}

const itemKey = (item: HiringQueueItem) => `${item.jobId}:${item.candidateId}`;

function CardHeader({
  id,
  title,
  count,
  headingRef,
  lead,
  action,
}: {
  id: string;
  title: string;
  count: number;
  headingRef?: Ref<HTMLHeadingElement>;
  lead?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[4.25rem] items-center gap-3 px-5 pt-3">
      {lead}
      {/* Focus lands here after a call is placed, when the row that opened the dialog is gone. */}
      <h2 id={id} ref={headingRef} tabIndex={-1} className="m-0 flex items-center gap-2.5 text-section text-text">
        {title}{' '}
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-subtle px-2 text-caption font-medium tabular-nums text-text-2">
          {count}
        </span>
      </h2>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
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

const VISIBLE_REVIEW = 5;

/** The latest call's answers and summary for one row; the job's questions decide what counts. */
function useReviewDetails(items: readonly HiringQueueItem[]) {
  const jobIds = [...new Set(items.map((item) => item.jobId))];
  const jobs = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: [...homeQueryKey, 'job', jobId],
      queryFn: () => getJob(jobId),
      staleTime: 60_000,
    })),
  });
  const results = useQueries({
    queries: items.map((item) => ({
      queryKey: [...homeQueryKey, 'results', item.jobId, item.candidateId],
      queryFn: () => getJobCandidateResults(item.jobId, item.candidateId),
      staleTime: 30_000,
    })),
  });
  return items.map((item, i) => {
    const job = jobs[jobIds.indexOf(item.jobId)]?.data;
    const res = results[i];
    const latest = res?.data ? (res.data.results?.voiceSessionId ? res.data.results : res.data.sessions?.[0]) : undefined;
    const coverage =
      latest && job ? answerCoverage(answerItems(latest.structuredAnswers, job.screeningQuestions)) : null;
    return {
      loading: Boolean(res?.isPending),
      failed: Boolean(res?.isError),
      summary: latest?.summary?.trim() || null,
      coverage: coverage && coverage.total > 0 ? coverage : null,
    };
  });
}

/** One dot per question, filled when answered; the words say the same. */
function Coverage({ answered, total }: { answered: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      {total <= 10 ? (
        <span aria-hidden className="inline-flex gap-0.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-1.5 rounded-pill',
                i < answered ? 'bg-text-2 forced-colors:bg-[CanvasText]' : 'border border-border-input',
              )}
            />
          ))}
        </span>
      ) : null}
      {answered} of {total} answered
    </span>
  );
}

function ReviewCard({ queue, canSeeCalls }: { queue: HomeQueue; canSeeCalls: boolean }) {
  const shown = queue.items.slice(0, VISIBLE_REVIEW);
  const details = useReviewDetails(shown);
  const first = shown[0];
  return (
    <section aria-labelledby="home-review" className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <CardHeader
        id="home-review"
        title="Ready for review"
        count={queue.total}
        // The agent reports how its calls went: done once answers are waiting.
        lead={<Agent size={40} state={queue.total > 0 ? 'done' : 'idle'} onLight hoverable className="-my-1 shrink-0" />}
        action={
          first ? (
            <Button asChild size="sm" className="max-sm:hidden">
              <Link href={personHref(first, true)}>
                Review now
                <ArrowUpRight aria-hidden strokeWidth={1.5} />
              </Link>
            </Button>
          ) : null
        }
      />
      {queue.total === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={<FileCheckCorner />}
          title="Nothing to review right now"
          description="Answers land here as soon as a call ends."
          action={
            canSeeCalls ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/calls">See recent calls</Link>
              </Button>
            ) : null
          }
          className="py-10"
        />
      ) : shown.length === 0 ? (
        <NoNames who="candidates" />
      ) : (
        <>
          <ul role="list" className="m-0 mt-2 list-none divide-y divide-border border-t border-border p-0">
            {shown.map((item, i) => {
              const detail = details[i]!;
              return (
                <li key={itemKey(item)}>
                  <Link
                    href={personHref(item, true)}
                    className="group flex min-h-16 items-start gap-3 px-5 py-3.5 transition-colors duration-fast hover:bg-subtle focus-visible:bg-subtle sm:items-center"
                  >
                    <UserInitials name={item.fullName} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-text">{item.fullName}</span>
                        <span className="truncate text-meta text-text-3">{item.jobTitle}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-2">
                        {item.fit ? <FitChip fit={item.fit} /> : null}
                        {detail.coverage ? <Coverage {...detail.coverage} /> : null}
                      </span>
                      <span className="mt-0.5 block text-meta text-text-2 max-sm:line-clamp-2 sm:truncate">
                        {detail.loading ? (
                          <span className="inline-block h-2.5 w-2/3 rounded-pill bg-muted align-middle motion-safe:animate-pulse" />
                        ) : detail.summary ? (
                          detail.summary
                        ) : (
                          <span className="text-text-3">
                            {detail.failed ? 'Couldn’t load the summary. Open to see the call.' : 'No summary for this call.'}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-label font-medium text-text-2 transition-colors group-hover:text-text sm:inline-flex">
                      Review
                      <ChevronRight
                        aria-hidden
                        strokeWidth={1.5}
                        className="size-4 transition-[translate] duration-fast motion-safe:group-hover:translate-x-0.5"
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {shown.length < queue.total ? <Showing shown={shown.length} total={queue.total} /> : null}
        </>
      )}
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
        href="/settings/company"
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

/** The counts behind the queues, as a short list of rows rather than equal tiles. */
function AtAGlance({ snapshot, canReadCandidates }: { snapshot: HomeSnapshot; canReadCandidates: boolean }) {
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
      href: canReadCandidates ? '/people?stage=screening' : undefined,
    },
  ];
  const row = 'flex min-h-14 items-center gap-3 px-5 py-2';
  return (
    <section aria-labelledby="home-glance" className={cn(CARD, 'overflow-hidden xl:col-span-5')}>
      <div className="flex min-h-[4.25rem] items-center px-5 pt-3">
        <h2 id="home-glance" className="m-0 text-section text-text">
          At a glance
        </h2>
      </div>
      <ul role="list" className="m-0 mt-2 list-none divide-y divide-border border-t border-border p-0">
        {stats.map((stat) => {
          const body = (
            <>
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-card-sm bg-subtle text-text-2 [&_svg]:size-[1.125rem] [&_svg]:[stroke-width:1.5]"
              >
                {stat.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-2">{stat.label}</span>
              {stat.value === null ? (
                <span className="text-meta text-text-3">Not shared with you</span>
              ) : (
                <span className="text-title font-semibold tabular-nums text-text">{stat.value}</span>
              )}
              {stat.href && stat.value !== null ? (
                <ChevronRight
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-4 shrink-0 text-text-3 transition-[translate] duration-fast motion-safe:group-hover:translate-x-0.5"
                />
              ) : null}
            </>
          );
          return (
            <li key={stat.label}>
              {stat.href && stat.value !== null ? (
                <Link href={stat.href} className={cn(row, 'group transition-colors duration-fast hover:bg-subtle')}>
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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
                  href={`/jobs/${toPublicId(group.jobId)}/people?stage=new`}
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
              <Link href="/people?stage=new">
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
        <ReviewCard queue={queues.readyForReview} canSeeCalls={can('agents.sessions.read')} />
      ) : (
        <Alert kind="info" title="Candidates aren’t shared with you">
          Ask a workspace admin for access to see calls to review and retry.
        </Alert>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-12">
        {queues ? (
          <NotConnectedCard
            queue={queues.notConnected}
            gate={gate}
            canSeeCalls={can('agents.sessions.read')}
            onCall={call.ask}
          />
        ) : null}
        <AtAGlance snapshot={snapshot} canReadCandidates={can('candidates.read')} />
      </div>
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

