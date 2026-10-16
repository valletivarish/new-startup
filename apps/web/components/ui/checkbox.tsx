'use client';

import * as React from 'react';
import { cn } from './cn';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label. Without one, pass aria-label. */
  label?: React.ReactNode;
  /** The "some selected" state of a select-all box. */
  indeterminate?: boolean;
}

/**
 * A real checkbox: an 18px box inside a 44px hit area. Unchecked is canvas with a border-input
 * edge (3:1); checked and indeterminate fill with primary and draw a white glyph, so the state
 * never rests on colour alone. Forced colours drop the fill, so the glyph turns CanvasText.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, indeterminate = false, className, disabled, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <label
        className={cn(
          'inline-flex min-h-11 min-w-11 select-none items-center gap-2.5 text-body text-text',
          label ? 'cursor-pointer' : 'justify-center',
          disabled && 'cursor-not-allowed text-text-3',
          className,
        )}
      >
        <span className="relative inline-flex size-[1.125rem] shrink-0">
          <input
            ref={inner}
            type="checkbox"
            disabled={disabled}
            // Toggled often, so the fill changes almost at once (80ms).
            className="peer size-[1.125rem] cursor-pointer appearance-none rounded-xs border border-input bg-canvas transition-[background-color,border-color] duration-instant hover:border-text-3 checked:border-primary checked:bg-primary checked:hover:bg-primary-hover indeterminate:border-primary indeterminate:bg-primary disabled:cursor-not-allowed disabled:border-border disabled:bg-subtle disabled:checked:bg-muted disabled:indeterminate:bg-muted"
            {...props}
          />
          <svg
            aria-hidden
            viewBox="0 0 18 18"
            className="pointer-events-none absolute inset-0 hidden size-[1.125rem] text-primary-foreground peer-checked:block peer-indeterminate:hidden peer-disabled:text-text-3 forced-colors:text-[color:CanvasText]"
          >
            <path
              d="M4.5 9.25l3 3L13.5 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            aria-hidden
            viewBox="0 0 18 18"
            className="pointer-events-none absolute inset-0 hidden size-[1.125rem] text-primary-foreground peer-indeterminate:block peer-disabled:text-text-3 forced-colors:text-[color:CanvasText]"
          >
            <path d="M5 9h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        {label}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
