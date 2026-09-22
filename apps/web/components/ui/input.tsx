import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-control w-full rounded-md border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] transition-[border-color,box-shadow] duration-fast ease-out placeholder:text-[var(--foreground-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[5rem] w-full rounded-md border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] transition-[border-color,box-shadow] duration-fast ease-out placeholder:text-[var(--foreground-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      className={cn(
        'flex h-control w-full rounded-md border border-[var(--separator)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] transition-[border-color,box-shadow] duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

/**
 * File picker that matches Quiet Signal controls — hides the browser’s
 * nested “Choose file” chrome inside a text-field shell. Supports drop.
 */
export function FileInput({
  accept,
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
}: {
  accept?: string;
  required?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  className?: string;
  onFileChange?: (file: File | null) => void;
  onFilesChange?: (files: File[]) => void;
  emptyLabel?: string;
  buttonLabel?: string;
  /** `dropzone` = taller click-to-browse target for primary upload surfaces. */
  variant?: 'inline' | 'dropzone';
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [missing, setMissing] = React.useState(false);
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
      // Assignment can fail in older engines; parent state still holds the file.
    }
  }

  function applyFiles(list: File[]) {
    const next = list[0] ?? null;
    setFileName(
      list.length === 0
        ? null
        : list.length === 1
          ? (next?.name ?? null)
          : `${list.length} files selected`,
    );
    setMissing(false);
    syncNativeFiles(list);
    onFileChange?.(next);
    onFilesChange?.(list);
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      className={cn(
        'w-full rounded-md border border-dashed border-[var(--separator)] bg-[var(--surface)] transition-[border-color,box-shadow,background-color] duration-fast ease-out focus-within:border-solid focus-within:ring-2 focus-within:ring-[var(--focus-ring)]',
        dropzone
          ? 'flex min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 px-4 py-5 text-center'
          : 'flex min-h-control items-center gap-3 px-2 py-1.5',
        dragging &&
          'border-solid border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]',
        missing && 'border-solid border-[var(--danger)]',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onClick={(e) => {
        if (!dropzone || disabled) return;
        if ((e.target as HTMLElement).closest('button')) return;
        openPicker();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (disabled) return;
        const list = Array.from(e.dataTransfer.files ?? []);
        const picked = multiple ? list : list.slice(0, 1);
        applyFiles(picked);
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
        className="sr-only"
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          applyFiles(list);
        }}
        onInvalid={(e) => {
          e.preventDefault();
          setMissing(true);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          openPicker();
        }}
      >
        {buttonLabel}
      </Button>
      <span
        className={cn(
          'min-w-0 text-sm',
          dropzone ? 'max-w-sm' : 'flex-1 truncate',
          fileName
            ? 'text-[var(--foreground-secondary)]'
            : 'text-[var(--foreground-tertiary)]',
        )}
      >
        {dragging
          ? multiple
            ? 'Drop files here'
            : 'Drop file here'
          : (fileName ?? emptyLabel)}
      </span>
    </div>
  );
}

/** Shared form field shell — label + control + optional hint. */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
  compound = false,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
  /** Use for controls that already contain buttons (e.g. FileInput). */
  compound?: boolean;
}) {
  const autoId = React.useId();
  const labelId = `${autoId}-label`;

  if (compound) {
    return (
      <div className={cn('grid gap-1.5', className)}>
        <span
          id={labelId}
          className="text-[12px] font-medium text-[var(--foreground-secondary)]"
        >
          {label}
        </span>
        {React.isValidElement(children)
          ? React.cloneElement(
              children as React.ReactElement<{
                'aria-labelledby'?: string;
              }>,
              {
                'aria-labelledby':
                  (children.props as { 'aria-labelledby'?: string })[
                    'aria-labelledby'
                  ] ?? labelId,
              },
            )
          : children}
        {hint ? (
          <span className="text-[12px] font-normal text-[var(--foreground-tertiary)]">
            {hint}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <label htmlFor={htmlFor} className={cn('grid gap-1.5', className)}>
      <span className="text-[12px] font-medium text-[var(--foreground-secondary)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[12px] font-normal text-[var(--foreground-tertiary)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export { Input, Textarea, Select };
