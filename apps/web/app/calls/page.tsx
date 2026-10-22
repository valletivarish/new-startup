'use client';

/**
 * Calls (D2): every phone call and test call in the browser, newest first. Live calls sit on top
 * as cards the agent acts out, with End call. One candidate's history (?candidateId=) lays out
 * each call's summary, answers, recording and transcript.
 */

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ListFilter, RotateCw } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ScreeningSessionCard } from '@/components/candidates/ScreeningSessionCard';
import { LiveCallCard } from '@/components/shared/live-call-card';
import { UserInitials } from '@/components/shared/user-initials';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import { SkeletonCard, SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { StatusTag } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import {
  ApiClientError,
  endVoiceSession,
  getJob,
  getTelephonyStatus,
  listJobs,
  listVoiceSessions,
  reconcileVoiceSession,
  type CandidateScreeningResults,
  type Job,
  type VoiceSession,
} from '@/lib/api';
import { loginPathForReturn } from '@/lib/auth-redirect';
import { toUserMessage } from '@/lib/errors';
import { formatDuration, formatWhen } from '@/lib/format';
import { fromPublicId, toPublicId } from '@/lib/public-id';
import { useMe } from '@/lib/use-me';
import { useOnline } from '@/lib/use-online';

type StatusFilter = 'all' | 'live' | 'ended' | 'failed';
type ChannelFilter = 'all' | 'phone' | 'browser';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live now' },
  { value: 'ended', label: 'Ended' },
  { value: 'failed', label: 'Didn’t connect' },
];
const CHANNEL_FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: 'all', label: 'All channels' },
  { value: 'phone', label: 'Phone' },
  { value: 'browser', label: 'Browser' },
];

// On a phone the filter tracks span the column; each option keeps its label's width and takes a
// share of what is left.
const FILL_ON_PHONES = 'max-sm:w-full max-sm:[&>button]:grow';

// The list endpoint answers with the newest 50 calls at most.
const NEWEST = 50;
// Live calls drawn as cards; any more stay in the list (at most three agents on screen).
const LIVE_CARDS = 3;

const isLive = (s: VoiceSession) => s.status === 'active' || s.status === 'pending';
const isBrowser = (s: VoiceSession) => s.channel === 'browser_demo' || s.channel === 'browser';
const channelWord = (s: VoiceSession) => (isBrowser(s) ? 'Test call in browser' : 'Phone');
const nameOf = (s: VoiceSession) => s.candidateName || (isBrowser(s) ? 'Test call in browser' : 'Call');

/** A call as the results packet the candidate sheet reads, so both draw the same evidence card. */
function asResults(s: VoiceSession): CandidateScreeningResults {
  return {
    voiceSessionId: s.id,
    status: s.status,
    transcript: s.transcript?.filter((turn) => turn.message?.trim()) ?? null,
    summary: s.summary,
    structuredAnswers: s.structuredAnswers,
    costCredits: null,
    recordingAvailable: s.status === 'ended' && Boolean(s.externalConversationId),
    startedAt: s.startedAt,
    durationSeconds: s.durationSeconds,
    failureReason: s.failureReason,
  };
}

/** What to do about a call that didn't connect, by the reason the API gives. */
const RETRY_HINT: Record<string, string> = {
  no_answer: 'They didn’t pick up. Try again at another time of day.',
  busy: 'Their line was busy. Try again in a little while.',
  voicemail: 'The call reached voicemail, so nothing was asked. Try again later.',
  line_not_connected: 'Your calling number isn’t connected yet. Until it is, use a test call in your browser.',
  invalid_number: 'The mobile number doesn’t look right. Fix it on their job, then call again.',
};
function retryHint(reason: string | null | undefined): string {
  return (reason && Object.hasOwn(RETRY_HINT, reason) ? RETRY_HINT[reason] : undefined) ??
    'The call didn’t go through. Call again from their job, and check the mobile number if it keeps happening.';
}

export default function CallsPage() {
  return (
    <Suspense
      fallback={
        <AppShell profile={null}>
          <PageMain>
            <SkeletonRows rows={5} />
          </PageMain>
        </AppShell>
      }
    >
      <CallsPageInner />
    </Suspense>
  );
}

function CallsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useMe();
  const profile = me.data ?? null;
  const online = useOnline();
  const filterCandidateId = searchParams.get('candidateId');
  const statusParam = searchParams.get('status');
  const channelParam = searchParams.get('channel');
  const jobParam = searchParams.get('job');
  const statusFilter: StatusFilter =
    statusParam === 'live' || statusParam === 'ended' || statusParam === 'failed' ? statusParam : 'all';
  const channelFilter: ChannelFilter = channelParam === 'phone' || channelParam === 'browser' ? channelParam : 'all';
  const jobFilterId = jobParam && jobParam !== 'all' ? (fromPublicId(jobParam) ?? jobParam) : 'all';

  const [jobs, setJobs] = useState<Job[]>([]);
  // Calls with the view they were loaded for, so another view's list never shows while the
  // next one loads (all calls, one job, one candidate).
  const viewKey = `${filterCandidateId ?? ''}|${jobFilterId}`;
  const [loaded, setLoaded] = useState<{ key: string; sessions: VoiceSession[] } | null>(null);
  const sessions = loaded?.key === viewKey ? loaded.sessions : null;
  const [telephony, setTelephony] = useState<{ outboundPhone: boolean; openOutbound: boolean } | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // A quiet refresh (polling, after an action) that failed while the list stays on screen.
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // One candidate's history reads their job's questions, so answers show as question and answer.
  const [questions, setQuestions] = useState<Job['screeningQuestions']>([]);

  useEffect(() => {
    if (me.error instanceof ApiClientError && me.error.status === 401) router.push(loginPathForReturn());
  }, [me.error, router]);

  function setActivityFilters(next: { status?: StatusFilter; channel?: ChannelFilter; job?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const status = next.status ?? statusFilter;
    const channel = next.channel ?? channelFilter;
    const job = next.job ?? jobParam ?? 'all';
    if (status === 'all') params.delete('status');
    else params.set('status', status);
    if (channel === 'all') params.delete('channel');
    else params.set('channel', channel);
    if (!job || job === 'all') params.delete('job');
    else params.set('job', job);
    const qs = params.toString();
    router.replace(qs ? `/calls?${qs}` : '/calls');
  }

  const reload = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = Boolean(opts?.quiet);
      if (!quiet) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        // A quiet refresh only needs the calls; the jobs and calling number rarely change.
        const [list, tel, jobList] = await Promise.all([
          listVoiceSessions({
            candidateId: filterCandidateId || undefined,
            jobId: jobFilterId === 'all' ? undefined : jobFilterId,
          }),
          quiet ? null : getTelephonyStatus().catch(() => null),
          quiet ? null : listJobs().catch(() => null),
        ]);
        setLoaded({ key: `${filterCandidateId ?? ''}|${jobFilterId}`, sessions: list.sessions });
        setRefreshError(null);
        if (tel) setTelephony({ outboundPhone: tel.outboundPhone, openOutbound: Boolean(tel.openOutbound) });
        if (jobList) setJobs(jobList.jobs);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) router.push(loginPathForReturn());
        else if (quiet) setRefreshError(e);
        else setLoadError(e);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [router, filterCandidateId, jobFilterId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const historyJobId = filterCandidateId ? (sessions?.find((s) => s.jobId)?.jobId ?? null) : null;
  useEffect(() => {
    if (!historyJobId) return;
    let cancelled = false;
    getJob(historyJobId)
      .then((job) => {
        if (!cancelled) setQuestions(job.screeningQuestions ?? []);
      })
      // Without them the answers still show, listed as what was mentioned.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [historyJobId]);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canReconcile = can('calls.initiate') || can('agents.test');
  const canPlayRecording = can('calls.read_recording');

  const hasLive = (sessions ?? []).some(isLive);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    if (!hasLive) return;
    let cancelled = false;

    async function tick() {
      const live = (sessionsRef.current ?? []).filter((s) => isLive(s) && Boolean(s.agentId));
      if (canReconcile) {
        await Promise.all(
          live.map(async (session) => {
            try {
              await reconcileVoiceSession(session.agentId!, session.id);
            } catch {
              /* next poll retries */
            }
          }),
        );
      }
      if (!cancelled) await reload({ quiet: true });
    }

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hasLive, canReconcile, reload]);

  // Opened from a row: bring that call into view once the history is drawn, once (live calls
  // refresh the list every 5 seconds).
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!filterCandidateId || !sessions?.length) return;
    const hash = window.location.hash.slice(1);
    if (!hash || scrolledTo.current === hash) return;
    scrolledTo.current = hash;
    document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, [filterCandidateId, sessions]);

  async function onEnd(session: VoiceSession) {
    if (!session.agentId) {
      toast.error('Couldn’t end this call', { description: 'It isn’t linked to an agent. Reload the page, then try again.' });
      return;
    }
    setBusyId(session.id);
    try {
      await endVoiceSession(session.agentId, session.id);
      await reload({ quiet: true });
    } catch (e) {
      const m = toUserMessage(e, 'end the call');
      toast.error(m.title, { description: m.detail });
    } finally {
      setBusyId(null);
    }
  }

  async function onRefreshResults(session: VoiceSession) {
    if (!session.agentId) return;
    setBusyId(session.id);
    try {
      await reconcileVoiceSession(session.agentId, session.id);
      await reload({ quiet: true });
      toast.success('Results updated');
    } catch (e) {
      const m = toUserMessage(e, 'load the results');
      toast.error(m.title, { description: m.detail });
    } finally {
      setBusyId(null);
    }
  }

  const all = sessions ?? [];
  const visible = all.filter((s) => {
    if (statusFilter === 'live' && !isLive(s)) return false;
    if (statusFilter === 'ended' && s.status !== 'ended') return false;
    if (statusFilter === 'failed' && s.status !== 'failed') return false;
    if (channelFilter === 'phone' && s.channel !== 'phone') return false;
    if (channelFilter === 'browser' && !isBrowser(s)) return false;
    return true;
  });
  const filtering = statusFilter !== 'all' || channelFilter !== 'all' || jobFilterId !== 'all';
  const candidateName = all.find((s) => s.candidateName)?.candidateName ?? null;
  const showSkeleton = useHeldLoading(loading && sessions === null);

  let body: ReactNode;
  if (loadError && !sessions) {
    body = online ? (
      <LoadError error={loadError} onRetry={() => void reload()} retrying={loading} />
    ) : (
      <ErrorState variant="offline" onRetry={() => void reload()} retrying={loading} />
    );
  } else if (showSkeleton || !sessions) {
    body = filterCandidateId ? <SkeletonCard /> : <SkeletonRows rows={5} />;
  } else if (filterCandidateId) {
    body = (
      <History
        sessions={visible}
        candidateName={candidateName}
        questions={questions}
        canPlayRecording={canPlayRecording}
        canReconcile={canReconcile}
        busyId={busyId}
        onEnd={(s) => void onEnd(s)}
        onRefresh={(s) => void onRefreshResults(s)}
      />
    );
  } else {
    body = (
      <AllCalls
        visible={visible}
        total={all.length}
        filtering={filtering}
        statusFilter={statusFilter}
        canReconcile={canReconcile}
        busyId={busyId}
        onEnd={(s) => void onEnd(s)}
        onRefresh={(s) => void onRefreshResults(s)}
        onShowAll={() => router.replace('/calls')}
      />
    );
  }

  const crumbs = filterCandidateId
    ? [{ label: 'Calls', href: '/calls' }, { label: candidateName ?? 'Call history' }]
    : undefined;

  return (
    <AppShell profile={profile} breadcrumb={crumbs}>
      <PageMain>
        {filterCandidateId && crumbs ? (
          <PageHeader
            breadcrumb={<Breadcrumb items={crumbs} />}
            title={candidateName ?? 'Call history'}
            description={
              candidateName
                ? `Every call with ${candidateName}, newest first.`
                : 'Every call with this candidate, newest first.'
            }
            actions={
              <>
                <Button asChild variant="secondary">
                  <Link href="/calls">All calls</Link>
                </Button>
                {historyJobId ? (
                  <Button asChild>
                    <Link
                      href={`/jobs/${toPublicId(historyJobId)}/people?c=${encodeURIComponent(toPublicId(filterCandidateId))}`}
                    >
                      Open on their job
                    </Link>
                  </Button>
                ) : null}
              </>
            }
          />
        ) : (
          <PageHeader
            title="Every call,"
            accent="on the record"
            description="Phone calls and test calls in your browser, newest first. Open a call to read what was said and hear it again."
          />
        )}

        {!filterCandidateId ? <CallingNumberNote telephony={telephony} /> : null}

        {!filterCandidateId && sessions && (all.length > 0 || filtering) ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Segmented
              label="Show calls that are"
              options={STATUS_FILTERS}
              value={statusFilter}
              onValueChange={(status) => setActivityFilters({ status })}
              className={FILL_ON_PHONES}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Segmented
                label="Show calls by"
                options={CHANNEL_FILTERS}
                value={channelFilter}
                onValueChange={(channel) => setActivityFilters({ channel })}
                className={FILL_ON_PHONES}
              />
              <Select
                value={jobParam && jobParam !== 'all' ? jobParam : 'all'}
                onChange={(e) => setActivityFilters({ job: e.target.value })}
                aria-label="Show calls for"
                className="sm:w-56"
              >
                <option value="all">All jobs</option>
                {jobs.map((job) => (
                  <option key={job.id} value={toPublicId(job.id)}>
                    {job.title}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}

        {refreshError ? (
          <Alert
            kind="warning"
            title="Couldn’t refresh the calls"
            action={
              <Button variant="secondary" size="sm" onClick={() => void reload({ quiet: true })}>
                Retry
              </Button>
            }
          >
            {toUserMessage(refreshError).detail} What you see may be a few seconds old.
          </Alert>
        ) : null}

        {body}
      </PageMain>
    </AppShell>
  );
}

function LoadError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const message = toUserMessage(error, 'load calls');
  return <ErrorState title={message.title} cause={message.detail} onRetry={onRetry} retrying={retrying} />;
}

/** Only while phone calls are limited: what works today, in plain words. */
function CallingNumberNote({ telephony }: { telephony: { outboundPhone: boolean; openOutbound: boolean } | null }) {
  if (!telephony || telephony.openOutbound) return null;
  return telephony.outboundPhone ? (
    <Alert kind="info" title="Your calling number is connected">
      Until the phone carrier finishes its business check, some calls may be turned away. Test calls in your browser
      still work.
    </Alert>
  ) : (
    <Alert kind="info" title="Phone calls aren’t set up yet">
      We set up your company’s calling number with you. Until then, try a test call in your browser from any candidate.
    </Alert>
  );
}

function CountBubble({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-subtle px-2 text-caption font-medium tabular-nums text-text-2">
      {n}
    </span>
  );
}

function AllCalls({
  visible,
  total,
  filtering,
  statusFilter,
  canReconcile,
  busyId,
  onEnd,
  onRefresh,
  onShowAll,
}: {
  visible: VoiceSession[];
  total: number;
  filtering: boolean;
  statusFilter: StatusFilter;
  canReconcile: boolean;
  busyId: string | null;
  onEnd: (s: VoiceSession) => void;
  onRefresh: (s: VoiceSession) => void;
  onShowAll: () => void;
}) {
  if (total === 0 && !filtering) {
    return (
      <EmptyState
        agent="idle"
        title="No calls yet"
        description="Calls show up here the moment the agent places one. Open any candidate to start with a test call in your browser."
        action={
          <Button asChild variant="secondary">
            <Link href="/people">Go to candidates</Link>
          </Button>
        }
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<ListFilter />}
        title="No calls match these filters"
        description="Show every call, or pick another job."
        action={
          <Button variant="secondary" onClick={onShowAll}>
            Show all calls
          </Button>
        }
      />
    );
  }

  const live = statusFilter === 'ended' || statusFilter === 'failed' ? [] : visible.filter(isLive);
  const cards = live.slice(0, LIVE_CARDS);
  const carded = new Set(cards.map((s) => s.id));
  const rest = visible.filter((s) => !carded.has(s.id));

  return (
    <>
      {cards.length > 0 ? (
        <section aria-labelledby="calls-live" className="space-y-3">
          <h2 id="calls-live" className="m-0 flex items-center gap-2.5 text-section text-text">
            Live now <CountBubble n={live.length} />
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((s) => (
              <LiveCallCard
                key={s.id}
                name={nameOf(s)}
                workLabel={[s.jobTitle, channelWord(s)].filter(Boolean).join(' · ')}
                state={s.status}
                startedAt={s.startedAt}
                failureReason={s.failureReason}
                onEnd={s.agentId ? () => onEnd(s) : undefined}
                ending={busyId === s.id}
              />
            ))}
          </div>
          {live.length > cards.length ? (
            <p className="m-0 text-meta text-text-3">
              Showing {cards.length} of {live.length} live calls. The rest are in the list below.
            </p>
          ) : null}
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section aria-labelledby={cards.length > 0 ? 'calls-recent' : undefined} className="space-y-3">
          {cards.length > 0 ? (
            <h2 id="calls-recent" className="m-0 text-section text-text">
              Recent calls
            </h2>
          ) : null}
          <ListRows
            aria-label="Calls"
            columns="minmax(0,1fr) auto auto auto auto"
            header={
              <>
                <span>Call</span>
                <span>When</span>
                <span>Length</span>
                <span>Status</span>
                <span>
                  <span className="sr-only">Actions</span>
                </span>
              </>
            }
          >
            {rest.map((s) => (
              <CallRow
                key={s.id}
                session={s}
                canLoad={canReconcile && Boolean(s.agentId) && s.status === 'ended' && !s.summary}
                busy={busyId === s.id}
                onRefresh={() => onRefresh(s)}
              />
            ))}
          </ListRows>
          {total >= NEWEST ? (
            <p className="m-0 text-meta text-text-3">The {NEWEST} most recent calls. Pick a job to see its own.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function CallRow({
  session: s,
  canLoad,
  busy,
  onRefresh,
}: {
  session: VoiceSession;
  canLoad: boolean;
  busy: boolean;
  onRefresh: () => void;
}) {
  const name = nameOf(s);
  // A candidate's call opens their history at this call; otherwise its job, or the agent it tested.
  const href = s.candidateId
    ? `/calls?candidateId=${encodeURIComponent(s.candidateId)}#call-${s.id}`
    : s.jobId
      ? `/jobs/${toPublicId(s.jobId)}`
      : s.agentId
        ? `/agents/${toPublicId(s.agentId)}`
        : undefined;
  const meta = [s.jobTitle ?? (s.candidateName ? null : s.agentName), s.candidateName ? channelWord(s) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListRow>
      <ListRowPrimary avatar={<UserInitials name={s.candidateName} />} title={name} meta={meta || undefined} href={href} />
      <ListCell kind="meta" className="whitespace-nowrap">
        {formatWhen(s.startedAt)}
      </ListCell>
      <ListCell kind="meta" className="whitespace-nowrap">
        {s.durationSeconds != null && !isLive(s) ? (
          <>
            <span className="sr-only">Length </span>
            {formatDuration(s.durationSeconds)}
          </>
        ) : null}
      </ListCell>
      <ListCell kind="tag">
        <StatusTag domain="call" value={s.status} failureReason={s.failureReason} />
      </ListCell>
      <ListCell kind="actions">
        {canLoad ? (
          <Button variant="tertiary" size="sm" loading={busy} onClick={onRefresh}>
            <RotateCw aria-hidden strokeWidth={1.5} />
            Load results<span className="sr-only"> of the call with {name}</span>
          </Button>
        ) : null}
      </ListCell>
    </ListRow>
  );
}

function History({
  sessions,
  candidateName,
  questions,
  canPlayRecording,
  canReconcile,
  busyId,
  onEnd,
  onRefresh,
}: {
  sessions: VoiceSession[];
  candidateName: string | null;
  questions: Job['screeningQuestions'];
  canPlayRecording: boolean;
  canReconcile: boolean;
  busyId: string | null;
  onEnd: (s: VoiceSession) => void;
  onRefresh: (s: VoiceSession) => void;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        agent="idle"
        title="No calls with this candidate yet"
        description="Call them from their job, or try a test call in your browser first."
        action={
          <Button asChild variant="secondary">
            <Link href="/calls">All calls</Link>
          </Button>
        }
      />
    );
  }
  const newestFirst = [...sessions].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const total = newestFirst.length;
  const who = candidateName ?? 'the candidate';

  return (
    <ol role="list" className="m-0 grid list-none gap-10 p-0">
      {newestFirst.map((s, index) => {
        const number = total - index;
        const failed = s.status === 'failed';
        const canLoad = canReconcile && Boolean(s.agentId) && s.status === 'ended' && !s.transcript?.some((t) => t.message?.trim());
        return (
          <li key={s.id} id={`call-${s.id}`} className="grid scroll-mt-6 gap-4">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h2 className="m-0 text-section text-text">
                  Call {number}
                  {total > 1 && index === 0 ? <span className="font-normal text-text-3"> · latest</span> : null}
                </h2>
                <p className="mb-0 mt-1 text-meta text-text-3">
                  {[channelWord(s), s.jobTitle].filter(Boolean).join(' · ')}
                </p>
              </div>
              {canLoad ? (
                <Button variant="tertiary" size="sm" loading={busyId === s.id} onClick={() => onRefresh(s)}>
                  <RotateCw aria-hidden strokeWidth={1.5} />
                  Load results
                </Button>
              ) : null}
            </div>
            {isLive(s) ? (
              <LiveCallCard
                name={who}
                workLabel={s.jobTitle ?? undefined}
                state={s.status}
                startedAt={s.startedAt}
                onEnd={s.agentId ? () => onEnd(s) : undefined}
                ending={busyId === s.id}
              />
            ) : (
              <>
                {failed ? <p className="m-0 max-w-[65ch] text-body text-text-2">{retryHint(s.failureReason)}</p> : null}
                <ScreeningSessionCard
                  session={asResults(s)}
                  agentId={s.agentId ?? null}
                  candidateName={who}
                  stage=""
                  // A call that never connected answered nothing: no list of unanswered questions.
                  screeningQuestions={failed ? [] : questions}
                  canPlayRecording={canPlayRecording}
                  canCallAgain={false}
                  calling={false}
                />
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
