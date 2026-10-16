'use client';

import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/** danger removes or ends something; real-world reaches outside the app (a phone call, an email). */
export type ConfirmTone = 'danger' | 'real-world';

interface ConfirmBase {
  confirmLabel: string;
  cancelLabel?: string;
  tone: ConfirmTone;
  /** The confirmed request is in flight: confirm shows progress and nothing closes. */
  busy?: boolean;
  /** Why the request failed, shown in place. */
  error?: React.ReactNode;
  onConfirm: () => void;
}

function ConfirmError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="m-0 flex basis-full items-start gap-1.5 text-meta text-status-danger-text">
      <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {children}
    </p>
  );
}

export interface ConfirmDialogProps extends ConfirmBase {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question: "Call Priya now?" */
  title: string;
  /** Plain consequence, inline text: "This places a real phone call to +91 98•••• 4410." */
  body: React.ReactNode;
  /**
   * Runs as the dialog closes, before focus goes back to whatever opened it. preventDefault and
   * focus something else when the opener is about to go (End call, once the call has ended).
   */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Modal confirmation. Focus starts on Cancel; Escape and outside clicks cancel unless busy. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone,
  busy = false,
  error,
  onConfirm,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        role="alertdialog"
        hideClose
        onCloseAutoFocus={onCloseAutoFocus}
        className="w-[min(28rem,calc(100vw-2rem))]"
      >
        <DialogHeader>
          <DialogTitle className="pr-0">{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {error ? <ConfirmError>{error}</ConfirmError> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmInlineProps extends ConfirmBase {
  /** The question, e.g. "Revoke this invite?" */
  message: React.ReactNode;
  onCancel: () => void;
  className?: string;
}

/**
 * Confirmation inside a row, for actions that don't need a modal. Takes focus on Cancel
 * when it appears, Escape cancels, and focus goes back to the trigger when it closes
 * (give the trigger an id if this row replaces it).
 */
export function ConfirmInline({
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone,
  busy = false,
  error,
  onConfirm,
  onCancel,
  className,
}: ConfirmInlineProps) {
  const messageId = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  // Read during render: by the time effects run, a trigger swapped out for this row is gone.
  const [trigger] = React.useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  React.useEffect(() => {
    cancelRef.current?.focus();
    return () => {
      // A swapped-out trigger comes back as a new element with the same id.
      const target = trigger?.isConnected ? trigger : trigger?.id ? document.getElementById(trigger.id) : null;
      target?.focus();
    };
  }, [trigger]);

  // Escape cancels this row only. Inside a Sheet or Dialog, Radix closes the whole modal on an
  // Escape it hears on document in the capture phase, before React's onKeyDown would run, so
  // catch it on window first. While busy, Escape does nothing at all.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.current?.contains(event.target as Node)) return;
      event.stopPropagation();
      if (!busy) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  return (
    <div
      ref={root}
      role="alertdialog"
      aria-labelledby={messageId}
      className={cn(
        // A small raised card in the row, so the question stands apart from the row it replaces.
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card-sm border border-border bg-canvas py-2 pl-4 pr-2 shadow-card',
        className,
      )}
    >
      <p id={messageId} className="m-0 min-w-0 flex-1 text-label font-medium text-text">
        {message}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button ref={cancelRef} type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={tone === 'danger' ? 'destructive' : 'primary'}
          size="sm"
          loading={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
      {error ? <ConfirmError>{error}</ConfirmError> : null}
    </div>
  );
}
