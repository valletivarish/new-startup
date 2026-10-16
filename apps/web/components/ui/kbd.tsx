import * as React from 'react';
import { cn } from './cn';

/** A key name in running text or a shortcut hint: <Kbd>⌘K</Kbd>. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border bg-subtle px-1.5 font-sans text-caption font-medium tabular-nums text-text-2',
        className,
      )}
      {...props}
    />
  );
}
