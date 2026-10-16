'use client';

import { getStateMeta } from '../../lib/status-labels';
import { cn } from './cn';
import { StatusBadge, stateBadge } from './state-tag';

/** Test call states from the voice SDK's events. Words, tones and icons: STATE_MAP.voice. */
export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'interrupted'
  | 'reconnecting'
  | 'completed'
  | 'failed';

/** A test call's state as a StatusBadge in a polite live region. It replays its entrance on every change. */
export function StatusIndicator({
  status,
  className,
  showLabel = true,
}: {
  status: VoiceStatus;
  className?: string;
  /** false shows the icon only; the word stays for screen readers. */
  showLabel?: boolean;
}) {
  const meta = getStateMeta('voice', status);
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex', className)}>
      <StatusBadge {...stateBadge(meta)} stamped={status}>
        <span className={showLabel ? undefined : 'sr-only'}>{meta.label}</span>
      </StatusBadge>
    </span>
  );
}
