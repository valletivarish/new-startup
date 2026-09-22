import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-[var(--background-tertiary)]',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-skeleton-shimmer',
        'after:bg-gradient-to-r after:from-transparent after:via-[color-mix(in_srgb,var(--surface)_55%,transparent)] after:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn('h-3 w-full max-w-[12rem]', className)} />;
}

function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn('h-10 w-10 rounded-full', className)} />;
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)] p-4',
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)] p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Avatar + lines — people-style lists. */
function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="divide-y divide-[var(--separator-subtle)] overflow-hidden rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)]"
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <SkeletonAvatar />
          <div className="flex-1 space-y-2">
            <SkeletonText />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Jobs / Agents style rows — title, meta, status pill.
 * Matches the real list so loading does not look like a blank stall.
 */
function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)]"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--separator-subtle)] px-5 py-2.5">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-12" />
      </div>
      <div className="divide-y divide-[var(--separator-subtle)]">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton
                className="h-3.5"
                style={{ width: `${52 + ((i * 17) % 28)}%` }}
              />
              <Skeleton
                className="h-2.5"
                style={{ width: `${42 + ((i * 13) % 22)}%` }}
              />
            </div>
            <Skeleton className="h-5 w-14 shrink-0 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Header + list — first paint while profile/data load. */
function SkeletonPage({
  rows = 5,
  withAction = true,
}: {
  rows?: number;
  withAction?: boolean;
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        {withAction ? (
          <Skeleton className="h-9 w-28 shrink-0 rounded-md" />
        ) : null}
      </div>
      <SkeletonRows rows={rows} />
    </div>
  );
}

export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
  SkeletonList,
  SkeletonRows,
  SkeletonPage,
};
