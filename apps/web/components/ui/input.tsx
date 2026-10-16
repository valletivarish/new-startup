'use client';

import * as React from 'react';
import { ChevronDown, CircleAlert, Eye, EyeOff, Search, Upload } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Kbd } from './kbd';

// Shared look of every text-like control: canvas fill with a 1px border-input edge (3:1 on canvas,
// so keep the canvas fill). Focus turns the edge accent, 2px thick, with a soft accent halo; an
// invalid control keeps its danger edge and takes a danger halo. 16px text under a finger, so iOS
// doesn't zoom. No radius here: each control sets its own, so a caller's radius never competes.
const control =
  'w-full border border-input bg-canvas px-3.5 text-body text-text transition-[border-color,box-shadow] placeholder:text-text-3 hover:border-text-3 focus-visible:border-accent focus-visible:outline-none focus-visible:[box-shadow:0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)] disabled:cursor-not-allowed disabled:border-border disabled:bg-subtle disabled:text-text-3 aria-[invalid=true]:border-status-danger-text aria-[invalid=true]:focus-visible:[box-shadow:0_0_0_1px_var(--status-danger-text),0_0_0_4px_var(--status-danger-bg)] [@media(pointer:coarse)]:text-md';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, 'h-11 rounded-input', className)} {...props} />
));
Input.displayName = 'Input';

export interface SearchInputProps extends Omit<InputProps, 'type'> {
  /** Key hint at the end, e.g. "⌘K". Only a hint: the page wires the shortcut itself. */
  shortcut?: string;
}

/**
 * Search field with a leading search icon, 12px corners like D2's, 40px (44px under a finger)
 * to sit with buttons. className sizes the wrapper; the rest goes to <input>. Needs a label:
 * wrap it in a Field or pass aria-label.
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, shortcut, ...props }, ref) => (
    <span data-control="" className={cn('relative block w-full', className)}>
      <Search
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-3"
      />
      <input
        ref={ref}
        type="search"
        className={cn(
          control,
          // The browser's blue clear button clashes with the hint; Escape still clears the field.
          'h-10 rounded-input pl-10 [@media(pointer:coarse)]:h-11 [&::-webkit-search-cancel-button]:appearance-none',
          shortcut ? 'pr-14' : 'pr-4',
        )}
        {...props}
      />
      {shortcut ? (
        <Kbd aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {shortcut}
        </Kbd>
      ) : null}
    </span>
  ),
);
SearchInput.displayName = 'SearchInput';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(control, 'min-h-24 resize-y rounded-input py-2.5', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

// Set by Field: the control is a form field, 44px tall like every input (D2).
const InField = React.createContext(false);

/**
 * Native select. className sizes the wrapper (width, flex); the rest goes to <select>. In a Field
 * it is a form field, 44px like the inputs around it; in a filter row it is 40px (44px under a
 * finger), as tall as the SearchInput, Segmented and md Button beside it.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => {
  const inField = React.useContext(InField);
  return (
    // data-control: inside a strip the wrapper lifts over the title's overlay as one piece,
    // so the chevron stays drawn over the select (globals.css, [data-strip]).
    <span data-control="" className={cn('relative block w-full', className)}>
      <select
        ref={ref}
        className={cn(
          control,
          'cursor-pointer appearance-none rounded-input pr-10',
          inField ? 'h-11' : 'h-10 [@media(pointer:coarse)]:h-11',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-text-2"
      />
    </span>
  );
});
Select.displayName = 'Select';

/** Password with a show/hide button. className sizes the wrapper; the rest goes to <input>. */
const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ className, ...props }, ref) => {
    const [shown, setShown] = React.useState(false);
    return (
      <span data-control="" className={cn('relative block w-full', className)}>
        <Input ref={ref} type={shown ? 'text' : 'password'} className="pr-12" {...props} />
        <IconButton
          label={shown ? 'Hide password' : 'Show password'}
          variant="quiet"
          disabled={props.disabled}
          onClick={() => setShown((v) => !v)}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 hover:bg-transparent"
        >
          {shown ? <EyeOff strokeWidth={1.75} aria-hidden /> : <Eye strokeWidth={1.75} aria-hidden />}
        </IconButton>
      </span>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/* ------------------------------------------------------------------------------------------ */
/* File input                                                                                  */

type FileLike = Pick<File, 'name' | 'type' | 'size'>;

/** Does the file match an accept string such as ".pdf,application/pdf,image/*"? */
export function fileMatchesAccept(file: FileLike, accept?: string): boolean {
  const tokens = (accept ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((t) =>
    t.startsWith('.') ? name.endsWith(t) : t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : type === t,
  );
}

/** ".pdf,.docx,text/plain" reads as "PDF or DOCX". Null when accept names no extensions. */
export function describeAccept(accept?: string): string | null {
  const exts = (accept ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.startsWith('.'))
    .map((t) => t.slice(1).toUpperCase());
  const last = exts.pop();
  if (last === undefined) return null;
  return exts.length ? `${exts.join(', ')} or ${last}` : last;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Keeps the files that pass `accept` and `maxBytes`; explains the first refusal in plain words. */
export function validateFiles<T extends FileLike>(
  files: ReadonlyArray<T>,
  rules: { accept?: string; maxBytes?: number },
): { accepted: T[]; error: string | null } {
  const accepted: T[] = [];
  const reasons: string[] = [];
  for (const file of files) {
    if (!fileMatchesAccept(file, rules.accept)) {
      const kinds = describeAccept(rules.accept);
      reasons.push(`${file.name} isn’t a file this accepts. ${kinds ? `Use ${kinds}.` : 'Choose a different file.'}`);
    } else if (rules.maxBytes != null && file.size > rules.maxBytes) {
      reasons.push(`${file.name} is ${formatBytes(file.size)}. Files can be up to ${formatBytes(rules.maxBytes)}.`);
    } else {
      accepted.push(file);
    }
  }
  if (reasons.length === 0) return { accepted, error: null };
  const others = reasons.length - 1;
  const more = others === 0 ? '' : ` ${others} other ${others === 1 ? 'file was' : 'files were'} also left out.`;
  return { accepted, error: reasons[0] + more };
}

export interface FileInputProps {
  /** Filters the picker and is checked again on drop, which bypasses the picker. */
  accept?: string;
  /** Largest file accepted, in bytes. Bigger files are refused with a plain error. */
  maxBytes?: number;
  required?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  /** Sizes the outer wrapper. */
  className?: string;
  /** Called with the first accepted file, or null when nothing usable was chosen. */
  onFileChange?: (file: File | null) => void;
  onFilesChange?: (files: File[]) => void;
  emptyLabel?: string;
  buttonLabel?: string;
  /** `dropzone` is the taller click-or-drop target for primary upload surfaces. */
  variant?: 'inline' | 'dropzone';
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
}

/**
 * File picker in a field shell. The native input is the single tab stop (so a Field label
 * names it); the visible button and the drop area are pointer conveniences.
 */
export function FileInput({
  accept,
  maxBytes,
  required,
  disabled,
  multiple,
  className,
  onFileChange,
  onFilesChange,
  emptyLabel = 'No file chosen',
  buttonLabel = 'Choose file',
  variant = 'inline',
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: FileInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();
  const dropzone = variant === 'dropzone';

  function syncNativeFiles(list: File[]) {
    const el = inputRef.current;
    if (!el) return;
    if (list.length === 0) {
      el.value = '';
      return;
    }
    try {
      const dt = new DataTransfer();
      for (const file of list) dt.items.add(file);
      el.files = dt.files;
    } catch {
      // Older engines refuse the assignment; the parent still gets the files.
    }
  }

  function applyFiles(list: File[]) {
    const { accepted, error: problem } = validateFiles(list, { accept, maxBytes });
    setError(problem);
    setFileName(
      accepted.length > 1 ? `${accepted.length} files selected` : (accepted[0]?.name ?? null),
    );
    syncNativeFiles(accepted);
    onFileChange?.(accepted[0] ?? null);
    onFilesChange?.(accepted);
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  function onDrag(event: React.DragEvent, over: boolean) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(over && !disabled);
  }

  return (
    <div className={cn('grid w-full gap-1.5', className)}>
      <div
        className={cn(
          // The native input is sr-only, so the box draws its focus ring.
          'w-full cursor-pointer rounded-input border border-dashed border-input bg-canvas transition-[border-color,background-color] hover:border-text-3 has-[:focus-visible]:[outline:2px_solid_var(--focus-ring)] has-[:focus-visible]:outline-offset-2',
          dropzone
            ? 'flex min-h-36 flex-col items-center justify-center gap-3 px-4 py-6 text-center'
            : 'flex min-h-11 items-center gap-3 px-1 py-1',
          dragging && 'border-solid border-accent bg-accent-soft',
          error && 'border-solid border-status-danger-text',
          disabled && 'cursor-not-allowed border-border bg-subtle hover:border-border',
        )}
        onClick={(event) => {
          // The whole box opens the picker; the button and input handle their own clicks.
          if ((event.target as HTMLElement).closest('button, input')) return;
          openPicker();
        }}
        onDragEnter={(event) => onDrag(event, true)}
        onDragOver={(event) => onDrag(event, true)}
        onDragLeave={(event) => onDrag(event, false)}
        onDrop={(event) => {
          onDrag(event, false);
          if (disabled) return;
          const list = Array.from(event.dataTransfer.files ?? []);
          applyFiles(multiple ? list : list.slice(0, 1));
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          required={required}
          disabled={disabled}
          multiple={multiple}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={[ariaDescribedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : ariaInvalid}
          className="sr-only"
          onChange={(event) => applyFiles(event.target.files ? Array.from(event.target.files) : [])}
          onInvalid={(event) => {
            event.preventDefault();
            setError('Choose a file to continue.');
          }}
        />
        {dropzone ? (
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-pill border border-border bg-subtle text-text-2"
          >
            <Upload strokeWidth={1.75} className="size-[1.125rem]" />
          </span>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          // A dropzone reads icon, what to drop, then the button.
          className={cn('shrink-0', dropzone && 'order-last')}
          onClick={(event) => {
            event.stopPropagation();
            openPicker();
          }}
        >
          {buttonLabel}
        </Button>
        <span
          className={cn(
            'min-w-0 text-label',
            dropzone ? 'max-w-sm' : 'flex-1 truncate',
            fileName ? 'text-text' : 'text-text-3',
          )}
        >
          {dragging ? (multiple ? 'Drop files here' : 'Drop file here') : (fileName ?? emptyLabel)}
        </span>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="m-0 flex items-start gap-1.5 text-meta text-status-danger-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Field                                                                                       */

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
};

/** Ids that tie a label, hint and error to one control. Exported for tests. */
export function fieldIds(
  base: string,
  opts: { id?: string; hint?: boolean; error?: boolean; describedBy?: string },
) {
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const describedBy =
    [opts.describedBy, opts.hint ? hintId : null, opts.error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return { controlId: opts.id ?? `${base}-control`, hintId, errorId, describedBy };
}

export interface FieldProps {
  label: React.ReactNode;
  /** Shown under the control (and its error), outside the label, linked with aria-describedby. */
  hint?: React.ReactNode;
  /** Shown under the control with a glyph; sets aria-invalid on the control. */
  error?: React.ReactNode;
  /** Announce the error with role="alert". Keep on for errors shown after submit; pass false for errors that change while typing. */
  announce?: boolean;
  /** Id for the control when the child has none. */
  htmlFor?: string;
  className?: string;
  /** Exactly one control that accepts id, aria-describedby and aria-invalid. */
  children: React.ReactNode;
  /** @deprecated Not needed any more: every control is labelled through its id. */
  compound?: boolean;
}

/** Label above, one control, then the error and the hint below. Wires ids so nothing relies on wrapping. */
export function Field({
  label,
  hint,
  error,
  announce = true,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const base = React.useId();
  const child = React.isValidElement<ControlProps>(children) ? children : null;
  const ids = fieldIds(base, {
    id: child?.props.id ?? htmlFor,
    hint: Boolean(hint),
    error: Boolean(error),
    describedBy: child?.props['aria-describedby'],
  });

  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={ids.controlId} className="text-label font-medium text-text">
        {label}
      </label>
      <InField.Provider value>
        {child
          ? React.cloneElement(child, {
              id: ids.controlId,
              'aria-describedby': ids.describedBy,
              'aria-invalid': error ? true : child.props['aria-invalid'],
            })
          : children}
      </InField.Provider>
      {error ? (
        <p
          id={ids.errorId}
          role={announce ? 'alert' : undefined}
          className="m-0 flex items-start gap-1.5 text-meta text-status-danger-text"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={ids.hintId} className="m-0 text-meta text-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export { Input, SearchInput, Textarea, Select, PasswordInput };
