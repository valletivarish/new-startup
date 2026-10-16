'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command as CommandPrimitive, useCommandState } from 'cmdk';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from './cn';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle, useReturnFocus } from './dialog';

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn('flex h-full w-full flex-col overflow-hidden bg-canvas text-text', className)}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

export interface CommandDialogProps extends DialogPrimitive.DialogProps {
  /** Names the dialog and the search box for screen readers. */
  title?: string;
  /** Pass false when results come from the server already filtered. */
  shouldFilter?: boolean;
}

/**
 * White, 20px radius, the float shadow. Opened from a shortcut many times a day, so it appears
 * and leaves at once: no fade, no scale. Focus goes back to whatever had it.
 */
function CommandDialog({
  title = 'Search jobs and candidates',
  shouldFilter,
  children,
  ...props
}: CommandDialogProps) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog {...props}>
      <DialogPortal>
        <DialogOverlay className="data-[state=closed]:animate-none data-[state=open]:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12dvh] z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-card border border-border bg-canvas shadow-float outline-none"
          {...returnFocus}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <Command label={title} shouldFilter={shouldFilter}>
            {children}
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  // The row shows focus: its hairline turns into a 2px accent rule while the field has focus.
  <div
    className="flex items-center gap-3 border-b border-border px-5 transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[inset_0_-1px_0_var(--accent)]"
    cmdk-input-wrapper=""
  >
    <Search className="size-[1.125rem] shrink-0 text-text-3" strokeWidth={1.75} aria-hidden />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        // shadow-none: the global focus gap would paint white over the row's accent rule.
        'h-14 w-full bg-transparent text-md text-text outline-none placeholder:text-text-3 focus-visible:shadow-none focus-visible:outline-none disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      'max-h-[min(26rem,60dvh)] scroll-py-2 overflow-y-auto overflow-x-hidden overscroll-contain p-2',
      className,
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn('px-3 py-10 text-center text-label text-text-3', className)}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

/** Row shown while server results load, so "no results" never shows early. Spinner and words. */
const CommandLoading = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Loading>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Loading>
>(({ className, children, ...props }, ref) => (
  <CommandPrimitive.Loading
    ref={ref}
    className={cn('px-3 py-3 text-label text-text-3', className)}
    {...props}
  >
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-4 shrink-0 rounded-pill border-2 border-current border-r-transparent motion-safe:animate-spin"
      />
      {children}
    </span>
  </CommandPrimitive.Loading>
));
CommandLoading.displayName = CommandPrimitive.Loading.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'pb-1 text-text [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-3',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

/**
 * Hairline between groups, hidden while searching like cmdk's own. Drawn here rather than with
 * cmdk's, whose role="separator" a listbox may not hold (axe aria-required-children): this one is
 * aria-hidden, since the group names already divide the list for screen readers.
 */
const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, alwaysRender, ...props }, ref) => {
  const searching = useCommandState((state) => Boolean(state.search));
  if (searching && !alwaysRender) return null;
  return (
    <div
      ref={ref}
      aria-hidden
      cmdk-separator=""
      className={cn('-mx-2 my-1.5 h-px bg-border', className)}
      {...props}
    />
  );
});
CommandSeparator.displayName = 'CommandSeparator';

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      // Selected row: a muted fill plus a return-key glyph at the end, so it isn't colour alone and
      // survives forced colours. No outline-none: cmdk items never take focus, and Tailwind's
      // transparent outline-none shows as a ring on every row in forced colours.
      'group/item relative flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-input px-3 text-body text-text data-[disabled=true]:pointer-events-none data-[selected=true]:bg-muted data-[disabled=true]:text-text-3 [&_svg]:size-4 [&_svg]:shrink-0',
      className,
    )}
    {...props}
  >
    {children}
    <CornerDownLeft
      aria-hidden
      strokeWidth={1.75}
      className="ml-auto hidden text-text-3 group-data-[selected=true]/item:block"
    />
  </CommandPrimitive.Item>
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandLoading,
  CommandGroup,
  CommandItem,
  CommandSeparator,
};
