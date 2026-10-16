'use client';

import * as React from 'react';
import { Check, CircleAlert, Copy } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';
import { Input } from './input';

export interface CopyFieldProps {
  /** Visible label, also used to name the Copy button ("Copy invite link"). */
  label: string;
  value: string;
  className?: string;
}

type Status = 'idle' | 'copied' | 'failed';

/** Read-only value with a Copy button. Screen readers hear "Copied" (polite). */
export function CopyField({ label, value, className }: CopyFieldProps) {
  const id = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState<Status>('idle');

  React.useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      // Clipboard blocked (permissions or an insecure page): focus selects the text instead.
      inputRef.current?.focus();
      setStatus('failed');
    }
  }

  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-label font-medium text-text">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 text-text-2"
        />
        {/* As tall as the field beside it, and wide enough for "Copied" so it never jumps. */}
        <Button type="button" variant="secondary" className="h-11 min-w-[6.5rem]" onClick={() => void copy()}>
          {status === 'copied' ? (
            <Check strokeWidth={1.75} aria-hidden />
          ) : (
            <Copy strokeWidth={1.75} aria-hidden />
          )}
          {status === 'copied' ? 'Copied' : 'Copy'}
          <span className="sr-only"> {label}</span>
        </Button>
      </div>
      <p
        aria-live="polite"
        className={cn(
          'm-0 text-meta',
          status === 'failed' ? 'flex items-start gap-1.5 text-status-danger-text' : 'sr-only',
        )}
      >
        {status === 'failed' ? (
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        ) : null}
        {status === 'copied'
          ? 'Copied'
          : status === 'failed'
            ? 'Couldn’t copy. The text is selected, so copy it with your keyboard.'
            : ''}
      </p>
    </div>
  );
}
