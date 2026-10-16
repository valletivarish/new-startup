'use client';

import { useEffect, useRef, useState, type AriaAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  COUNTRY_DIALS,
  composeE164,
  defaultDial,
  splitE164,
} from '../lib/phone-field';
import { cn } from './ui/cn';

// Unique dial options: the US and Canada share +1, so the first label wins.
const DIAL_OPTIONS = COUNTRY_DIALS.filter((c, i, all) => all.findIndex((x) => x.dial === c.dial) === i);

export interface PhoneFieldProps {
  /** Full E.164 value (e.g. +918919504427) or empty. */
  value: string;
  onChange: (e164: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Goes to the number input, so a Field label names it. */
  id?: string;
  /** Only needed outside a Field. Defaults to "Mobile number" when there is no id to label. */
  'aria-label'?: string;
  /** Set by Field: hint and error ids, linked to the number input. */
  'aria-describedby'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  /** Shown inside the national number input. */
  placeholder?: string;
  className?: string;
}

/**
 * One field with two parts: the country code ("+91", India by default) and the national number.
 * The parent always receives and stores E.164 (or ''). Works as the one control inside a Field.
 */
export function PhoneField({
  value,
  onChange,
  disabled,
  required,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  placeholder = 'Mobile number',
  className,
}: PhoneFieldProps) {
  const parsed = splitE164(value);
  const [dial, setDial] = useState(parsed.dial || defaultDial());
  const [national, setNational] = useState(parsed.national);
  // The value this field last sent up. Only a different one (a reload, a resume extract) is
  // copied back in, so typing keeps its own spaces and leading zero.
  const sent = useRef(value);

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    const next = splitE164(value);
    setDial(next.dial || defaultDial());
    setNational(next.national);
  }, [value]);

  function emit(nextDial: string, nextNational: string) {
    const e164 = composeE164(nextDial, nextNational);
    sent.current = e164;
    onChange(e164);
  }

  return (
    <div
      className={cn(
        'flex h-11 min-w-0 flex-1 items-stretch rounded-input border border-input bg-canvas text-text transition-colors duration-fast hover:border-text-3',
        'has-[[aria-invalid=true]]:border-destructive',
        'has-[:disabled]:border-border has-[:disabled]:bg-subtle has-[:disabled]:text-text-3',
        className,
      )}
    >
      {/* The select is see-through over its own short label: the list shows "India (+91)", the field "+91". */}
      <span
        className={cn(
          // -m-px: both parts reach over the frame's border, so each is a full 44px target.
          'relative -my-px -ml-px flex shrink-0 items-center gap-1 rounded-l-input pl-3.5 pr-2.5 text-body tabular-nums [@media(pointer:coarse)]:text-base',
          // Keyboard focus draws inside the part that has it, so it is clear which of the two is focused.
          'has-[:focus-visible]:[outline:2px_solid_var(--focus-ring)] has-[:focus-visible]:[outline-offset:-2px]',
        )}
      >
        <span aria-hidden>+{dial}</span>
        <ChevronDown aria-hidden strokeWidth={1.5} className="size-4 text-text-3" />
        <select
          value={dial}
          disabled={disabled}
          aria-label="Country code"
          aria-invalid={invalid}
          className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 text-base disabled:cursor-not-allowed"
          onChange={(e) => {
            const next = e.target.value;
            setDial(next);
            emit(next, national);
          }}
        >
          {DIAL_OPTIONS.map((c) => (
            <option key={c.iso} value={c.dial}>
              {c.label}
            </option>
          ))}
          {/* Keep a dial from an existing E.164 value that isn't in the list. */}
          {!DIAL_OPTIONS.some((c) => c.dial === dial) && dial ? <option value={dial}>+{dial}</option> : null}
        </select>
      </span>
      <span aria-hidden className="my-2.5 w-px shrink-0 bg-border" />
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={national}
        disabled={disabled}
        required={required}
        // A Field label names the input through its id; an aria-label would override it.
        aria-label={ariaLabel ?? (id ? undefined : 'Mobile number')}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        placeholder={placeholder}
        className={cn(
          '-my-px -mr-px min-w-0 flex-1 rounded-r-input bg-transparent px-3 text-body tabular-nums placeholder:text-text-3 disabled:cursor-not-allowed',
          // Touch keyboards zoom into text under 16px.
          '[@media(pointer:coarse)]:text-base',
          'focus-visible:shadow-none focus-visible:[outline-offset:-2px]',
        )}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d\s-]/g, '');
          setNational(next);
          emit(dial, next);
        }}
      />
    </div>
  );
}
