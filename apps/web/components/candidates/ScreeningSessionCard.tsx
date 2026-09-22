'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  voiceSessionRecordingUrl,
  type CandidateScreeningResults,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatCallDuration, scorecardRows } from './screening-answers';

export function ScreeningSessionCard({
  session,
  agentId,
  screeningQuestions,
  canPlayRecording,
  canCallAgain,
  calling,
  onCallAgain,
}: {
  session: CandidateScreeningResults;
  agentId: string | null;
  screeningQuestions: readonly { id: string; label: string }[];
  canPlayRecording: boolean;
  canCallAgain: boolean;
  calling: boolean;
  onCallAgain?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const when = session.startedAt
    ? new Date(session.startedAt).toLocaleString()
    : null;
  const turns = session.transcript ?? [];
  const duration = session.durationSeconds ?? null;
  const canSeek =
    Boolean(duration && duration > 0 && turns.length > 0) &&
    canPlayRecording &&
    Boolean(session.recordingAvailable && session.voiceSessionId && agentId);
  const hasTurnTimes = turns.some(
    (t) => typeof t.timeInCallSecs === 'number' && t.timeInCallSecs >= 0,
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !duration || duration <= 0 || turns.length === 0) return;
    const onTime = () => {
      let idx = 0;
      if (hasTurnTimes) {
        for (let i = 0; i < turns.length; i += 1) {
          const t = turns[i]?.timeInCallSecs;
          if (typeof t === 'number' && t <= audio.currentTime + 0.15) idx = i;
          else if (typeof t === 'number' && t > audio.currentTime + 0.15) break;
        }
      } else {
        idx = Math.min(
          turns.length - 1,
          Math.max(0, Math.floor((audio.currentTime / duration) * turns.length)),
        );
      }
      setActiveTurn(idx);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onTime);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onTime);
    };
  }, [duration, turns, hasTurnTimes, session.voiceSessionId]);

  useEffect(() => {
    if (activeTurn == null) return;
    turnRefs.current[activeTurn]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [activeTurn]);

  function seekToTurn(index: number) {
    if (!canSeek || !audioRef.current || !duration || turns.length === 0) return;
    const stamped = turns[index]?.timeInCallSecs;
    const t =
      typeof stamped === 'number' && stamped >= 0
        ? stamped
        : (index / turns.length) * duration;
    audioRef.current.currentTime = Math.min(
      Math.max(0, duration - 0.25),
      Math.max(0, t),
    );
    setActiveTurn(index);
    void audioRef.current.play().catch(() => undefined);
  }

  function turnClock(index: number): string | null {
    const stamped = turns[index]?.timeInCallSecs;
    const secs =
      typeof stamped === 'number' && stamped >= 0
        ? Math.floor(stamped)
        : duration && turns.length > 0
          ? Math.floor((index / turns.length) * duration)
          : null;
    if (secs == null) return null;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div className="mt-2.5 border-t border-[var(--separator-subtle)] pt-2.5">
      <div className="mb-3">
        <p className="m-0 text-sm font-medium text-[var(--foreground)]">
          {when ?? 'Screen'}
        </p>
        <p className="mt-0.5 mb-0 text-xs text-[var(--foreground-tertiary)]">
          {session.status === 'active' || session.status === 'pending'
            ? 'In progress'
            : session.status === 'ended' || session.status === 'completed'
              ? 'Completed'
              : session.status === 'failed'
                ? 'Failed'
                : session.status || 'Call'}
          {duration != null ? ` · ${formatCallDuration(duration)}` : ''}
        </p>
      </div>
      {session.summary ? (
        <div className="mb-3">
          <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Summary
          </p>
          <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--foreground)]">
            {session.summary}
          </p>
        </div>
      ) : null}
      {(() => {
        const rows = scorecardRows(
          session.structuredAnswers,
          screeningQuestions,
        );
        if (rows.length === 0) return null;
        const answered = rows.filter((r) => r.answered).length;
        const total = rows.length;
        const pct =
          total > 0 ? Math.round((answered / total) * 100) : 0;
        return (
          <div className="mb-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                Questions covered
              </p>
              <p className="m-0 text-xs text-[var(--foreground-tertiary)]">
                {answered} of {total} answered on the call
              </p>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-secondary)]"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="Share of screening questions answered"
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-fast"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2.5 overflow-hidden rounded-md border border-[var(--separator-subtle)]">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--separator-subtle)] bg-[var(--surface)]">
                    <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                      Question
                    </th>
                    <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                      Answer
                    </th>
                    <th className="w-[5.5rem] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--separator-subtle)]">
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <td className="align-top px-3 py-2.5 text-[13px] font-medium text-[var(--foreground)]">
                        {row.label}
                      </td>
                      <td
                        className={cn(
                          'align-top px-3 py-2.5 text-[13px] leading-relaxed',
                          row.answered
                            ? 'text-[var(--foreground-secondary)]'
                            : 'text-[var(--foreground-tertiary)]',
                        )}
                      >
                        {row.value}
                      </td>
                      <td className="align-top px-3 py-2.5">
                        <Badge
                          tone={row.answered ? 'success' : 'neutral'}
                          className="normal-case"
                        >
                          {row.answered ? 'Answered' : 'Missed'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      {canPlayRecording &&
        session.recordingAvailable &&
        session.voiceSessionId &&
        agentId && (
          <div className="mb-3">
            <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
              Recording
            </p>
            <div className="mt-1.5 rounded-md border border-[var(--separator-subtle)] bg-[var(--surface)] px-2.5 py-2">
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                className="block h-9 w-full accent-[var(--accent)]"
                src={voiceSessionRecordingUrl(agentId, session.voiceSessionId)}
              >
                Your browser cannot play this recording.
              </audio>
            </div>
            {canSeek ? (
              <p className="mt-1 mb-0 text-xs text-[var(--foreground-tertiary)]">
                Click a turn below to jump in the recording.
              </p>
            ) : null}
          </div>
        )}
      {turns.length > 0 && (
        <div className="mb-2.5">
          <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Conversation
          </p>
          <div className="mt-2 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)] p-2.5">
            {turns.map((turn, i) => {
              const isAgent = turn.role === 'agent';
              const isCandidate = turn.role === 'user';
              const label = isAgent
                ? 'Hiring voice'
                : isCandidate
                  ? 'Candidate'
                  : turn.role;
              const clock = turnClock(i);
              const active = activeTurn === i;
              return (
                <button
                  key={i}
                  ref={(el) => {
                    turnRefs.current[i] = el;
                  }}
                  type="button"
                  disabled={!canSeek}
                  onClick={() => seekToTurn(i)}
                  className={cn(
                    'max-w-[85%] border-0 bg-transparent p-0 text-left',
                    isCandidate ? 'self-end' : 'self-start',
                    canSeek && 'cursor-pointer',
                  )}
                >
                  <div
                    className={cn(
                      'mb-0.5 text-xs text-[var(--foreground-muted)]',
                      isCandidate ? 'text-right' : 'text-left',
                    )}
                  >
                    {label}
                    {clock ? ` · ${clock}` : ''}
                    {active ? ' · playing' : ''}
                  </div>
                  <div
                    className={cn(
                      'px-3 py-2 text-sm leading-snug text-[var(--foreground)] transition-colors',
                      isCandidate
                        ? 'rounded-xl rounded-br-sm bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface))]'
                        : 'rounded-xl rounded-bl-sm bg-[var(--surface-secondary)]',
                      canSeek && 'hover:ring-1 hover:ring-[var(--accent)]',
                      active &&
                        'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--surface)]',
                    )}
                  >
                    {turn.message}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {canCallAgain && onCallAgain && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2.5"
          disabled={calling}
          onClick={() => onCallAgain()}
        >
          {calling ? 'Calling…' : 'Request another call'}
        </Button>
      )}
    </div>
  );
}
