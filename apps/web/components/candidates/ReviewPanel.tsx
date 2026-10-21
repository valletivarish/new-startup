'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Hourglass, PhoneOutgoing, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { SkeletonCard, useHeldLoading } from '@/components/ui/skeleton';
import { StatusBadge, StatusTag } from '@/components/ui/state-tag';
import { askJobCandidateReviewStream, getJobCandidateResults, type CandidateScreeningResults } from '@/lib/api';
import { messageText, toUserMessage, type UserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { firstNameOf } from '@/components/home/copy';
import { ScreeningSessionCard, sessionHasResults } from './ScreeningSessionCard';
import { sessionListMeta } from './screening-answers';

/**
 * Every call with this candidate, newest first and open, so the summary is the first thing
 * read. Older calls fold away under their date. While a call is live the list refreshes.
 */
export function ReviewPanel({
  jobId,
  candidateId,
  candidateName,
  stage,
  agentId,
  screeningQuestions,
  canPlayRecording,
  canReadTranscript,
  canCallAgain,
  calling,
  onCallAgain,
  onGoToCall,
}: {
  jobId: string;
  candidateId: string;
  candidateName: string;
  stage: string;
  agentId: string | null;
  screeningQuestions: readonly { id: string; label: string }[];
  canPlayRecording: boolean;
  canReadTranscript: boolean;
  canCallAgain: boolean;
  calling: boolean;
  /** Asks to call again; the sheet confirms first. */
  onCallAgain?: () => void;
  /** Shown on the empty state: the way to the Call tab. */
  onGoToCall?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<CandidateScreeningResults[]>([]);
  const [error, setError] = useState<UserMessage | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [askReply, setAskReply] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askStage, setAskStage] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  // Once someone opens or folds a call, refreshes keep their choice.
  const touched = useRef(false);
  const showSkeleton = useHeldLoading(loading && sessions.length === 0);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setLoading(true);
      setError(null);
      try {
        const res = await getJobCandidateResults(jobId, candidateId);
        const list: CandidateScreeningResults[] =
          res.sessions?.length > 0 ? res.sessions : res.results?.voiceSessionId ? [res.results] : [];
        setSessions(list);
        // The newest call opens by default; a choice someone made survives refreshes.
        setOpenSessionId((prev) =>
          touched.current && (prev === null || list.some((s) => s.voiceSessionId === prev))
            ? prev
            : (list.find((s) => s.voiceSessionId)?.voiceSessionId ?? null),
        );
      } catch (e) {
        if (!opts?.quiet) setError(toUserMessage(e, 'load the calls'));
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [jobId, candidateId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const live = sessions.some((s) => s.status === 'pending' || s.status === 'active');

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void load({ quiet: true }), 5000);
    return () => window.clearInterval(id);
  }, [live, load]);

  const listed = sessions.filter((s) => s.voiceSessionId);
  const openSession = listed.find((s) => s.voiceSessionId === openSessionId) ?? null;
  const statusOnly = listed.length > 0 && !sessions.some(sessionHasResults);

  async function submitAsk(preset?: string) {
    const message = (preset ?? askDraft).trim();
    if (!message || asking) return;
    setAsking(true);
    setAskError(null);
    setAskReply('');
    setAskStage('Reading the call');
    const started = Date.now();
    // Long answers say so, so nobody wonders whether it stalled.
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      setAskStage((stageNow) =>
        stageNow === null
          ? null
          : elapsed >= 10_000
            ? 'Still working. You can keep reading the call meanwhile.'
            : elapsed >= 3_000
              ? 'Taking a little longer than usual'
              : 'Reading the call',
      );
    }, 1000);
    if (preset) setAskDraft(preset);
    try {
      const res = await askJobCandidateReviewStream(
        jobId,
        candidateId,
        { message, voiceSessionId: openSession?.voiceSessionId ?? listed[0]?.voiceSessionId ?? undefined },
        (event) => {
          if (event.type === 'delta') {
            setAskStage(null);
            setAskReply((prev) => (prev ?? '') + event.text);
          } else if (event.type === 'done') {
            setAskStage(null);
            setAskReply(event.reply);
          }
        },
      );
      setAskReply(res.reply);
      setAskDraft('');
    } catch (e) {
      const m = toUserMessage(e, 'answer that');
      setAskError(messageText(m));
      setAskReply(null);
    } finally {
      window.clearInterval(timer);
      setAsking(false);
      setAskStage(null);
    }
  }

  if (showSkeleton) return <SkeletonCard />;

  if (error) {
    return (
      <Alert
        kind="error"
        title={error.title}
        action={
          <Button type="button" variant="secondary" size="sm" loading={loading} onClick={() => void load()}>
            <RotateCw aria-hidden strokeWidth={1.5} />
            Retry
          </Button>
        }
      >
        {error.detail}
      </Alert>
    );
  }

  if (listed.length === 0) {
    const first = firstNameOf(candidateName) || candidateName;
    return (
      <EmptyState
        agent="idle"
        headingLevel={3}
        title="No calls yet"
        description={`When ${first} is called, the summary, answers, transcript and recording land here.`}
        action={
          onGoToCall ? (
            <Button type="button" variant="secondary" onClick={onGoToCall}>
              <PhoneOutgoing aria-hidden strokeWidth={1.5} />
              Go to Call
            </Button>
          ) : null
        }
        className="py-10"
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="m-0 text-meta text-text-3" aria-live="polite">
          {live
            ? 'Updating while the call is in progress'
            : listed.length === 1
              ? '1 call'
              : `${listed.length} calls, newest first`}
        </p>
        <Button type="button" variant="tertiary" size="sm" loading={loading} onClick={() => void load()}>
          <RotateCw aria-hidden strokeWidth={1.5} />
          Refresh
        </Button>
      </div>

      {statusOnly && !canReadTranscript ? (
        <Alert kind="info" title="You can see that a call happened">
          Its transcript and answers are kept for the people allowed to read call content. Ask a
          workspace admin if you need them.
        </Alert>
      ) : null}

      <ul role="list" className="m-0 grid list-none gap-3 p-0">
        {listed.map((session, index) => {
          const meta = sessionListMeta(session, screeningQuestions);
          // A call that never connected has no answers to count.
          const bits = [meta.durationLabel, session.structuredAnswers ? meta.answeredLabel : null].filter(Boolean);
          const isOpen = openSessionId === session.voiceSessionId;
          return (
            <li key={session.voiceSessionId}>
              <details
                className="group"
                open={isOpen}
                onToggle={(e) => {
                  const id = session.voiceSessionId;
                  // React's own open={...} also fires toggle; only a real change counts.
                  if (e.currentTarget.open === isOpen) return;
                  touched.current = true;
                  if (e.currentTarget.open) {
                    setOpenSessionId(id);
                    setAskReply(null);
                    setAskError(null);
                  } else {
                    setOpenSessionId((prev) => (prev === id ? null : prev));
                  }
                }}
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-card-sm border border-border bg-canvas px-4 py-2.5 transition-colors duration-fast marker:content-none hover:bg-subtle group-open:mb-4 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label font-medium text-text">
                      {formatWhen(session.startedAt) || 'Call'}
                    </span>
                    {bits.length ? (
                      <span className="mt-0.5 block truncate text-meta tabular-nums text-text-3">{bits.join(' · ')}</span>
                    ) : null}
                  </span>
                  <StatusTag
                    domain="call"
                    value={session.status}
                    stage={stage}
                    hasResults={sessionHasResults(session)}
                    failureReason={session.failureReason}
                  />
                  <ChevronDown
                    aria-hidden
                    strokeWidth={1.5}
                    className="size-4 shrink-0 text-text-3 transition-transform duration-fast group-open:rotate-180"
                  />
                </summary>
                {isOpen ? (
                  <div className="grid gap-5">
                    <ScreeningSessionCard
                      session={session}
                      agentId={agentId}
                      candidateName={candidateName}
                      stage={stage}
                      screeningQuestions={screeningQuestions}
                      canPlayRecording={canPlayRecording}
                      canCallAgain={canCallAgain && index === 0 && !live}
                      calling={calling}
                      onCallAgain={onCallAgain}
                    />
                    {sessionHasResults(session) && canReadTranscript ? (
                      <AskAboutCall
                        draft={askDraft}
                        setDraft={setAskDraft}
                        asking={asking}
                        stage={askStage}
                        error={askError}
                        reply={askReply}
                        onAsk={(preset) => void submitAsk(preset)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// No "Summarize this call": the summary already leads the call card above.
const PRESETS = [
  ['Draft follow-up questions', 'Draft questions for a follow-up call about anything this call left open'],
  ['What was unclear?', 'What answers were missing or unclear on this call?'],
] as const;

/** Questions about one call, answered from its transcript and answers only. */
function AskAboutCall({
  draft,
  setDraft,
  asking,
  stage,
  error,
  reply,
  onAsk,
}: {
  draft: string;
  setDraft: (value: string) => void;
  asking: boolean;
  stage: string | null;
  error: string | null;
  reply: string | null;
  onAsk: (preset?: string) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-card-sm bg-subtle p-4">
      <h3 id={headingId} className="m-0 text-label font-semibold text-text">
        Ask about this call
      </h3>
      <p className="mb-3 mt-1 text-meta text-text-2">Answers come only from this call’s transcript and answers.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map(([label, prompt]) => (
          <Button key={label} type="button" variant="secondary" size="sm" disabled={asking} onClick={() => onAsk(prompt)}>
            {label}
          </Button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          onAsk();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="For example: what did they say about notice period?"
          aria-label="Your question about this call"
          disabled={asking}
          className="min-w-0 sm:flex-1"
        />
        <Button type="submit" loading={asking} disabled={!asking && !draft.trim()}>
          Ask
        </Button>
      </form>
      {error ? (
        <Alert kind="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
      {asking || reply !== null ? (
        <div
          aria-live="polite"
          className="mt-3 whitespace-pre-wrap rounded-card-sm border border-border bg-canvas p-4 text-body leading-relaxed text-text"
        >
          {stage ? (
            <p className="m-0 mb-2">
              <StatusBadge tone="info" icon={Hourglass}>
                {stage}
              </StatusBadge>
            </p>
          ) : null}
          {reply}
          {asking && !reply ? (
            <span aria-hidden className="inline-block h-4 w-0.5 bg-accent align-middle motion-safe:animate-pulse" />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
