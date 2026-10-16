'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './cn';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** The X in the top-right corner of dialogs and sheets, an icon button: 40px, 44px under a finger. */
const DialogCloseButton = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Close
    ref={ref}
    aria-label="Close"
    className={cn(
      'absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-button text-text-2 transition-[color,background-color] hover:bg-muted hover:text-text [@media(pointer:coarse)]:size-11',
      className,
    )}
    {...props}
  >
    <X className="size-5" strokeWidth={1.75} aria-hidden />
  </DialogPrimitive.Close>
));
DialogCloseButton.displayName = 'DialogCloseButton';

/**
 * Radix hands focus back only to a DialogTrigger. Most dialogs here open from state, so
 * remember whatever had focus on open and return to it on close.
 */
function useReturnFocus(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void,
) {
  const opener = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus(event: Event) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event);
      const el = opener.current;
      if (event.defaultPrevented || !el?.isConnected || el === document.body) return;
      event.preventDefault();
      el.focus();
    },
  };
}

/**
 * Pressing a toast on the page's toaster (its Undo, say) is not a click outside: the modal
 * stays open. The toaster is clickable over the scrim (pointer-events-auto).
 */
function keepOpenForToasts(event: { target: EventTarget | null; preventDefault(): void }) {
  if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) event.preventDefault();
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Drop the X, e.g. when the footer has Cancel or a request is in flight. */
    hideClose?: boolean;
  }
>(({ className, children, hideClose = false, onOpenAutoFocus, onCloseAutoFocus, onPointerDownOutside, ...props }, ref) => {
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // 24px radius and the float shadow (D2). dialog-in moves with the translate and scale
          // properties, so it composes with the centring transform.
          'fixed left-1/2 top-[10dvh] z-50 grid max-h-[80dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 gap-5 overflow-y-auto rounded-canvas border border-border bg-canvas p-6 text-text shadow-float outline-none data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
          className,
        )}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          keepOpenForToasts(event);
        }}
        {...returnFocus}
        {...props}
      >
        {children}
        {hideClose ? null : <DialogCloseButton />}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-1.5', className)} {...props} />;
}

/** Required in every dialog: Radix names the dialog from it. */
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('m-0 pr-10 text-section font-semibold text-text', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('m-0 text-body text-text-2', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

/** Actions, primary last. Stacked full width on phones with the primary on top. */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export {
  keepOpenForToasts,
  useReturnFocus,
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};
