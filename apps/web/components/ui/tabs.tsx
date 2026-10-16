'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

/**
 * The tab row: scrolls sideways on a phone and fades at the edge that has more (scroll-fade-x).
 * The hairline is an inset shadow: it spans the visible width and isn't clipped by the scroller.
 */
export const TAB_LIST =
  'scroll-fade-x flex max-w-full gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]';

/**
 * A page-level row: pulled out by the tabs' 12px padding so the first label lines up with the h1
 * above it, the hairline drawn at the content's width.
 */
export const TAB_LIST_FLUSH =
  '-mx-3 max-w-none shadow-none bg-[linear-gradient(var(--border),var(--border))] bg-[length:calc(100%-1.5rem)_1px] bg-[position:50%_100%] bg-no-repeat';

/**
 * One tab, a TabsTrigger or a link to a page section (pass data-state="active" on the current
 * one, with aria-current="page"). Active: text-text and a 2px primary bar under the label, so the
 * state is never colour alone. The bar is a border, so forced colours keep it, and it grows in on
 * change. One weight for every tab, so the row never shifts. The focus ring sits inside: the row
 * scrolls and clips.
 */
export const TAB_TRIGGER = cn(
  'relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-input px-3 text-label font-medium text-text-3 no-underline transition-colors hover:text-text focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:text-border-input disabled:hover:text-border-input data-[state=active]:text-text [&_svg]:size-4 [&_svg]:shrink-0',
  'after:absolute after:inset-x-3 after:bottom-0 after:border-b-2 after:border-primary after:opacity-0 after:transition-[opacity,scale] after:duration-base after:ease-out after:[scale:0.5_1] data-[state=active]:after:opacity-100 data-[state=active]:after:[scale:1]',
);

/** Underline tabs for page sections, with real tabpanels. For filters use Segmented, never tabs. */
const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /** A page's own tab row: the first label lines up with the h1 (TAB_LIST_FLUSH). */
    flush?: boolean;
  }
>(({ className, flush = false, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn(TAB_LIST, flush && TAB_LIST_FLUSH, className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn(TAB_TRIGGER, className)} {...props} />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('pt-5', className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
