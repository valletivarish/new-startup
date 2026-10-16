'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';
import { DialogCloseButton, DialogOverlay, keepOpenForToasts, useReturnFocus } from './dialog';
import { SHEET_TOASTER, Toaster } from './toaster';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetPortal = DialogPrimitive.Portal;
const SheetOverlay = DialogOverlay;

// Lets every SheetClose inside a blocked sheet refuse to close it, not only the X.
const BlockCloseContext = React.createContext<((event: { preventDefault(): void }) => void) | null>(null);

const SheetClose = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ onClick, ...props }, ref) => {
  const block = React.useContext(BlockCloseContext);
  return (
    <DialogPrimitive.Close
      ref={ref}
      onClick={(event) => {
        onClick?.(event);
        block?.(event);
      }}
      {...props}
    />
  );
});
SheetClose.displayName = DialogPrimitive.Close.displayName;

// A panel on the canvas: white, the float shadow, and a 24px radius on its open edge only.
const sheetVariants = cva('fixed z-50 flex flex-col border-border bg-canvas text-text shadow-float outline-none', {
  variants: {
    side: {
      // 560px from tablet up, the whole screen on phones.
      right:
        'inset-y-0 right-0 h-dvh w-full md:w-[35rem] md:rounded-l-canvas md:border-l data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
      left: 'inset-y-0 left-0 h-dvh w-full md:w-[35rem] md:rounded-r-canvas md:border-r data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left',
      bottom:
        'inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-canvas border-t data-[state=closed]:animate-slide-out-down data-[state=open]:animate-slide-in-up',
    },
  },
  defaultVariants: { side: 'right' },
});

// The sheet's own toasts land beside it, never over its footer (the decision bar).
const TOAST_POSITION = { right: 'bottom-left', left: 'bottom-right', bottom: 'top-center' } as const;

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  hideClose?: boolean;
  /**
   * Set while a request this sheet owns is in flight. Escape, outside clicks, the X and any
   * SheetClose stop closing the sheet, and a note under the X says why when someone tries.
   */
  closeBlockedReason?: string;
}

/**
 * Needs a SheetTitle inside (Radix names the sheet from it). Focus returns to whatever opened it.
 * Mounts a toaster inside the sheet's focus trap: raise a decision's toast with
 * toastUndo(message, onUndo, { toasterId: SHEET_TOASTER }) so Undo is reachable by keyboard.
 */
const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      side = 'right',
      className,
      children,
      hideClose = false,
      closeBlockedReason,
      onEscapeKeyDown,
      onPointerDownOutside,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
    const blocked = Boolean(closeBlockedReason);
    const [tried, setTried] = React.useState(false);
    const reasonId = React.useId();
    React.useEffect(() => {
      if (!blocked) setTried(false);
    }, [blocked]);

    function stop(event: { preventDefault(): void }) {
      if (!blocked) return;
      event.preventDefault();
      setTried(true);
    }

    return (
      <SheetPortal>
        <SheetOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(sheetVariants({ side }), className)}
          onEscapeKeyDown={(event) => {
            onEscapeKeyDown?.(event);
            stop(event);
          }}
          onPointerDownOutside={(event) => {
            onPointerDownOutside?.(event);
            keepOpenForToasts(event);
            // A press on a toast is not an attempt to close, so it shows no blocked reason.
            if (!event.defaultPrevented) stop(event);
          }}
          {...returnFocus}
          {...props}
        >
          <BlockCloseContext.Provider value={stop}>{children}</BlockCloseContext.Provider>
          {hideClose ? null : (
            <DialogCloseButton
              aria-disabled={blocked || undefined}
              aria-describedby={blocked && tried ? reasonId : undefined}
              onClick={stop}
              className={blocked ? 'cursor-not-allowed text-text-3 hover:bg-transparent hover:text-text-3' : undefined}
            />
          )}
          {/* Always mounted, so screen readers announce the reason when it fills in. Drawn like a
              tooltip under the X it explains. */}
          <p
            id={reasonId}
            role="status"
            className={cn(
              'm-0',
              blocked && tried
                ? 'absolute right-4 top-16 z-10 max-w-[16rem] rounded-input bg-primary px-3 py-2 text-meta font-medium text-primary-foreground shadow-float'
                : 'sr-only',
            )}
          >
            {blocked && tried ? closeBlockedReason : null}
          </p>
          <Toaster id={SHEET_TOASTER} position={TOAST_POSITION[side ?? 'right']} />
        </DialogPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = DialogPrimitive.Content.displayName;

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border px-4 py-4 pr-16 sm:px-6 sm:py-5 sm:pr-16', className)}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-6 sm:py-4',
        className,
      )}
      {...props}
    />
  );
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('m-0 text-section font-semibold text-text', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('m-0 text-label text-text-2', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
