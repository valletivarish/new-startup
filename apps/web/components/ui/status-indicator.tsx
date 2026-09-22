import { cn } from '@/lib/utils';

const tones = {
  idle: 'bg-[var(--foreground-muted)]',
  connecting: 'bg-info',
  connected: 'bg-success',
  listening: 'bg-accent',
  processing: 'bg-warning',
  speaking: 'bg-accent',
  interrupted: 'bg-warning',
  reconnecting: 'bg-info',
  completed: 'bg-success',
  failed: 'bg-danger',
} as const;

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

const labels: Record<VoiceStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  connected: 'Connected',
  listening: 'Listening',
  processing: 'Processing',
  speaking: 'Speaking',
  interrupted: 'Interrupted',
  reconnecting: 'Reconnecting',
  completed: 'Completed',
  failed: 'Failed',
};

export function StatusIndicator({
  status,
  className,
  showLabel = true,
}: {
  status: VoiceStatus;
  className?: string;
  showLabel?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-sm text-[var(--foreground-secondary)]',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          tones[status],
          status === 'listening' || status === 'speaking' || status === 'processing'
            ? 'motion-safe:animate-pulse'
            : undefined,
        )}
        aria-hidden
      />
      {showLabel ? (
        <span>{labels[status]}</span>
      ) : (
        <span className="sr-only">{labels[status]}</span>
      )}
    </span>
  );
}
