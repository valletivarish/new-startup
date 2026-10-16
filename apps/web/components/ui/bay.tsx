'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { RowLayoutContext } from './strip';

/** A board column: subtle fill, 24px radius, 8px in, so the 16px cards inside sit concentric. */
export const BOARD_COLUMN = 'flex min-w-0 flex-col rounded-canvas bg-subtle p-2';

export interface BoardColumnProps {
  /** Column title, such as "Ready for review". */
  title: ReactNode;
  /** The true total, counted before any slicing. Leave out while unknown: missing is never shown as 0. */
  count?: number;
  /** Lets people fold the column away under its title. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Cards not shown yet. Above 0 it adds a "Show N more" footer. */
  moreCount?: number;
  /** Footer shows more in place. */
  onShowMore?: () => void;
  /** Footer goes to the full list instead. */
  moreHref?: string;
  headingLevel?: 2 | 3;
  className?: string;
  /** Cards: ListRow (or a ListRows of them), each drawn as a white 16px card here. */
  children?: ReactNode;
}

const MORE =
  'flex min-h-11 w-full items-center justify-center rounded-card-sm border border-dashed border-border text-label font-medium text-text-2 transition duration-fast hover:bg-canvas hover:text-text';

/** Title and count pill over white cards, on a subtle column. */
export function BoardColumn({
  title,
  count,
  collapsible = false,
  defaultCollapsed = false,
  moreCount = 0,
  onShowMore,
  moreHref,
  headingLevel = 2,
  className,
  children,
}: BoardColumnProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const Heading = headingLevel === 3 ? 'h3' : 'h2';

  // A count fades in again when it changes, never rolls. Not on mount, and not when the
  // count first arrives: the key remounts the number so the entrance replays.
  const [lastCount, setLastCount] = useState(count);
  const [changes, setChanges] = useState(0);
  if (count !== lastCount) {
    setLastCount(count);
    if (lastCount !== undefined && count !== undefined) setChanges((n) => n + 1);
  }

  const label = (
    <>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {count === undefined ? null : (
        <span
          key={changes}
          className={cn(
            'rounded-pill border border-border bg-canvas px-2 text-caption font-medium tabular-nums text-text-2',
            changes > 0 && 'motion-safe:animate-fade-in',
          )}
        >
          {count}
        </span>
      )}
    </>
  );
  const more = `Show ${moreCount} more`;

  return (
    <section aria-labelledby={titleId} className={cn(BOARD_COLUMN, className)}>
      <Heading id={titleId} className="m-0 text-body font-semibold text-text">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => setCollapsed((c) => !c)}
            className="flex min-h-11 w-full items-center gap-2 rounded-card-sm px-3 text-left transition duration-fast hover:bg-muted"
          >
            <ChevronDown
              aria-hidden
              strokeWidth={1.5}
              className={cn('size-4 shrink-0 text-text-3 transition-transform duration-fast', collapsed && '-rotate-90')}
            />
            {label}
          </button>
        ) : (
          <span className="flex min-h-11 items-center gap-2 px-3">{label}</span>
        )}
      </Heading>
      {/* A class, not the hidden attribute: Tailwind's display utilities beat [hidden]. */}
      <div id={bodyId} className={cn('flex-1 flex-col gap-2', collapsed ? 'hidden' : 'flex')}>
        <RowLayoutContext.Provider value="board">{children}</RowLayoutContext.Provider>
        {moreCount > 0 && moreHref ? (
          <Link href={moreHref} aria-describedby={titleId} className={MORE}>
            {more}
          </Link>
        ) : moreCount > 0 && onShowMore ? (
          <button type="button" onClick={onShowMore} aria-describedby={titleId} className={MORE}>
            {more}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Columns side by side from lg, stacked sections below. */
export function Board({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid gap-4 lg:auto-cols-[minmax(0,1fr)] lg:grid-flow-col', className)}>
      {children}
    </div>
  );
}

// Strip Board names, still imported by pages awaiting rebuild.
export { BoardColumn as Bay, Board as BayBoard };
export type { BoardColumnProps as BayProps };
