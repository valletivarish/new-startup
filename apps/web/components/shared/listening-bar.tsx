'use client';

import { cn } from '../ui/cn';
import { formatTurnTime } from './transcript';

export type ListeningState = 'listening' | 'speaking' | 'ringing';

const WORDS: Record<ListeningState, string> = {
  listening: 'Listening…',
  speaking: 'Speaking',
  ringing: 'Calling…',
};

// Five level bars of different heights, out of step with each other. Each rests at 35% of its
// height, the last frame of the listening-bar keyframes, so stopping never jumps.
const BARS = [
  { height: 'h-2', delay: 'motion-safe:[animation-delay:-450ms]' },
  { height: 'h-3.5', delay: 'motion-safe:[animation-delay:-150ms]' },
  { height: 'h-4', delay: 'motion-safe:[animation-delay:-600ms]' },
  { height: 'h-2.5', delay: 'motion-safe:[animation-delay:-300ms]' },
  { height: 'h-3', delay: 'motion-safe:[animation-delay:-750ms]' },
] as const;

export interface ListeningBarProps {
  /** 'listening' while the other person talks, 'speaking' while the agent does. */
  state: ListeningState;
  /** Seconds into the call, shown as m:ss in tabular figures. Leave out to hide the timer. */
  seconds?: number | null;
  /**
   * The bars move only while this is true, and then for 4.5 seconds after each change of
   * `state` or `activity` (WCAG 2.2.2). Static under reduced motion.
   */
  active?: boolean;
  /** Change it on each new line (a turn index or time) to restart the bars without a state change. */
  activity?: string | number;
  /** Read state changes aloud (role=status). Pass false for a looping sample nobody started. */
  announce?: boolean;
  className?: string;
}

/**
 * The white "Listening…" pill: level bars, the state in words, and the call timer. Sits at the
 * foot of a transcript card, on canvas or on glass.
 * <ListeningBar state={lastTurn.speaker === 'agent' ? 'speaking' : 'listening'} seconds={clock} active={playing} activity={turns.length} />
 */
export function ListeningBar({
  state,
  seconds,
  active = true,
  activity,
  announce = true,
  className,
}: ListeningBarProps) {
  const time = seconds == null || !Number.isFinite(seconds) ? '' : formatTurnTime(Math.max(0, seconds));
  return (
    <div
      className={cn(
        'flex h-12 min-w-0 items-center gap-3 rounded-pill border border-border bg-canvas pl-4 pr-2 text-label font-medium text-text shadow-xs',
        className,
      )}
    >
      {/* Remounted on each change, so the bars play again from the start. */}
      <span
        key={`${state}:${activity ?? ''}`}
        aria-hidden
        className="flex h-4 shrink-0 items-center gap-[3px] text-accent"
      >
        {BARS.map((bar, i) => (
          <span
            key={i}
            className={cn(
              'w-[3px] rounded-full bg-current [scale:1_0.35] forced-colors:bg-[CanvasText]',
              bar.height,
              active && ['motion-safe:animate-listening-bar', bar.delay, 'motion-reduce:[scale:1_1]'],
            )}
          />
        ))}
      </span>
      <span
        role={announce ? 'status' : undefined}
        className={cn('min-w-0 flex-1 truncate', state === 'listening' ? 'text-accent' : 'text-text')}
      >
        {WORDS[state]}
      </span>
      {time ? (
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill bg-subtle px-3 text-caption font-medium tabular-nums text-text-2">
          <span aria-hidden className="size-1.5 rounded-full bg-accent forced-colors:bg-[CanvasText]" />
          <span className="sr-only">Call time </span>
          <time dateTime={`PT${Math.floor(Math.max(0, seconds ?? 0))}S`}>{time}</time>
        </span>
      ) : null}
    </div>
  );
}
