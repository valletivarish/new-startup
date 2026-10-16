'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';

const MOBILE = '(max-width: 767px)';
function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia(MOBILE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const icon = 'size-4';
// A white 16px card with a hairline and the float shadow (D2). The kind shows as an icon in its
// status colour beside the words, never colour alone. Buttons follow Button's sm secondary and
// tertiary looks.
const action =
  'inline-flex h-9 shrink-0 items-center rounded-button px-3 font-medium transition-colors [@media(pointer:coarse)]:h-11';
const classNames = {
  toast:
    'flex w-full items-start gap-3 rounded-card-sm border border-border bg-canvas py-3 pl-4 pr-12 font-sans text-label text-text shadow-float',
  icon: 'relative mt-0.5 flex size-4 shrink-0 items-center justify-center',
  content: 'flex min-w-0 flex-1 flex-col gap-0.5',
  title: 'font-semibold',
  description: 'text-meta text-text-2',
  actionButton: `${action} border border-border bg-canvas text-text hover:bg-subtle`,
  cancelButton: `${action} text-text-2 hover:bg-muted hover:text-text`,
  closeButton:
    'absolute right-0.5 top-0.5 grid size-11 place-items-center rounded-button text-text-2 transition-colors hover:bg-muted hover:text-text',
};

const icons = {
  success: <CircleCheck className={`${icon} text-status-success-text`} strokeWidth={1.75} aria-hidden />,
  error: <CircleX className={`${icon} text-status-danger-text`} strokeWidth={1.75} aria-hidden />,
  warning: <TriangleAlert className={`${icon} text-status-warning-text`} strokeWidth={1.75} aria-hidden />,
  info: <Info className={`${icon} text-status-info-text`} strokeWidth={1.75} aria-hidden />,
  close: <X className={icon} strokeWidth={1.75} aria-hidden />,
};

/** The toaster every SheetContent mounts. Raise a toast there to keep it inside the sheet's focus trap. */
export const SHEET_TOASTER = 'sheet';

export interface ToasterSlotProps {
  /** Leave out for the app's toaster. Toasts reach it with toast(message, { toasterId: id }). */
  id?: string;
  /** Where toasts stack from md up. Phones stack them top centre. */
  position?: ToasterProps['position'];
}

/** Sonner, restyled (spec 3). AppProviders mounts the app's; every Sheet mounts its own. */
export function Toaster({ id, position = 'bottom-right' }: ToasterSlotProps) {
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE).matches, () => false);
  return (
    <Sonner
      id={id}
      position={mobile ? 'top-center' : position}
      theme="light"
      closeButton
      // Clickable even while an open modal has set pointer-events: none on the body.
      className="pointer-events-auto"
      icons={icons}
      toastOptions={{ unstyled: true, closeButtonAriaLabel: 'Dismiss', classNames }}
    />
  );
}

/**
 * A decision's toast with Undo: 8 seconds, no countdown (spec 12a.9). For a decision made in a
 * Sheet, pass { toasterId: SHEET_TOASTER }: the page's toaster sits outside the sheet's focus
 * trap, where a keyboard can't reach Undo.
 */
export function toastUndo(
  message: ReactNode,
  onUndo: () => void,
  options: { description?: ReactNode; toasterId?: string; id?: string | number } = {},
) {
  return toast.success(message, { ...options, duration: 8000, action: { label: 'Undo', onClick: onUndo } });
}
