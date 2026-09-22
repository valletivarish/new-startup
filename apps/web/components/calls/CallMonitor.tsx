'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  StatusIndicator,
  type VoiceStatus,
} from '@/components/ui/status-indicator';
import { VoiceWaveform } from '@/components/calls/VoiceWaveform';
import {
  mapSessionStatus,
  resolveOutboundMonitorStatus,
} from '@/components/calls/outbound-monitor-status';

export { mapSessionStatus, resolveOutboundMonitorStatus };

export function CallMonitor({
  status,
  candidateName,
  jobTitle,
  elapsedLabel,
  failureDetail,
  onEnd,
  onRetry,
  onTransfer,
  className,
  busy,
}: {
  status: VoiceStatus;
  candidateName: string;
  jobTitle?: string;
  elapsedLabel?: string;
  /** When status is failed — keep the real reason visible in the monitor. */
  failureDetail?: string | null;
  onEnd?: () => void;
  onRetry?: () => void;
  onTransfer?: () => void;
  className?: string;
  busy?: boolean;
}) {
  const showWave =
    status === 'listening' ||
    status === 'speaking' ||
    status === 'processing' ||
    status === 'connected';

  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)] p-5 transition-[box-shadow,border-color] duration-fast',
        showWave &&
          'border-[color-mix(in_srgb,var(--accent)_28%,var(--separator-subtle))] shadow-sm',
        status === 'failed' &&
          'border-[color-mix(in_srgb,var(--danger)_28%,var(--separator-subtle))]',
        className,
      )}
      role="region"
      aria-label="Call monitor"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-display text-base font-semibold tracking-tight">
            {candidateName}
          </p>
          {jobTitle ? (
            <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
              {jobTitle}
            </p>
          ) : null}
        </div>
        <StatusIndicator status={status} />
      </div>

      {status === 'failed' && failureDetail ? (
        <p
          role="alert"
          className="mt-4 mb-0 rounded-md bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3.5 py-2.5 text-[13px] leading-snug text-[var(--danger)]"
        >
          {failureDetail}
        </p>
      ) : null}

      {showWave ? (
        <VoiceWaveform className="mt-6" active />
      ) : status === 'failed' ? null : (
        <div className="mt-6 flex h-12 items-end justify-center" aria-hidden>
          <span className="h-px w-16 bg-[var(--separator)]" />
        </div>
      )}

      {elapsedLabel ? (
        <p className="mt-3 mb-0 text-center font-mono text-[11px] tabular-nums text-[var(--foreground-muted)]">
          {elapsedLabel}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {onEnd &&
        (status === 'connected' ||
          status === 'listening' ||
          status === 'speaking' ||
          status === 'processing' ||
          status === 'connecting') ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={onEnd}
          >
            End call
          </Button>
        ) : null}
        {onTransfer &&
        status !== 'failed' &&
        status !== 'completed' &&
        status !== 'idle' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onTransfer}
          >
            Transfer to recruiter
          </Button>
        ) : null}
        {onRetry && (status === 'failed' || status === 'completed') ? (
          <Button type="button" size="sm" disabled={busy} onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
