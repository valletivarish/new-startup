'use client';

import {
  Children,
  createContext,
  useContext,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { cn } from './cn';
import type { StateFamily } from '../../lib/status-labels';

/*
  D2 table rows: [checkbox], [avatar] name and meta line, cells, StatusBadge, actions.
  In ListRows the rows sit in a white 20px card under a subtle header row, 56px tall, divided
  by hairlines: hover subtle, checked subtle, open (selected) accent-soft with a 3px accent
  bar. On its own, or in a board column, a row is a white 16px card instead.
  The title opens the row through an overlay stretched over all of it; every other control
  in the row sits above that overlay ([data-strip] in globals.css).
*/

/** Where a row sits: in a ListRows or DataList card, in a board column, or on its own. */
export type RowLayout = 'rows' | 'board' | 'alone';
/** Set by ListRows, DataList and BoardColumn; rows read it to draw themselves. */
export const RowLayoutContext = createContext<RowLayout>('alone');

const RowContext = createContext({ selected: false });
// Inside a ListRows with columns: from md the row lays its cells on the list's tracks.
const ColumnsContext = createContext(false);

/** The subtle header row of a list card: 12px/500 text-3 column labels. */
export const LIST_HEADER =
  'flex min-h-10 items-center gap-x-4 border-b border-border bg-subtle px-4 text-caption font-medium text-text-3';

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  /** @deprecated Strip Board holder colour. Accepted, not drawn: the row's StatusBadge carries the state. */
  family?: StateFamily;
  /** @deprecated Strip Board hatched holder. Accepted, not drawn. */
  holder?: 'hatched';
  /** The open one, say in a sheet: accent-soft fill and a 3px accent bar. Sets aria-current on its title. */
  selected?: boolean;
  /** Leading cell, usually <Checkbox aria-label="Select Priya Sharma" />. A checked box tints the row. */
  checkbox?: ReactNode;
  /**
   * Default true: below md the cells reflow to two lines (the name first; badges, meta and
   * actions second); from md one row. To line cells up as columns across rows, render the
   * rows in a ListRows with columns. false keeps one grid row at every width; pass grid-cols.
   * In a board column the card always keeps the name on its own first line.
   */
  reflow?: boolean;
}

const PAD: Record<RowLayout, string> = { rows: 'px-4 py-2', board: 'p-3', alone: 'px-4 py-3' };

export function ListRow({
  family: _family,
  holder: _holder,
  selected = false,
  checkbox,
  reflow = true,
  className,
  children,
  ...rest
}: ListRowProps) {
  const layout = useContext(RowLayoutContext);
  const columns = useContext(ColumnsContext) && layout === 'rows';
  const card = layout !== 'rows';
  return (
    <RowContext.Provider value={{ selected }}>
      <div
        {...rest}
        data-strip=""
        className={cn(
          // isolate keeps the controls lifted over the title's overlay inside this row's stacking.
          'relative isolate min-h-14 items-center gap-x-3 text-body text-text tabular-nums transition duration-fast md:gap-x-4',
          !reflow ? 'grid' : layout === 'board' ? 'flex flex-wrap' : 'flex flex-wrap md:flex-nowrap',
          PAD[layout],
          card && 'rounded-card-sm border border-border bg-canvas shadow-xs',
          columns && 'md:col-span-full md:grid md:grid-cols-subgrid',
          selected
            ? // A 3px bar inset from the edge, so a card's corner or the list's never clips it. A border, so it survives forced colours.
              'bg-accent-soft before:pointer-events-none before:absolute before:inset-y-3 before:left-1 before:w-[3px] before:rounded-pill before:border-l-[3px] before:border-accent'
            : cn(
                // Hover only on rows that open something.
                card ? 'has-[[data-strip-open]]:hover:shadow-card' : 'has-[[data-strip-open]]:hover:bg-subtle',
                'has-[[data-strip-check]_input:checked]:bg-subtle',
              ),
          className,
        )}
      >
        {checkbox ? (
          // Above the stretched title. -my-2 lets the 44px hit area overlap the padding.
          <div data-strip-check className="relative z-10 -my-2 flex shrink-0 items-center">
            {checkbox}
          </div>
        ) : null}
        {children}
        {/* Line break after the name, for the two-line layout: phones, and every board card. */}
        {reflow ? (
          <span aria-hidden className={cn('order-2 h-0 basis-full', layout !== 'board' && 'md:hidden')} />
        ) : null}
      </div>
    </RowContext.Provider>
  );
}

// The overlay (::after) makes the whole row the hit area; the focus ring (::before) is drawn
// inset with a 12px radius, so the list card's rounded corners never clip it. One arbitrary
// property: tailwind-merge 3 reads a bare `outline` as a width and drops it beside outline-2.
const OPENER =
  'after:absolute after:inset-0 before:pointer-events-none before:absolute before:inset-1 before:rounded-input focus-visible:shadow-none focus-visible:outline-none focus-visible:before:[outline:2px_solid_var(--focus-ring)]';

export interface ListRowTitleProps {
  /** Whole-row navigation: the title becomes a link stretched over the row. */
  href?: string;
  /** Whole-row action, such as opening a sheet: the title becomes a button stretched over the row. */
  onOpen?: () => void;
  className?: string;
  children: ReactNode;
}

/** The row's name. With href or onOpen it is the one control that opens the row. */
export function ListRowTitle({ href, onOpen, className, children }: ListRowTitleProps) {
  const { selected } = useContext(RowContext);
  const base = 'block max-w-full truncate text-left font-medium text-text';
  const current = selected ? 'true' : undefined;
  if (href) {
    return (
      <Link
        href={href}
        onClick={onOpen}
        data-strip-open
        aria-current={current}
        className={cn(base, OPENER, className)}
      >
        {children}
      </Link>
    );
  }
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-strip-open
        aria-current={current}
        className={cn(base, OPENER, className)}
      >
        {children}
      </button>
    );
  }
  return <span className={cn(base, className)}>{children}</span>;
}

export interface ListRowPrimaryProps extends Omit<ListRowTitleProps, 'children' | 'className'> {
  /** The name. */
  title: ReactNode;
  /** The secondary line, 13px text-3. */
  meta?: ReactNode;
  /** Leading avatar slot, usually <UserInitials name={person.name} /> (components/shared/user-initials). */
  avatar?: ReactNode;
  /** Let the secondary line wrap instead of cutting it off: when it is the row's description. */
  wrapMeta?: boolean;
  className?: string;
}

/** Primary cell: [avatar], name (14px, 500) and secondary line. Grows to fill the row. */
export function ListRowPrimary({
  title,
  meta,
  avatar,
  wrapMeta = false,
  href,
  onOpen,
  className,
}: ListRowPrimaryProps) {
  const board = useContext(RowLayoutContext) === 'board';
  return (
    <div
      className={cn(
        'order-1 flex min-w-0 flex-1 items-center gap-3',
        !board && 'md:order-none',
        className,
      )}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <ListRowTitle href={href} onOpen={onOpen}>
          {title}
        </ListRowTitle>
        {meta ? <span className={cn('mt-0.5 block text-meta text-text-3', !wrapMeta && 'truncate')}>{meta}</span> : null}
      </div>
    </div>
  );
}

// Phones: the name keeps the first line to itself (after the checkbox), badges, meta and
// actions share the second; one row from md.
const CELL = {
  meta: 'order-4 min-w-0 text-text-2 max-md:mt-2 md:order-none',
  tag: 'order-3 flex shrink-0 max-md:mt-2 md:order-none',
  // Above the stretched title so its controls stay clickable.
  actions: 'relative z-10 order-5 ml-auto flex shrink-0 items-center gap-1 max-md:mt-2 md:order-none',
} as const;

// Board cards: the phone layout at every width.
const BOARD_CELL: Record<keyof typeof CELL, string> = {
  meta: 'order-4 mt-2 min-w-0 text-text-2',
  tag: 'order-3 mt-2 flex shrink-0',
  actions: 'relative z-10 order-5 ml-auto mt-2 flex shrink-0 items-center gap-1',
};

export interface ListCellProps extends HTMLAttributes<HTMLDivElement> {
  /** meta (default): a column of detail. tag: holds the StatusBadge. actions: small ghost icon buttons and menus. */
  kind?: keyof typeof CELL;
}

export function ListCell({ kind = 'meta', className, ...rest }: ListCellProps) {
  const board = useContext(RowLayoutContext) === 'board';
  return <div {...rest} className={cn((board ? BOARD_CELL : CELL)[kind], className)} />;
}

export interface ListRowsProps extends HTMLAttributes<HTMLUListElement> {
  /**
   * From md, one grid-template-columns for every row in the list, so cells line up as table
   * columns without fixed widths: "auto minmax(0,1fr) auto auto" names the tracks in cell
   * order, the checkbox first when the rows have one. Every child must be a ListRow.
   * Below md the rows keep their two-line phone layout.
   */
  columns?: string;
  /**
   * Column labels on the subtle header row, one element per track (an empty <span /> over the
   * checkbox column). Lines up with the rows when columns is set; hidden below md then.
   */
  header?: ReactNode;
}

/**
 * Rows in a white 20px card with hairline dividers; wraps each child in an li. aria-label and
 * other attributes go to the list; className to the card. In a board column, a stack of cards.
 */
export function ListRows({ columns, header, className, style, children, ...rest }: ListRowsProps) {
  const board = useContext(RowLayoutContext) === 'board';
  const grid = Boolean(columns) && !board;
  const subgrid = grid ? 'md:col-span-full md:grid md:grid-cols-subgrid' : undefined;
  const items = Children.map(children, (child) =>
    child == null ? null : <li className={subgrid}>{child}</li>,
  );

  if (board) {
    return (
      // role=list keeps list semantics in Safari once list-style is none.
      <ul role="list" {...rest} style={style} className={cn('m-0 flex list-none flex-col gap-2 p-0', className)}>
        {items}
      </ul>
    );
  }
  return (
    <div
      // The caller's track template is geometry, so it travels as a custom property.
      style={grid ? ({ ...style, '--list-cols': columns } as CSSProperties) : style}
      className={cn(
        'overflow-hidden rounded-card border border-border bg-canvas',
        grid && 'md:grid md:grid-cols-[var(--list-cols)] md:gap-x-4',
        className,
      )}
    >
      {header ? <div className={cn(LIST_HEADER, grid && `max-md:hidden ${subgrid}`)}>{header}</div> : null}
      <ul role="list" {...rest} className={cn('m-0 list-none divide-y divide-border p-0', subgrid)}>
        <RowLayoutContext.Provider value="rows">
          <ColumnsContext.Provider value={grid}>{items}</ColumnsContext.Provider>
        </RowLayoutContext.Provider>
      </ul>
    </div>
  );
}

// Strip Board names, still imported by pages awaiting rebuild.
export {
  ListRow as Strip,
  ListRowTitle as StripTitle,
  ListRowPrimary as StripPrimary,
  ListCell as StripCell,
  ListRows as StripList,
};
export type {
  ListRowProps as StripProps,
  ListRowTitleProps as StripTitleProps,
  ListRowPrimaryProps as StripPrimaryProps,
  ListCellProps as StripCellProps,
  ListRowsProps as StripListProps,
};
