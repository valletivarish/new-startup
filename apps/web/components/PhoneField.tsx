'use client';

import { useEffect, useState } from 'react';
import {
  COUNTRY_DIALS,
  composeE164,
  defaultDial,
  splitE164,
} from '../lib/phone-field';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PhoneFieldProps {
  /** Full E.164 value (e.g. +918919504427) or empty. */
  value: string;
  onChange: (e164: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Shown inside the national number input. */
  placeholder?: string;
  className?: string;
}

/**
 * Country-code dropdown + national number. Default dial is India (+91).
 * Parent always receives/stores E.164 (or '').
 */
export function PhoneField({
  value,
  onChange,
  disabled,
  required,
  id,
  'aria-label': ariaLabel,
  placeholder = 'Mobile number',
  className,
}: PhoneFieldProps) {
  const parsed = splitE164(value);
  const [dial, setDial] = useState(parsed.dial || defaultDial());
  const [national, setNational] = useState(parsed.national);

  // Sync when parent value changes (e.g. reload / resume extract).
  useEffect(() => {
    const next = splitE164(value);
    setDial(next.dial || defaultDial());
    setNational(next.national);
  }, [value]);

  function emit(nextDial: string, nextNational: string) {
    onChange(composeE164(nextDial, nextNational));
  }

  // Unique dial options (US/CA share +1 — keep first label that matches dial).
  const dialOptions = COUNTRY_DIALS.filter(
    (c, i, arr) => arr.findIndex((x) => x.dial === c.dial) === i,
  );

  return (
    <div className={cn('flex min-w-0 flex-1 items-stretch gap-2', className)}>
      <Select
        value={dial}
        disabled={disabled}
        aria-label="Country code"
        className="w-auto max-w-[10rem] shrink-0"
        onChange={(e) => {
          const next = e.target.value;
          setDial(next);
          emit(next, national);
        }}
      >
        {dialOptions.map((c) => (
          <option key={c.iso} value={c.dial}>
            {c.label}
          </option>
        ))}
        {/* Preserve unknown dial from an existing E.164 value */}
        {!dialOptions.some((c) => c.dial === dial) && dial && (
          <option value={dial}>+{dial}</option>
        )}
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={national}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel ?? 'Mobile number'}
        placeholder={placeholder}
        className="min-w-0 flex-1"
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d\s-]/g, '');
          setNational(next);
          emit(dial, next);
        }}
      />
    </div>
  );
}
