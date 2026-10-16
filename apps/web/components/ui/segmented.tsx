'use client';

import * as React from 'react';
import { cn } from './cn';
import { Select } from './input';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Shown after the label in tabular figures. Omit when unknown; never fake a 0. */
  count?: number | null;
}

export interface SegmentedProps<T extends string = string> {
  /** Names the group for screen readers, e.g. "Filter jobs". */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /**
   * Below this width, a native select ("All · 7") instead of the pills: the phone pattern for a
   * filter with more options than fit a phone. Labels must be text then.
   */
  collapseBelow?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// [hide the pills, hide the select] for each breakpoint.
const COLLAPSE = {
  sm: ['max-sm:hidden', 'sm:hidden'],
  md: ['max-md:hidden', 'md:hidden'],
  lg: ['max-lg:hidden', 'lg:hidden'],
  xl: ['max-xl:hidden', 'xl:hidden'],
} as const;

/** An option as one line of text: "Moved forward · 1". */
export function optionText(option: SegmentedOption): string {
  const label = typeof option.label === 'string' ? option.label : option.value;
  return option.count != null ? `${label} · ${option.count}` : label;
}

/** Arrow keys, Home and End move the selection, as in any radio group. */
export function nextIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * One-of-many filter. Radio-group semantics with roving focus. Use Tabs for panels. A track that
 * still overflows scrolls, fading at the edge with more (scroll-fade-x).
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onValueChange,
  collapseBelow,
  className,
}: SegmentedProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((o) => o.value === value);
  // With no match, the first option still takes Tab focus.
  const focusable = selected === -1 ? 0 : selected;

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const next = nextIndex(event.key, index, options.length);
    const option = next === null ? undefined : options[next];
    if (next === null || !option) return;
    event.preventDefault();
    onValueChange(option.value);
    refs.current[next]?.focus();
  }

  const track = (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        // A subtle 12px track with a hairline edge; the selected option is a raised white 8px chip,
        // concentric with the track (12 minus the 4px inset).
        'scroll-fade-x inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-input bg-subtle p-1 ring-1 ring-inset ring-border',
        collapseBelow && COLLAPSE[collapseBelow][0],
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = index === selected;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              // min-w-11: a short option ("All") still has a 44px wide target. One weight for every
              // option, so the group never shifts when the selection moves.
              'inline-flex h-8 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3.5 text-label font-medium transition-[color,background-color,box-shadow] focus-visible:outline-offset-0 [@media(pointer:coarse)]:h-11',
              checked
                ? // Raised chip plus darker text: the choice never rests on colour alone. Forced
                  // colours drop the fill and shadow; Highlight keeps the choice visible.
                  'bg-canvas text-text shadow-xs ring-1 ring-border forced-colors:bg-[color:Highlight] forced-colors:text-[color:HighlightText] forced-colors:[forced-color-adjust:none]'
                : 'text-text-3 hover:text-text',
            )}
          >
            <span>{option.label}</span>
            {option.count != null ? (
              <>
                {' '}
                {/* forced-color-adjust inherits, so the selected count takes HighlightText too. */}
                <span className={cn('tabular-nums', checked ? 'text-text-2 forced-colors:text-inherit' : 'text-text-3')}>
                  {option.count}
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
  if (!collapseBelow) return track;
  return (
    <>
      {track}
      <Select
        value={value}
        onChange={(event) => onValueChange(event.target.value as T)}
        aria-label={label}
        className={cn(COLLAPSE[collapseBelow][1], className)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionText(option)}
          </option>
        ))}
      </Select>
    </>
  );
}
