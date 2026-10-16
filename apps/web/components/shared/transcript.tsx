'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Play } from 'lucide-react';
import { cn } from '../ui/cn';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { formatDuration } from '../../lib/format';
import { HIRING_USE_CASE } from '../../lib/use-case-definitions';

export interface TranscriptTurn {
  speaker: 'agent' | 'contact';
  /** The contact's name, used as their speaker label. */
  name?: string;
  /** Seconds into the call. null when the call has no times: the turn shows no time. */
  at?: number | null;
  text: string;
}

/** Time into the call as m:ss ("2:14"). '' when unknown. */
export function formatTurnTime(at: number | null | undefined): string {
  return at == null ? '' : formatDuration(Math.floor(at));
}

/** "2 minutes 14 seconds", for screen readers. */
export function spokenTime(at: number): string {
  const total = Math.max(0, Math.floor(at));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return unit(seconds, 'second');
  return seconds === 0 ? unit(minutes, 'minute') : `${unit(minutes, 'minute')} ${unit(seconds, 'second')}`;
}

// Seeking can land a frame early, so a turn counts as started a quarter second before its time.
const EARLY = 0.25;

/** The turn being spoken at `time`: the last one that has started. -1 before the first, or with no time. */
export function currentTurnIndex(
  turns: readonly Pick<TranscriptTurn, 'at'>[],
  time: number | null | undefined,
): number {
  let index = -1;
  if (time == null || Number.isNaN(time)) return index;
  turns.forEach((turn, i) => {
    if (turn.at != null && turn.at <= time + EARLY) index = i;
  });
  return index;
}

/** API turns ({ role: 'agent' | 'user', message, timeInCallSecs }) as Transcript turns. */
export function toTranscriptTurns(
  turns: readonly { role: string; message: string; timeInCallSecs?: number | null }[] | null | undefined,
  contactName?: string,
): TranscriptTurn[] {
  return (turns ?? []).map(
    (turn): TranscriptTurn => ({
      speaker: turn.role === 'agent' ? 'agent' : 'contact',
      name: turn.role === 'agent' ? undefined : contactName,
      at: typeof turn.timeInCallSecs === 'number' && turn.timeInCallSecs >= 0 ? turn.timeInCallSecs : null,
      text: turn.message,
    }),
  );
}

function fullyInside(box: HTMLElement, el: HTMLElement) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= b.top && r.bottom <= b.bottom;
}

/** Scrolls the box, never the page, just enough to show the turn (its top when it is taller). */
function scrollIntoBox(box: HTMLElement, el: HTMLElement) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const top =
    r.top < b.top || r.height > b.height ? r.top - b.top : Math.max(0, r.bottom - b.bottom);
  if (top === 0) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.scrollBy({ top, behavior: reduce ? 'auto' : 'smooth' });
}

// Revealing up to three turns at once writes them in; more at once is a seek, shown instantly.
const WRITE_IN_MAX = 3;
// power3.out, the website's reveal curve.
const POWER3_OUT = [0.215, 0.61, 0.355, 1] as const;

export type TranscriptVariant = 'canvas' | 'glass';

// Bubbles: the agent on the left, the contact on the right. The turn being spoken gets an
// outline, which forced colours keep. On glass the text is white, so the photo behind the card
// must be dark enough for it (see .glass in globals.css).
const LOOK = {
  canvas: {
    box: 'rounded-card-sm border border-border bg-canvas p-3',
    agent: 'bg-subtle',
    contact: 'bg-accent-soft',
    current: '[outline:2px_solid_var(--accent)]',
    meta: 'text-text-3',
    play: 'text-text-2 hover:bg-canvas hover:text-text',
  },
  glass: {
    // Top padding keeps the first turn clear of the fade until the box scrolls.
    box: 'pt-6 [mask-image:linear-gradient(to_bottom,transparent,var(--text)_1.5rem)] [text-shadow:0_1px_2px_var(--scrim)]',
    // Neither bubble adds white: that would cut the contrast of the white text on it.
    agent: 'border border-[var(--glass-border)]',
    contact: 'bg-[var(--scrim)]',
    current: '[outline:1.5px_solid_var(--glass-foreground)]',
    meta: '',
    play: 'hover:bg-[var(--glass)]',
  },
} as const;

export interface TranscriptProps {
  turns: readonly TranscriptTurn[];
  /** Playback position in seconds. The turn being spoken is outlined and marked aria-current. */
  currentTime?: number | null;
  /** When a recording exists: each turn's time becomes a "Play from 0:28" button. */
  onPlayFrom?: (at: number) => void;
  /**
   * Website player: turns after currentTime are hidden (their space kept) and write in as
   * playback reaches them. Every turn shows under reduced motion, before hydration, and
   * while currentTime is undefined.
   */
  writeIn?: boolean;
  /** Name of the scroll region. */
  label?: string;
  /** Speaker label for a contact turn with no name: the use case's word (spec 9). */
  contactLabel?: string;
  /** Speaker label for the agent's turns. */
  agentLabel?: string;
  /** 'canvas' (default): bubbles on white. 'glass': white text on a frosted card over a photo. */
  variant?: TranscriptVariant;
  /** Inside a card: the canvas box drops its own border, fill and padding. */
  bare?: boolean;
  /** The scroll box: max-h-96 by default; max-h-none shows every turn. */
  className?: string;
}

/** The one transcript renderer: the call as bubbles, each with its speaker and time. */
export function Transcript({
  turns,
  currentTime,
  onPlayFrom,
  writeIn = false,
  label = 'Transcript',
  contactLabel = HIRING_USE_CASE.labels.contact.one,
  agentLabel = 'Agent',
  variant = 'canvas',
  bare = false,
  className,
}: TranscriptProps) {
  const box = useRef<HTMLDivElement>(null);
  const current = currentTurnIndex(turns, currentTime);
  const look = LOOK[variant];

  // Server markup is the whole transcript, so hiding waits for hydration.
  const reduce = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const hideUnspoken = writeIn && hydrated && reduce === false && currentTime != null;

  // The turns this update revealed, which write in; Infinity when nothing should animate.
  const [reveal, setReveal] = useState({ current, from: Infinity });
  if (reveal.current !== current) {
    const gained = current - reveal.current;
    setReveal({ current, from: gained > 0 && gained <= WRITE_IN_MAX ? reveal.current + 1 : Infinity });
  }

  // Keep the current turn in view inside the box. Focus never moves. Playing on follows only
  // a reader who was following; a jump (a ticket, a time button) always shows its turn.
  const last = useRef(current);
  useEffect(() => {
    const prev = last.current;
    last.current = current;
    const el = box.current;
    const items = el?.querySelectorAll<HTMLElement>('[data-turn]');
    const target = items?.[current];
    if (!el || !items || !target) return;
    const before = items[prev];
    if (current === prev + 1 && before && !fullyInside(el, before)) return;
    scrollIntoBox(el, target);
  }, [current]);

  if (turns.length === 0) return null;

  return (
    <div
      ref={box}
      role="region"
      aria-label={label}
      // Without buttons inside (no recording, or no turn has a time), the box needs its own
      // tab stop to scroll by keyboard. Safari doesn't give scroll boxes one on its own.
      tabIndex={onPlayFrom && turns.some((turn) => turn.at != null) ? undefined : 0}
      className={cn(
        'max-h-96 overflow-y-auto overscroll-contain',
        (variant === 'glass' || !bare) && look.box,
        className,
      )}
    >
      <ol role="list" className="m-0 flex list-none flex-col gap-3 p-0">
        {turns.map((turn, i) => {
          const at = turn.at;
          const time = formatTurnTime(at);
          const agent = turn.speaker === 'agent';
          const speaker = agent ? agentLabel : turn.name || contactLabel;
          const isCurrent = i === current;
          const hidden = hideUnspoken && i > current;
          const item = {
            'data-turn': '',
            'data-speaker': turn.speaker,
            'aria-current': isCurrent ? ('true' as const) : undefined,
            className: cn('flex', agent ? 'justify-start' : 'justify-end', hidden && 'invisible'),
          };
          const content = (
            <div
              className={cn(
                'min-w-0 max-w-[85%] rounded-card-sm px-3.5 py-2.5',
                agent ? look.agent : look.contact,
                isCurrent && look.current,
              )}
            >
              <p className="m-0 text-body [overflow-wrap:anywhere]">
                <span className="sr-only">{speaker}: </span>
                {turn.text}
              </p>
              <div
                className={cn(
                  'mt-1.5 flex min-h-6 items-center gap-2 text-caption',
                  look.meta,
                  !agent && 'justify-end',
                )}
              >
                {/* Read once, before the words, by the sr-only label above. */}
                <span aria-hidden className="font-medium">
                  {speaker}
                </span>
                {at != null && time ? (
                  onPlayFrom ? (
                    <button
                      type="button"
                      onClick={() => onPlayFrom(at)}
                      aria-label={`Play from ${time}`}
                      className={cn(
                        // 24px to sit in the line; ::after takes the hit area to 44px.
                        'relative -my-0.5 inline-flex h-6 items-center gap-1 rounded-pill px-2 font-medium tabular-nums transition-colors duration-fast after:absolute after:-inset-x-1 after:-inset-y-2.5',
                        look.play,
                      )}
                    >
                      <Play aria-hidden strokeWidth={1.5} className="size-3 fill-current" />
                      {time}
                    </button>
                  ) : (
                    <time dateTime={`PT${Math.floor(at)}S`}>{time}</time>
                  )
                ) : null}
              </div>
            </div>
          );
          if (!writeIn) {
            return (
              <li key={i} {...item}>
                {content}
              </li>
            );
          }
          const writing = i >= reveal.from && i <= current;
          return (
            <motion.li
              key={i}
              {...item}
              initial={false}
              animate={
                hidden
                  ? { opacity: 0, transform: 'translateY(8px)' }
                  : { opacity: 1, transform: 'translateY(0px)' }
              }
              // 220ms on power3.out, 60ms apart; hiding and seeks are instant.
              transition={
                writing
                  ? { duration: 0.22, ease: POWER3_OUT, delay: (i - reveal.from) * 0.06 }
                  : { duration: 0 }
              }
            >
              {content}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

export interface TranscriptCardProps extends Omit<TranscriptProps, 'className'> {
  /** The card's heading, such as "Hiring agent". */
  title: ReactNode;
  /** One quiet line under the title, such as the job or "Sample call". */
  subtitle?: ReactNode;
  /** Right of the title: a badge such as "Sample call". */
  badge?: ReactNode;
  /** Under the bubbles: a ListeningBar while the call is live, or a RecordingPlayer after. */
  footer?: ReactNode;
  /**
   * What the agent's face acts out, from the real call: agentStateFor(callState), or
   * 'speaking' / 'listening' from the live turn. 'done' for a finished call. Default 'idle'.
   */
  agentState?: AgentState;
  /** The card. Give it a height to make the bubbles scroll inside it. */
  className?: string;
  /** The scroll box inside the card. */
  transcriptClassName?: string;
}

/**
 * A transcript as a card: the agent (ink glass on canvas, pearl on glass), a title and badge, the
 * bubbles, and a footer. The canvas variant is a white card for the app; glass is the frosted
 * card over a photograph.
 * <TranscriptCard title="AI hiring agent" subtitle={job.title} agentState="done" turns={turns}
 *   footer={<RecordingPlayer ... />} className="h-[30rem]" />
 */
export function TranscriptCard({
  title,
  subtitle,
  badge,
  footer,
  agentState = 'idle',
  className,
  transcriptClassName,
  variant = 'canvas',
  ...transcript
}: TranscriptCardProps) {
  const glass = variant === 'glass';
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        glass ? 'glass rounded-canvas' : 'rounded-card border border-border bg-canvas text-text shadow-xs',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-4 pb-2 pt-4 sm:px-5',
          glass && '[text-shadow:0_1px_2px_var(--scrim)]',
        )}
      >
        <Agent size={40} state={agentState} colour="glass" onLight={!glass} />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-base font-semibold tracking-tight">{title}</p>
          {subtitle ? (
            <p className={cn('m-0 truncate text-caption', !glass && 'text-text-3')}>{subtitle}</p>
          ) : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-5">
        <Transcript
          {...transcript}
          variant={variant}
          bare
          className={cn('max-h-none min-h-0 flex-1', transcriptClassName)}
        />
      </div>
      {footer ? <div className="px-3 pb-3 pt-3 sm:px-4 sm:pb-4">{footer}</div> : <div className="h-4" />}
    </div>
  );
}
