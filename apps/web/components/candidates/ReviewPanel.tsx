'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Notice } from '@/components/ui/page';
import {
  ApiClientError,
  askJobCandidateReviewStream,
  getJobCandidateResults,
  type CandidateScreeningResults,
} from '@/lib/api';
import { ScreeningSessionCard } from './ScreeningSessionCard';

export function ReviewPanel({
  jobId,
  candidateId,
  agentId,
  screeningQuestions,
  canPlayRecording,
  canReadTranscript,
  canCallAgain,
  calling,
  onCallAgain,
  forceOpenAsk,
  onAskOpened,
}: {
  jobId: string;
  candidateId: string;
  agentId: string | null;
  screeningQuestions: readonly { id: string; label: string }[];
  canPlayRecording: boolean;
  canReadTranscript: boolean;
  canCallAgain: boolean;
  calling: boolean;
  onCallAgain?: () => void;
  /** When set, expand results and focus the ask box (Chat entry point). */
  forceOpenAsk?: boolean;
  onAskOpened?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<CandidateScreeningResults[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [askDraft, setAskDraft] = useState('');
  const [askReply, setAskReply] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askSessionId, setAskSessionId] = useState<string | null>(null);
  const askInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const res = await getJobCandidateResults(jobId, candidateId);
      const list =
        res.sessions?.length > 0
          ? res.sessions
          : res.results?.voiceSessionId
            ? [res.results]
            : [];
      setSessions(list);
      setAskSessionId((prev) => {
        if (prev && list.some((s) => s.voiceSessionId === prev)) return prev;
        return list.find((s) => s.voiceSessionId)?.voiceSessionId ?? null;
      });
      setExpanded(true);
    } catch (e) {
      if (!opts?.quiet) {
        setError(
          e instanceof ApiClientError
            ? e.message
            : 'Could not load answers.',
        );
      }
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, [jobId, candidateId]);

  useEffect(() => {
    void load({ quiet: false });
  }, [load]);

  useEffect(() => {
    if (!forceOpenAsk) return;
    void load().then(() => {
      onAskOpened?.();
      window.setTimeout(() => askInputRef.current?.focus(), 50);
    });
  }, [forceOpenAsk, load, onAskOpened]);

  const live = sessions.some(
    (s) => s.status === 'pending' || s.status === 'active',
  );

  useEffect(() => {
    if (!expanded || !live) return;
    const id = window.setInterval(() => {
      void load({ quiet: true });
    }, 5000);
    return () => window.clearInterval(id);
  }, [expanded, live, load]);

  const hasAnySession = sessions.some((s) => s.voiceSessionId);
  const hasContent = sessions.some(
    (s) =>
      s.summary ||
      s.transcript?.length ||
      s.structuredAnswers ||
      s.costCredits != null ||
      s.fitPercent != null,
  );
  const statusOnly =
    hasAnySession &&
    !hasContent &&
    sessions.some((s) => s.status);

  const submitAsk = async (preset?: string) => {
    const message = (preset ?? askDraft).trim();
    if (!message || asking) return;
    setAsking(true);
    setAskError(null);
    setAskReply('');
    if (preset) setAskDraft(preset);
    try {
      const res = await askJobCandidateReviewStream(
        jobId,
        candidateId,
        {
          message,
          voiceSessionId: askSessionId ?? sessions[0]?.voiceSessionId ?? undefined,
        },
        (event) => {
          if (event.type === 'delta') {
            setAskReply((prev) => (prev ?? '') + event.text);
          } else if (event.type === 'done') {
            setAskReply(event.reply);
          }
        },
      );
      setAskReply(res.reply);
      setAskDraft('');
    } catch (e) {
      setAskError(
        e instanceof ApiClientError
          ? e.message
          : 'Could not answer that question.',
      );
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mt-2.5 text-sm">
      {!expanded && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Show answers'}
        </Button>
      )}
      {error && (
        <Notice kind="err">
          {error}
        </Notice>
      )}
      {expanded && (
        <div className="mt-2 rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[var(--foreground-tertiary)]">
              {live
                ? 'Updating while a screen is in progress…'
                : sessions.length > 1
                  ? `${sessions.length} calls (newest first)`
                  : 'Answers from the call'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
          {!hasAnySession && (
            <p className="m-0 text-[var(--foreground-tertiary)]">
              No answers yet for this person.
            </p>
          )}
          {statusOnly && (
            <p className="m-0 text-[var(--foreground-tertiary)]">
              {canReadTranscript
                ? live
                  ? 'Call in progress. Transcript and answers show here when ready. Refresh after the call ends.'
                  : 'Answers are still landing. Click Refresh in a moment.'
                : 'Call status is available. Full transcript and answers need a role that can read screening content.'}
            </p>
          )}
          {sessions.map((session, index) =>
            session.voiceSessionId ? (
              <ScreeningSessionCard
                key={session.voiceSessionId}
                session={session}
                agentId={agentId}
                screeningQuestions={screeningQuestions}
                canPlayRecording={canPlayRecording}
                canCallAgain={canCallAgain && index === 0 && !live}
                calling={calling}
                onCallAgain={onCallAgain}
              />
            ) : null,
          )}
          {hasAnySession && hasContent && canReadTranscript && (
            <div className="mt-3.5 border-t border-[var(--separator-subtle)] pt-3">
              <strong className="mb-1.5 block">Ask about this call</strong>
              <p className="mb-2 mt-0 text-xs text-[var(--foreground-tertiary)]">
                Answers use the full call transcript and collected facts. Pick a
                screen when there are several calls.
              </p>
              {sessions.filter((s) => s.voiceSessionId).length > 1 && (
                <Field
                  label="Which call"
                  className="mb-2 text-xs font-normal text-[var(--foreground-tertiary)]"
                >
                  <Select
                    value={askSessionId ?? ''}
                    onChange={(e) => setAskSessionId(e.target.value || null)}
                    disabled={asking}
                    className="mt-1 max-w-md"
                  >
                    {sessions
                      .filter((s) => s.voiceSessionId)
                      .map((s, i) => (
                        <option key={s.voiceSessionId!} value={s.voiceSessionId!}>
                          {i === 0 ? 'Newest call' : `Earlier call #${i + 1}`}
                          {s.startedAt
                            ? ` · ${new Date(s.startedAt).toLocaleString()}`
                            : ''}
                          {s.fitPercent != null && s.fitPercent > 0
                            ? ' · some questions answered'
                            : ''}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {(
                  [
                    ['Summarize this call', 'Summarize this call'],
                    [
                      'Callback questions',
                      'Draft questions for a callback about gaps from this screen',
                    ],
                    [
                      'What was unclear?',
                      'What answers were missing or unclear on this call?',
                    ],
                  ] as const
                ).map(([label, prompt]) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={asking}
                    onClick={() => void submitAsk(prompt)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  ref={askInputRef}
                  type="text"
                  value={askDraft}
                  onChange={(e) => setAskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submitAsk();
                    }
                  }}
                  placeholder="e.g. What did they say about notice period?"
                  disabled={asking}
                  className="min-w-[220px] flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void submitAsk()}
                  disabled={asking || !askDraft.trim()}
                >
                  {asking ? 'Asking…' : 'Ask'}
                </Button>
              </div>
              {askError && (
                <Notice kind="err">
                  {askError}
                </Notice>
              )}
              {(asking || askReply !== null) && (
                <div
                  className="mt-2.5 whitespace-pre-wrap rounded-md border border-[var(--separator-subtle)] bg-[var(--surface)] px-3 py-2.5 leading-snug"
                  aria-live="polite"
                >
                  {askReply || (asking ? 'Writing…' : '')}
                  {asking ? (
                    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-[var(--accent)] align-middle" />
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
