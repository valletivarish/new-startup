'use client';

import { useId, useRef, useState } from 'react';
import { CircleAlert, FileSpreadsheet, Plus, X } from 'lucide-react';
import { PhoneField } from './PhoneField';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { numbersFromFile } from '../lib/phone-import';

export interface PhoneListFieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** E.164 numbers. Empty strings are rows still being typed; drop them when saving. */
  value: string[];
  onChange: (numbers: string[]) => void;
  max?: number;
}

/**
 * A list of phone numbers: one number field per row with its own remove button, "Add number"
 * for another row, and "Upload a list" to bring many in at once from Excel (.xlsx), CSV or text.
 * Always shows at least one row, so the first number is typed straight away.
 */
export function PhoneListField({ label, hint, error, value, onChange, max = 10 }: PhoneListFieldProps) {
  const base = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const rows = value.length > 0 ? value : [''];
  const filled = rows.filter(Boolean).length;
  const full = rows.length >= max;

  function update(index: number, next: string) {
    onChange(rows.map((n, i) => (i === index ? next : n)));
  }
  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
    // Focus the row that took its place, or the new last row.
    requestAnimationFrame(() => document.getElementById(`${base}-${Math.min(index, next.length - 1)}`)?.focus());
  }
  function add() {
    onChange([...rows, '']);
    requestAnimationFrame(() => document.getElementById(`${base}-${rows.length}`)?.focus());
  }

  async function upload(file: File) {
    setNote(null);
    try {
      const { numbers, skipped } = await numbersFromFile(file);
      const kept = rows.filter(Boolean);
      const added = numbers.filter((n) => !kept.includes(n));
      const room = Math.max(0, max - kept.length);
      const taken = added.slice(0, room);
      onChange([...kept, ...taken]);
      const parts = [
        taken.length === 0
          ? `No new numbers found in ${file.name}.`
          : `Added ${taken.length} ${taken.length === 1 ? 'number' : 'numbers'} from ${file.name}.`,
      ];
      if (added.length > taken.length) parts.push(`${added.length - taken.length} more didn’t fit: the limit is ${max}.`);
      if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'row' : 'rows'} had no phone number.`);
      setNote(parts.join(' '));
    } catch {
      setNote(`Couldn’t read ${file.name}. Upload an Excel (.xlsx), CSV or text file.`);
    }
  }

  const errorId = `${base}-error`;
  const hintId = `${base}-hint`;
  const noteId = `${base}-note`;

  return (
    <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0" aria-describedby={[hint ? hintId : '', note ? noteId : ''].filter(Boolean).join(' ') || undefined}>
      <legend className="mb-1.5 p-0 text-label font-medium text-text">{label}</legend>

      <ol role="list" className="m-0 grid list-none gap-2 p-0">
        {rows.map((number, i) => (
          <li key={i} className="flex items-center gap-2">
            <PhoneField
              id={`${base}-${i}`}
              value={number}
              onChange={(next) => update(i, next)}
              aria-label={`${label}, number ${i + 1} of ${rows.length}`}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              placeholder="98765 43210"
            />
            <IconButton
              label={`Remove number ${i + 1}`}
              variant="quiet"
              disabled={rows.length === 1 && !number}
              onClick={() => (rows.length === 1 ? onChange([]) : remove(i))}
            >
              <X strokeWidth={1.5} />
            </IconButton>
          </li>
        ))}
      </ol>

      {error ? (
        <p id={errorId} role="alert" className="m-0 flex items-start gap-1.5 text-meta text-status-danger-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={full}>
          <Plus aria-hidden strokeWidth={1.5} />
          Add number
        </Button>
        <Button type="button" variant="tertiary" size="sm" onClick={() => fileInput.current?.click()} disabled={filled >= max}>
          <FileSpreadsheet aria-hidden strokeWidth={1.5} />
          Upload a list
        </Button>
        <span className="text-meta tabular-nums text-text-3">
          {filled} of {max}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void upload(file);
          }}
        />
      </div>

      <p id={noteId} aria-live="polite" className="m-0 text-meta text-text-2 empty:hidden">
        {note}
      </p>
      {hint ? (
        <p id={hintId} className="m-0 text-meta text-text-3">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
