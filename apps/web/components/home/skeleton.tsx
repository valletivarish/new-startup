'use client';

import { cn } from '@/components/ui/cn';

/*
  Placeholders in Home's own geometry, so nothing jumps when the numbers land. Wrap them in
  SkeletonGroup (components/ui/skeleton): they fade in after 300ms (quick loads never show
  them), screen readers hear "Loading" instead, and "Still loading…" after 8 seconds.
*/

const BLOCK = 'block bg-muted motion-safe:animate-pulse';

function Bar({ className }: { className?: string }) {
  return <span className={cn(BLOCK, 'rounded-pill', className)} />;
}

/** The greeting, its line and the Create job pill, as PageHeader draws them. */
export function HomeHeaderSkeleton() {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <span className="flex h-[2.125rem] items-center">
          <Bar className="h-7 w-64 max-w-full" />
        </span>
        <span className="mt-2 flex h-5 items-center">
          <Bar className="h-3 w-96 max-w-full" />
        </span>
      </div>
      <Bar className="h-10 w-32 shrink-0" />
    </div>
  );
}

const CARD = 'rounded-card border border-border bg-canvas';

/** Hero and the card beside it, three stat cards, the not-called list. */
export function HomeBodySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-12">
        <span className={cn(BLOCK, 'h-[17.5rem] rounded-canvas xl:col-span-5')} />
        <div className={cn(CARD, 'xl:col-span-7')}>
          <div className="flex h-[4.25rem] items-center px-5 pt-3">
            <Bar className="h-4 w-56" />
          </div>
          <div className="mt-2 divide-y divide-border border-t border-border">
            {['w-2/5', 'w-1/3', 'w-1/2'].map((width) => (
              <div key={width} className="flex min-h-14 items-center gap-3 px-5">
                <Bar className="size-8 shrink-0" />
                <span className="min-w-0 flex-1 space-y-2">
                  <Bar className={cn('h-2.5', width)} />
                  <Bar className="h-2 w-1/4" />
                </span>
                <Bar className="hidden h-6 w-24 sm:block" />
                <Bar className="h-9 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn(CARD, 'flex min-h-[5.75rem] items-center gap-4 p-3 sm:p-4')}>
            <span className={cn(BLOCK, 'size-12 shrink-0 rounded-card-sm max-xl:hidden')} />
            <span className="flex-1 space-y-2.5">
              <Bar className="h-2.5 w-1/2" />
              <Bar className="h-5 w-10" />
            </span>
          </div>
        ))}
      </div>
      <div className={cn(CARD, 'px-5 pb-5')}>
        <div className="flex h-[4.25rem] items-center pt-3">
          <Bar className="h-4 w-40" />
        </div>
        <Bar className="mt-3 h-3 w-48" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn(BLOCK, 'h-16 rounded-card-sm')} />
          ))}
        </div>
      </div>
    </div>
  );
}
