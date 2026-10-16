'use client';

import { Play } from 'lucide-react';
import { cn } from '../ui/cn';
import { formatTurnTime } from './transcript';

const PILL =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-pill border border-border px-2.5 text-caption font-medium tabular-nums';

export interface OriginTicketProps {
  /** Seconds into the call where it was said. */
  at: number;
  /** Seek the recording and highlight the turn. Without it the ticket is a plain label. */
  onSeek?: (at: number) => void;
  className?: string;
}

/**
 * The second an answer was said, as a time pill ("2:14"). Pressing it jumps there; focus stays
 * on the pill. Its name holds the visible time ("Jump to 2:14 in the call"), so speech input can say it.
 */
export function OriginTicket({ at, onSeek, className }: OriginTicketProps) {
  const time = formatTurnTime(at);
  if (!onSeek) {
    return (
      <span className={cn(PILL, 'bg-subtle text-text-2', className)}>
        <span className="sr-only">Said at </span>
        {time}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Jump to ${time} in the call`}
      onClick={() => onSeek(at)}
      className={cn(
        PILL,
        // ::after takes the hit area to 44px tall without moving the row.
        'relative bg-canvas text-text transition-[background-color,border-color,scale] duration-fast after:absolute after:-inset-x-1 after:-inset-y-2 hover:border-input hover:bg-subtle motion-safe:active:[scale:0.97]',
        className,
      )}
    >
      <Play aria-hidden strokeWidth={1.5} className="size-3 fill-current text-accent" />
      {time}
    </button>
  );
}
