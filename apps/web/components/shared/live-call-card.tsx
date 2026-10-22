'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { ConfirmDialog } from '../ui/confirm';
import { StatusTag } from '../ui/state-tag';
import { Agent } from '../brand/agent';
import { agentStateFor } from './agent-state';
import { formatDuration, formatPhoneMasked } from '../../lib/format';
import { callStateKey } from '../../lib/status-labels';

// Call states while the call is still happening: the timer runs, End call shows.
const IN_PROGRESS = new Set(['pending', 'dialing', 'ringing', 'calling', 'active', 'transferring']);
// Reasons another call can't fix: the number, or the workspace's phone line, has to change first.
const NO_RETRY = new Set(['invalid_number', 'line_not_connected']);

export interface LiveCallCardProps {
  /** Who is being called. */
  name: string;
  /** What the call is for, such as the job title. */
  workLabel?: string;
  /** The raw call state from real events: a callStatus or voice session status ('dialing', 'active', 'completed', 'failed'...). */
  state: string | null | undefined;
  /** When the call started (ISO). The timer counts from here while the call is in progress. */
  startedAt?: string | null;
  /** Why it didn't connect, as the API's failureReason ('no_answer', 'voicemail', 'invalid_number'...). Its words replace the generic ones. */
  failureReason?: string | null;
  /** The candidate's stage. With it, a finished call reads "Writing up the call" or "Ready for review" while the stage is open. */
  stage?: string | null;
  /** Whether the call's results are in. Leave out when unknown. */
  hasResults?: boolean | null;
  /** The number called, masked in the Call again confirmation. */
  phone?: string | null;
  /** Shows End call while the call is in progress. It confirms first. */
  onEnd?: () => void;
  /** Shows Call again once the call failed, unless the reason means calling again can't work. It confirms first: this places a real call. */
  onRetry?: () => void;
  /** The End request is in flight. The confirmation stays open until it settles. */
  ending?: boolean;
  /** The Call again request is in flight. */
  retrying?: boolean;
  className?: string;
}

/**
 * One call as a card: the agent acting out the call's state, who and what for, the state in
 * words from real events, an elapsed timer, End call and Call again. State changes are read out
 * politely, with the person's name. Report
 * failed requests with a toast: the confirmation closes once its request settles.
 * <LiveCallCard name={row.fullName} workLabel={job.title} state={row.callStatus} failureReason={row.failureReason} stage={row.stage} />
 */
export function LiveCallCard({
  name,
  workLabel,
  state,
  startedAt,
  failureReason,
  stage,
  hasResults,
  phone,
  onEnd,
  onRetry,
  ending = false,
  retrying = false,
  className,
}: LiveCallCardProps) {
  const shown = callStateKey({ callStatus: state, stage, hasResults, failureReason });
  const failed = state === 'failed';
  const inProgress = Boolean(state && IN_PROGRESS.has(state));

  // Ticks each second while the call is in progress, then keeps its last value.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!inProgress) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [inProgress]);
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed =
    now != null && !failed && Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : null;

  const canEnd = inProgress && Boolean(onEnd);
  const canRetry = failed && Boolean(onRetry) && !(shown && NO_RETRY.has(shown));
  const [confirm, setConfirm] = useState<'end' | 'retry' | null>(null);
  const busy = confirm === 'end' ? ending : confirm === 'retry' ? retrying : false;
  // Close once the confirmed request settles, or when its action no longer applies.
  const [wasBusy, setWasBusy] = useState(busy);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (!busy) setConfirm(null);
  }
  if ((confirm === 'end' && !canEnd) || (confirm === 'retry' && !canRetry)) setConfirm(null);

  // The dialog hands focus back to the button that opened it. After a confirmed End call or
  // Call again that button is about to go with the old state, and a dialog that closed on its
  // own may have lost it already: focus this card's state instead of letting focus fall to the page.
  const status = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const confirmed = useRef(false);
  const ask = (which: 'end' | 'retry') => (event: MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    confirmed.current = false;
    setConfirm(which);
  };
  const returnFocus = (event: Event) => {
    if (confirmed.current || !opener.current?.isConnected) {
      event.preventDefault();
      status.current?.focus();
    }
    confirmed.current = false;
  };

  const masked = formatPhoneMasked(phone);
  const close = (open: boolean) => {
    if (!open) setConfirm(null);
  };

  return (
    <>
      <div
        className={cn(
          'flex min-w-0 flex-col gap-4 rounded-card border border-border bg-canvas p-4 text-text shadow-xs',
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* The agent acts the call out (ringing, listening, done, missed); the tag says it in words. */}
          <Agent size={40} state={agentStateFor(shown)} colour="glass" onLight />
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-label font-semibold">{name}</p>
            {workLabel ? <p className="m-0 truncate text-meta text-text-3">{workLabel}</p> : null}
          </div>
          {elapsed != null ? (
            <p className="m-0 shrink-0 text-label font-medium tabular-nums text-text-2">
              <span className="sr-only">Call length </span>
              {formatDuration(elapsed)}
            </p>
          ) : null}
        </div>
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
          {/* Atomic, so each change reads whole: "Priya Sharma: Rang out". */}
          <span ref={status} tabIndex={-1} role="status" className="inline-flex max-w-full rounded-xs">
            <span className="sr-only">{name}: </span>
            <StatusTag domain="call" value={shown} stamped={shown ?? undefined} />
          </span>
          {canEnd || canRetry ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {canEnd ? (
                <Button type="button" variant="destructive-secondary" size="sm" onClick={ask('end')}>
                  End call
                </Button>
              ) : null}
              {canRetry ? (
                <Button type="button" variant="secondary" size="sm" onClick={ask('retry')}>
                  Call again
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirm === 'end'}
        onOpenChange={close}
        title={`End the call with ${name}?`}
        body="HRVoice hangs up right away."
        confirmLabel="End call"
        cancelLabel="Keep the call"
        tone="danger"
        busy={confirm === 'end' && ending}
        onCloseAutoFocus={returnFocus}
        onConfirm={() => {
          confirmed.current = true;
          onEnd?.();
        }}
      />
      <ConfirmDialog
        open={confirm === 'retry'}
        onOpenChange={close}
        title={`Call ${name} again?`}
        body={`This places a real phone call${masked ? ` to ${masked}` : ''}.`}
        confirmLabel="Call again"
        tone="real-world"
        busy={confirm === 'retry' && retrying}
        onCloseAutoFocus={returnFocus}
        onConfirm={() => {
          confirmed.current = true;
          onRetry?.();
        }}
      />
    </>
  );
}
