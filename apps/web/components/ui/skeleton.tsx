'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';
import { BOARD_COLUMN, Board } from './bay';
import { ListCell, ListRow, ListRowPrimary, ListRows, RowLayoutContext } from './strip';

/*
  Placeholders that mirror the final geometry: list cards, board columns, the page header.
  Muted blocks with a gentle opacity pulse, only when motion is allowed: no gradient shimmer.
  They appear 300ms into a load and, through useHeldLoading, stay at least 500ms once shown.
*/

const SHOW_AFTER_MS = 300;
const HOLD_MS = 500;
const STILL_LOADING_AFTER_MS = 8000;

/** How much longer placeholders must stay when a load ends `elapsed` ms after it began: none if they never showed. */
export function skeletonHoldMs(elapsed: number) {
  const shown = elapsed - SHOW_AFTER_MS;
  return shown <= 0 ? 0 : Math.max(0, HOLD_MS - shown);
}

/**
 * Loading, held so placeholders never flash: true while `loading`, and after it ends for as
 * long as the placeholders still owe their 500ms. A load done before 300ms swaps straight in.
 *   const showSkeleton = useHeldLoading(query.isPending);
 *   return showSkeleton ? <SkeletonRows /> : <Rows ... />;
 */
export function useHeldLoading(loading: boolean) {
  const [held, setHeld] = useState(loading);
  const startedAt = useRef(0);
  useEffect(() => {
    if (loading) {
      startedAt.current = Date.now();
      setHeld(true);
      return;
    }
    const wait = skeletonHoldMs(Date.now() - startedAt.current);
    if (wait === 0) {
      setHeld(false);
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), wait);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return loading || held;
}

/** A placeholder block on muted. Size it with className; pass rounded-pill for a circle. */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-input bg-muted motion-safe:animate-pulse', className)} {...props} />;
}

/** Inline bar that sits in a line box, so a placeholder line is as tall as the text it stands for. Pass its radius. */
function Bar({ className }: { className?: string }) {
  return <span className={cn('inline-block bg-muted align-middle motion-safe:animate-pulse', className)} />;
}

/**
 * The busy container for any page's own placeholders. They fade in after 300ms, so quick loads
 * never show them, and they are hidden from screen readers, which hear the status line instead.
 * After 8s it says "Still loading…", politely.
 */
function SkeletonGroup({ className, children }: { className?: string; children: ReactNode }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), STILL_LOADING_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={className}>
      <div
        aria-busy="true"
        aria-hidden
        className="animate-[fade-in_var(--dur-base)_var(--ease-out)_300ms_both]"
      >
        {children}
      </div>
      <p role="status" className={slow ? 'mt-3 text-meta text-text-3' : 'sr-only'}>
        {slow ? 'Still loading…' : 'Loading'}
      </p>
    </div>
  );
}

const NAME_WIDTHS = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5'];

/** A ListRow drawn in bars: avatar, name and meta lines, badge. Same boxes as the real row. */
function RowPlaceholder({ index, checkbox = false }: { index: number; checkbox?: boolean }) {
  return (
    <ListRow
      checkbox={
        checkbox ? (
          <span className="flex size-11 items-center justify-center">
            <Bar className="size-5 rounded-xs" />
          </span>
        ) : undefined
      }
    >
      <ListRowPrimary
        avatar={<Bar className="size-8 shrink-0 rounded-pill" />}
        title={<Bar className={cn('h-2.5 rounded-pill', NAME_WIDTHS[index % NAME_WIDTHS.length])} />}
        meta={<Bar className="h-2 w-1/4 rounded-pill" />}
      />
      <ListCell kind="tag">
        <Bar className="h-6 w-24 rounded-xs" />
      </ListCell>
    </ListRow>
  );
}

function rowsCard(rows: number, checkbox?: boolean) {
  return (
    <ListRows header={<Bar className="h-2 w-20 rounded-pill" />}>
      {Array.from({ length: rows }, (_, i) => (
        <RowPlaceholder key={i} index={i} checkbox={checkbox} />
      ))}
    </ListRows>
  );
}

function ColumnPlaceholder({ rows }: { rows: number }) {
  return (
    <div className={BOARD_COLUMN}>
      <div className="flex min-h-11 items-center px-3">
        {/* Border grey, not muted: muted barely shows on the column's subtle fill. */}
        <Bar className="h-3 w-1/3 rounded-pill bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        <RowLayoutContext.Provider value="board">
          {Array.from({ length: rows }, (_, i) => (
            <RowPlaceholder key={i} index={i} />
          ))}
        </RowLayoutContext.Provider>
      </div>
    </div>
  );
}

/** A list card of row placeholders. */
function SkeletonRows({
  rows = 5,
  checkbox = false,
  className,
}: {
  rows?: number;
  /** Mirror rows that lead with a Checkbox. */
  checkbox?: boolean;
  className?: string;
}) {
  return <SkeletonGroup className={className}>{rowsCard(rows, checkbox)}</SkeletonGroup>;
}

/** One board column: title and cards. */
function SkeletonBay({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <SkeletonGroup className={className}>
      <ColumnPlaceholder rows={rows} />
    </SkeletonGroup>
  );
}

/** A board of columns, with one loading message for the whole board. */
function SkeletonBoard({
  bays = 3,
  rows = 3,
  className,
}: {
  /** Columns. */
  bays?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <SkeletonGroup className={className}>
      <Board>
        {Array.from({ length: bays }, (_, i) => (
          <ColumnPlaceholder key={i} rows={rows} />
        ))}
      </Board>
    </SkeletonGroup>
  );
}

/** Page header (as PageHeader draws it) and a list card. */
function SkeletonPage({ rows = 5, withAction = true }: { rows?: number; withAction?: boolean }) {
  return (
    <SkeletonGroup>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <span className="block text-page">
            <Bar className="h-7 w-56 max-w-full rounded-pill" />
          </span>
          <span className="mt-2 block">
            <Bar className="h-3 w-80 max-w-full rounded-pill" />
          </span>
        </div>
        {withAction ? <Bar className="h-10 w-36 shrink-0 rounded-button" /> : null}
      </div>
      {rowsCard(rows)}
    </SkeletonGroup>
  );
}

/**
 * A record page's header as JobHeader or PageHeader draws it (the trail on phones, title and tag,
 * a line, the tab row when it has tabs), then a list card or the page's own body: nothing jumps
 * when it loads.
 */
function SkeletonRecord({ tabs = 2, rows = 5, children }: { tabs?: number; rows?: number; children?: ReactNode }) {
  return (
    <SkeletonGroup>
      <div className={tabs > 0 ? 'mb-6' : 'mb-8'}>
        <span className="mb-3 block md:hidden">
          <Bar className="h-3 w-40 rounded-pill" />
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-page">
            <Bar className="h-7 w-64 max-w-full rounded-pill" />
          </span>
          <Bar className="h-6 w-28 rounded-xs" />
        </div>
        <span className="mt-1.5 block">
          <Bar className="h-3 w-96 max-w-full rounded-pill" />
        </span>
        {tabs > 0 ? (
          <div className="mt-5 flex h-11 items-center gap-6 shadow-[inset_0_-1px_0_var(--border)]">
            {Array.from({ length: tabs }, (_, i) => (
              <Bar key={i} className={cn('h-3 rounded-pill', i === 0 ? 'w-20' : 'w-12')} />
            ))}
          </div>
        ) : null}
      </div>
      {children ?? rowsCard(rows)}
    </SkeletonGroup>
  );
}

/** A white 20px card of text lines. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <SkeletonGroup className={className}>
      <div className="space-y-3 rounded-card border border-border bg-canvas p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </SkeletonGroup>
  );
}

function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn('h-3 w-full max-w-[12rem]', className)} />;
}

function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn('size-8 rounded-pill', className)} />;
}

export {
  Skeleton,
  SkeletonGroup,
  SkeletonRecord,
  SkeletonRows,
  SkeletonBay,
  SkeletonBoard,
  SkeletonPage,
  SkeletonCard,
  SkeletonText,
  SkeletonAvatar,
  // Earlier names for the list card, kept so pages awaiting rebuild compile.
  SkeletonRows as SkeletonStrips,
  SkeletonRows as SkeletonTable,
  SkeletonRows as SkeletonList,
};
