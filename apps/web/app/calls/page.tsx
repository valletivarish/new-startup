'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Phone } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Badge, statusTone } from '../../components/ui/badge';
import { EmptyState, Notice, PageHeader, PageMain, Surface } from '../../components/ui/page';
import {
  CallMonitor,
  mapSessionStatus,
} from '../../components/calls/CallMonitor';
import {
  DataList,
  DataListBody,
  DataListHeader,
  DataListRow,
} from '../../components/ui/list';
import {
  ApiClientError,
  endVoiceSession,
  getTelephonyStatus,
  listVoiceSessions,
  me,
  reconcileVoiceSession,
  voiceSessionRecordingUrl,
  type Me,
  type VoiceSession,
} from '../../lib/api';
import { loginPathForReturn } from '../../lib/auth-redirect';
import { SkeletonList } from '../../components/ui/skeleton';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Starting',
  active: 'In progress',
  ended: 'Ended',
  failed: 'Failed',
};

export default function CallsPage() {
  return (
    <Suspense
      fallback={
        <AppShell profile={null}>
          <PageMain>
            <SkeletonList rows={3} />
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
  const filterCandidateId = searchParams.get('candidateId');
  const statusParam = searchParams.get('status');
  const channelParam = searchParams.get('channel');
  const statusFilter: 'all' | 'live' | 'ended' | 'failed' =
    statusParam === 'live' ||
    statusParam === 'ended' ||
    statusParam === 'failed'
      ? statusParam
      : 'all';
  const channelFilter: 'all' | 'phone' | 'browser' =
    channelParam === 'phone' || channelParam === 'browser'
      ? channelParam
      : 'all';
  const [profile, setProfile] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [telephonyMessage, setTelephonyMessage] = useState<string | null>(null);
  const [openOutbound, setOpenOutbound] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  function setActivityFilters(next: {
    status?: typeof statusFilter;
    channel?: typeof channelFilter;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const status = next.status ?? statusFilter;
    const channel = next.channel ?? channelFilter;
    if (status === 'all') params.delete('status');
    else params.set('status', status);
    if (channel === 'all') params.delete('channel');
    else params.set('channel', channel);
    const qs = params.toString();
    router.replace(qs ? `/calls?${qs}` : '/calls');
  }

  const reload = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const p = await me();
      setProfile(p);
      try {
        const [list, tel] = await Promise.all([
          listVoiceSessions(
            filterCandidateId ? { candidateId: filterCandidateId } : undefined,
          ),
          getTelephonyStatus().catch(() => null),
        ]);
        setSessions(list.sessions);
        if (tel) {
          setTelephonyMessage(tel.message);
          setOpenOutbound(Boolean(tel.openOutbound));
        }
      } catch (e) {
        setSessions([]);
        if (e instanceof ApiClientError && e.status === 403) {
          setNotice('You do not have access to calls for this company.');
        } else if (!opts?.quiet) setNotice('Could not load calls.');
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push(loginPathForReturn());
      else if (!opts?.quiet) setNotice('Could not load profile.');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, [router, filterCandidateId]);

  async function onEnd(session: VoiceSession) {
    if (!session.agentId) {
      setNotice('Could not end this call — hiring voice link missing.');
      return;
    }
    setBusyId(session.id);
    setNotice(null);
    try {
      await endVoiceSession(session.agentId, session.id);
      await reload({ quiet: true });
    } catch {
      setNotice('Could not end the call. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function onRefreshResults(session: VoiceSession) {
    if (!session.agentId) {
      setNotice('Could not refresh — hiring voice link missing.');
      return;
    }
    setBusyId(session.id);
    setNotice(null);
    try {
      await reconcileVoiceSession(session.agentId, session.id);
      await reload({ quiet: true });
      setNotice('Results updated.');
    } catch (e) {
      setNotice(
        e instanceof ApiClientError
          ? e.message
          : 'Could not refresh results. Try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canReconcile = can('calls.initiate') || can('agents.test');
  const canPlayRecording = can('calls.read_recording');

  const hasLive = sessions.some(
    (s) => s.status === 'active' || s.status === 'pending',
  );
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    if (!hasLive) return;
    let cancelled = false;

    async function tick() {
      const live = sessionsRef.current.filter(
        (s) =>
          (s.status === 'active' || s.status === 'pending') && Boolean(s.agentId),
      );
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

  const visibleSessions = sessions.filter((s) => {
    if (statusFilter === 'live') {
      if (s.status !== 'active' && s.status !== 'pending') return false;
    } else if (statusFilter === 'ended') {
      if (s.status !== 'ended') return false;
    } else if (statusFilter === 'failed') {
      if (s.status !== 'failed') return false;
    }
    if (channelFilter === 'phone' && s.channel !== 'phone') return false;
    if (
      channelFilter === 'browser' &&
      s.channel !== 'browser_demo' &&
      s.channel !== 'browser'
    ) {
      return false;
    }
    return true;
  });

  const filterCandidateName =
    sessions.find((s) => s.candidateName)?.candidateName ?? null;

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain>
          {loading ? (
            <SkeletonList rows={3} />
          ) : notice ? (
            <Notice kind="err">{notice}</Notice>
          ) : null}
        </PageMain>
      </AppShell>
    );
  }

  const liveSessions = visibleSessions.filter(
    (s) => s.status === 'active' || s.status === 'pending',
  );

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Activity"
          description={
            hasLive
              ? 'Screens and phone calls. Live calls refresh every few seconds.'
              : 'Screens and phone calls tied to your hiring jobs.'
          }
        />

        {filterCandidateId ? (
          <p className="m-0 flex flex-wrap items-center gap-3 text-sm text-[var(--foreground-secondary)]">
            Showing history
            {filterCandidateName ? ` for ${filterCandidateName}` : ''}
            <Link
              href="/calls"
              className="font-semibold text-[var(--accent)] no-underline hover:underline"
            >
              Clear filter
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label="Call status"
            >
              {(
                [
                  ['all', 'All'],
                  ['live', 'Live'],
                  ['ended', 'Ended'],
                  ['failed', 'Failed'],
                ] as const
              ).map(([key, label]) => {
                const active = statusFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActivityFilters({ status: key })}
                    className={
                      active
                        ? 'rounded-md border-0 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent)]'
                        : 'rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]'
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label="Call channel"
            >
              {(
                [
                  ['all', 'Any channel'],
                  ['phone', 'Phone'],
                  ['browser', 'Browser'],
                ] as const
              ).map(([key, label]) => {
                const active = channelFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActivityFilters({ channel: key })}
                    className={
                      active
                        ? 'rounded-md border-0 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent)]'
                        : 'rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]'
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {notice ? <Notice kind="ok">{notice}</Notice> : null}

        {telephonyMessage ? (
          <Surface
            className={
              openOutbound
                ? undefined
                : 'border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,var(--surface))]'
            }
          >
            <h2 className="m-0 font-display text-base font-semibold tracking-tight">
              Live phone
            </h2>
            <p
              className={`mt-1 mb-0 text-sm ${openOutbound ? 'text-[var(--foreground-tertiary)]' : 'text-[var(--warning)]'}`}
            >
              {telephonyMessage}
            </p>
          </Surface>
        ) : null}

        {liveSessions.length > 0 &&
        !filterCandidateId &&
        statusFilter !== 'ended' &&
        statusFilter !== 'failed' ? (
          <section className="space-y-3">
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              Live now
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {liveSessions.map((s) => (
                <CallMonitor
                  key={s.id}
                  status={mapSessionStatus(s.status)}
                  candidateName={
                    s.candidateName ||
                    s.agentName ||
                    (s.channel === 'phone' ? 'Phone screen' : 'Browser screen')
                  }
                  jobTitle={s.jobTitle ?? undefined}
                  elapsedLabel={
                    s.durationSeconds != null
                      ? `${s.durationSeconds}s`
                      : undefined
                  }
                  busy={busyId === s.id}
                  onEnd={
                    s.agentId
                      ? () => {
                          void onEnd(s);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {filterCandidateId ? (
          <CandidateGroupChat
            sessions={visibleSessions}
            candidateName={filterCandidateName}
            canPlayRecording={canPlayRecording}
            canReconcile={canReconcile}
            busyId={busyId}
            onEnd={(s) => void onEnd(s)}
            onRefresh={(s) => void onRefreshResults(s)}
          />
        ) : (
          <section className="space-y-3">
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              Recent sessions
            </h2>
            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
              One row per call. Open a candidate to see that person’s full
              chat history with Call 1, Call 2, and so on.
            </p>
            {visibleSessions.length === 0 ? (
              <EmptyState
                icon={<Phone className="h-5 w-5" aria-hidden />}
                title={
                  sessions.length === 0
                    ? 'No calls yet'
                    : 'No calls match these filters'
                }
                description={
                  sessions.length === 0
                    ? 'Open a job for a browser screen, or use Call phone when the line is connected.'
                    : 'Try All, or clear Phone / Browser to see more.'
                }
              />
            ) : (
              <DataList>
                <DataListHeader className="grid-cols-[minmax(0,1fr)_auto]">
                  <span>Call</span>
                  <span>Actions</span>
                </DataListHeader>
                <DataListBody>
                  {visibleSessions.map((s) => {
                    const title =
                      s.channel === 'phone' && s.candidateName
                        ? s.candidateName
                        : s.candidateName
                          ? s.candidateName
                          : s.agentName
                            ? `Hiring voice · ${s.agentName}`
                            : 'Call';
                    const channelLabel =
                      s.channel === 'phone'
                        ? 'Phone'
                        : s.channel === 'browser_demo'
                          ? 'Browser'
                          : 'Session';
                    return (
                      <DataListRow
                        key={s.id}
                        className="grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm font-semibold tracking-tight">
                              {title}
                            </strong>
                            <Badge tone={statusTone(s.status)}>
                              {STATUS_LABEL[s.status] ?? s.status}
                            </Badge>
                          </div>
                          <p className="mt-1 mb-0 text-[13px] text-[var(--foreground-tertiary)]">
                            {channelLabel}
                            {s.jobTitle ? ` · ${s.jobTitle}` : ''}
                            {s.durationSeconds != null
                              ? ` · ${s.durationSeconds}s`
                              : ''}
                            {` · ${new Date(s.startedAt).toLocaleString()}`}
                          </p>
                          {s.status === 'failed' ? (
                            <p className="mt-1 mb-0 text-[13px] text-[var(--danger)]">
                              Call did not connect
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 text-sm">
                          {s.candidateId ? (
                            <Link
                              href={`/calls?candidateId=${encodeURIComponent(s.candidateId)}`}
                              className="font-semibold text-[var(--accent)] no-underline hover:underline"
                            >
                              Open chat
                            </Link>
                          ) : null}
                          {s.jobId ? (
                            <Link
                              href={`/jobs/${s.jobId}`}
                              className="font-medium text-[var(--foreground-secondary)] no-underline hover:underline"
                            >
                              Job
                            </Link>
                          ) : s.agentId ? (
                            <Link
                              href="/settings"
                              className="font-medium text-[var(--foreground-secondary)] no-underline hover:underline"
                            >
                              Hiring voice
                            </Link>
                          ) : null}
                          {(s.status === 'active' || s.status === 'pending') &&
                          s.agentId ? (
                            <button
                              type="button"
                              disabled={busyId === s.id}
                              onClick={() => void onEnd(s)}
                              className="border-0 bg-transparent p-0 font-semibold text-[var(--danger)]"
                            >
                              {busyId === s.id ? 'Ending…' : 'End'}
                            </button>
                          ) : null}
                          {canReconcile &&
                          s.agentId &&
                          (s.status === 'ended' || s.status === 'failed') &&
                          !s.summary ? (
                            <button
                              type="button"
                              disabled={busyId === s.id}
                              onClick={() => void onRefreshResults(s)}
                              className="border-0 bg-transparent p-0 font-semibold text-[var(--accent)]"
                            >
                              {busyId === s.id ? 'Refreshing…' : 'Refresh'}
                            </button>
                          ) : null}
                        </div>
                      </DataListRow>
                    );
                  })}
                </DataListBody>
              </DataList>
            )}
          </section>
        )}
      </PageMain>
    </AppShell>
  );
}

function SessionTranscriptBubbles({
  transcript,
  compact,
}: {
  transcript: NonNullable<VoiceSession['transcript']>;
  compact?: boolean;
}) {
  const turns = transcript.filter((t) => (t.message ?? '').trim().length > 0);
  if (turns.length === 0) {
    return (
      <p className="m-0 text-center text-[13px] text-[var(--foreground-muted)]">
        No spoken turns recorded for this call.
      </p>
    );
  }
  return (
    <div
      className={cn(
        'mt-2.5 flex flex-col gap-2',
        compact &&
          'max-h-60 overflow-y-auto rounded-md border border-[var(--separator-subtle)] bg-[var(--surface)] p-2.5',
      )}
    >
      {turns.map((turn, i) => {
        const isAgent = turn.role === 'agent';
        const isCandidate = turn.role === 'user';
        return (
          <div
            key={i}
            className={cn(
              'max-w-[85%]',
              isCandidate ? 'self-end' : 'self-start',
            )}
          >
            <div
              className={cn(
                'mb-0.5 text-[11px] text-[var(--foreground-muted)]',
                isCandidate ? 'text-right' : 'text-left',
              )}
            >
              {isAgent ? 'Hiring voice' : isCandidate ? 'Candidate' : turn.role}
            </div>
            <div
              className={cn(
                'rounded-xl px-3 py-2 text-[13px] leading-snug text-[var(--foreground)]',
                isCandidate
                  ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
                  : 'bg-[var(--surface-secondary)]',
              )}
            >
              {turn.message}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Merged Agent/Candidate chat with clear per-call segregation. */
function CandidateGroupChat({
  sessions,
  candidateName,
  canPlayRecording,
  canReconcile,
  busyId,
  onEnd,
  onRefresh,
}: {
  sessions: VoiceSession[];
  candidateName: string | null;
  canPlayRecording: boolean;
  canReconcile: boolean;
  busyId: string | null;
  onEnd: (s: VoiceSession) => void;
  onRefresh: (s: VoiceSession) => void;
}) {
  const chronological = [...sessions].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  const total = chronological.length;

  return (
    <Surface className="space-y-3">
      <div>
        <h2 className="m-0 font-display text-[1.05rem] font-semibold tracking-tight">
          {candidateName
            ? `Chat · ${candidateName}`
            : 'Candidate conversation'}
        </h2>
        <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
          {total <= 1
            ? 'Hiring voice and candidate turns for this screen, with recordings where available.'
            : `${total} calls merged in order — Call 1 is the earliest. Each call is marked so you can tell them apart.`}
        </p>
      </div>

      {chronological.length === 0 ? (
        <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
          No screens for this candidate yet. Place a Call phone from a job to
          start the conversation history.
        </p>
      ) : null}

      <div className="flex max-h-[min(70vh,720px)] flex-col gap-5 overflow-y-auto rounded-md border border-[var(--separator-subtle)] bg-[var(--background)] p-3">
        {chronological.map((s, index) => {
          const callNumber = index + 1;
          const channelLabel =
            s.channel === 'phone'
              ? 'Phone'
              : s.channel === 'browser_demo'
                ? 'Browser'
                : 'Screen';
          const when = new Date(s.startedAt).toLocaleString();
          return (
            <div
              key={s.id}
              id={`call-${s.id}`}
              className="flex flex-col gap-2.5 rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--separator-subtle)] pb-2">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold tracking-tight text-[var(--foreground)]">
                    Call {callNumber}
                    {total > 1 && callNumber === 1 ? ' · first' : ''}
                    {total > 1 && callNumber === total ? ' · latest' : ''}
                  </p>
                  <p className="mt-0.5 mb-0 text-[12px] text-[var(--foreground-tertiary)]">
                    {channelLabel}
                    {s.jobTitle ? ` · ${s.jobTitle}` : ''}
                    {` · ${when}`}
                    {s.durationSeconds != null ? ` · ${s.durationSeconds}s` : ''}
                  </p>
                </div>
                <Badge tone={statusTone(s.status)}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </Badge>
              </div>

              {s.status === 'failed' ? (
                <p className="m-0 text-[13px] text-[var(--danger)]">
                  This call did not connect. Often the company phone line was
                  disconnected in the voice console — ask an admin to reconnect
                  it, confirm the mobile number, then try Call phone again.
                </p>
              ) : null}

              {canPlayRecording &&
              s.agentId &&
              s.externalConversationId &&
              s.status === 'ended' ? (
                <audio
                  controls
                  preload="none"
                  className="block w-full max-w-md"
                  src={voiceSessionRecordingUrl(s.agentId, s.id)}
                >
                  Your browser cannot play this recording.
                </audio>
              ) : null}

              <div className="flex flex-wrap gap-3 text-sm">
                {s.jobId ? (
                  <Link
                    href={`/jobs/${s.jobId}`}
                    className="font-medium text-[var(--accent)] no-underline hover:underline"
                  >
                    Open job
                  </Link>
                ) : null}
                {(s.status === 'active' || s.status === 'pending') &&
                s.agentId ? (
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => onEnd(s)}
                    className="border-0 bg-transparent p-0 font-semibold text-[var(--danger)]"
                  >
                    {busyId === s.id ? 'Ending…' : 'End call'}
                  </button>
                ) : null}
                {canReconcile &&
                s.agentId &&
                (s.status === 'ended' || s.status === 'failed') &&
                !(s.transcript && s.transcript.some((t) => (t.message ?? '').trim())) ? (
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => onRefresh(s)}
                    className="border-0 bg-transparent p-0 font-semibold text-[var(--accent)]"
                  >
                    {busyId === s.id ? 'Refreshing…' : 'Load conversation'}
                  </button>
                ) : null}
              </div>

              {s.transcript && s.transcript.length > 0 ? (
                <SessionTranscriptBubbles transcript={s.transcript} />
              ) : s.status === 'ended' ? (
                <p className="m-0 text-[13px] text-[var(--foreground-muted)]">
                  No turn-by-turn transcript yet for this call.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Surface>
  );
}
