'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { CircleAlert, RotateCw, WifiOff } from 'lucide-react';
import { Button } from './button';
import { cn } from './cn';
import { IconTile } from './empty-state';
import { STATUS_TONE } from './notice';

export type ErrorStateProps = {
  /** Plain cause: what happened, in the interface's voice. */
  cause?: ReactNode;
  /** What to do next. */
  nextStep?: ReactNode;
  /** Shows the Retry button. */
  onRetry?: () => void;
  /** Retry in flight: the button shows it is busy and ignores clicks. */
  retrying?: boolean;
  /** The way out when Retry won't help, e.g. a "Back to jobs" link button. Sits where Retry does. */
  action?: ReactNode;
  /** Support reference from a server error, shown so people can quote it. */
  supportRef?: string | null;
  /** 1 when the error is the whole page (no page header); 3 inside a section that has its own h2. */
  headingLevel?: 1 | 2 | 3;
  className?: string;
} & (
  | { variant?: 'error'; title: ReactNode }
  | { variant: 'offline'; title?: ReactNode }
);

/**
 * Section or page error, centred: tinted icon tile, title, cause and next step, Retry or a way
 * out, support reference.
 */
export function ErrorState({
  variant = 'error',
  title,
  cause,
  nextStep,
  onRetry,
  retrying = false,
  action,
  supportRef,
  headingLevel = 2,
  className,
}: ErrorStateProps) {
  const offline = variant === 'offline';
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 3 ? 'h3' : 'h2';

  // A retry that fails again leaves the same words behind, which a screen reader won't repeat.
  // Count settled retries and remount the words on each, so the alert reads them out again.
  const [wasRetrying, setWasRetrying] = useState(retrying);
  const [tries, setTries] = useState(0);
  if (retrying !== wasRetrying) {
    setWasRetrying(retrying);
    if (!retrying) setTries((n) => n + 1);
  }
  const first = offline ? (cause ?? 'This page needs a connection to load.') : cause;
  const second = offline ? (nextStep ?? 'Reconnect, then retry.') : nextStep;

  return (
    <div
      role={offline ? 'status' : 'alert'}
      className={cn('flex flex-col items-center px-6 py-12 text-center', className)}
    >
      <IconTile className={STATUS_TONE[offline ? 'warning' : 'danger']}>
        {offline ? <WifiOff /> : <CircleAlert />}
      </IconTile>
      <Fragment key={tries}>
        <Heading className="mb-0 mt-4 text-md font-semibold text-text">{title ?? 'You’re offline'}</Heading>
        {first || second ? (
          <p className="mb-0 mt-1 max-w-[48ch] text-text-2">
            {first}
            {first && second ? ' ' : null}
            {second}
          </p>
        ) : null}
      </Fragment>
      {/* Outside the keyed words, so focus stays on Retry. */}
      {onRetry || action ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button variant="secondary" loading={retrying} onClick={onRetry}>
              <RotateCw aria-hidden strokeWidth={1.5} />
              Retry
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
      {supportRef ? (
        <p className="mb-0 mt-4 text-meta text-text-3">
          Reference for support:{' '}
          <span className="select-all font-medium tabular-nums text-text-2">{supportRef}</span>
        </p>
      ) : null}
    </div>
  );
}
