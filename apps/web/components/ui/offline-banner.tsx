import { WifiOff } from 'lucide-react';
import { cn } from './cn';
import { STATUS_TONE } from './notice';

/**
 * A warning pill centred at the top of the shell. Presentational: the shell passes `online`
 * (from useOnline) and does the refetch on reconnect. The status region stays mounted so going
 * offline is announced. aria-live is explicit: an open Sheet or Dialog hides everything outside
 * it from screen readers except elements carrying aria-live, so role="status" alone would go
 * quiet then.
 */
export function OfflineBanner({ online, className }: { online: boolean; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={online ? 'sr-only' : cn('flex justify-center px-3 pt-3', className)}
    >
      {online ? null : (
        // 20px radius: a pill on one line, a soft card when it wraps on a phone.
        <p
          className={cn(
            'm-0 inline-flex max-w-full items-center gap-2 rounded-card border px-4 py-2 text-label font-medium',
            STATUS_TONE.warning,
          )}
        >
          <WifiOff aria-hidden strokeWidth={1.5} className="size-4 shrink-0" />
          <span>You’re offline. Changes won’t save until you reconnect.</span>
        </p>
      )}
    </div>
  );
}
