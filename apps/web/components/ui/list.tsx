'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { cn } from './cn';
import { LIST_HEADER, ListRow, ListRowTitle, RowLayoutContext } from './strip';

/*
  Legacy list family, drawn as D2 table rows. New code: ListRows, ListRow, ListRowPrimary, ListCell.
  DataList is the white 20px card, DataListHeader its subtle header row, DataListBody the
  hairline-divided rows. Rows open through a real link or button (DataListTitle), stretched
  over the row. Hover subtle; open (selected) accent-soft with a 3px accent bar; focus an accent ring.
*/

const RowContext = createContext<{ href?: string; onClick?: () => void }>({});

type Slot = { children: ReactNode; className?: string };

export function DataList({ children, className }: Slot) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-canvas', className)}>
      <RowLayoutContext.Provider value="rows">{children}</RowLayoutContext.Provider>
    </div>
  );
}

/** Column labels on the subtle header row. Same horizontal geometry as a row, so pass the rows' grid-cols. */
export function DataListHeader({ children, className }: Slot) {
  return <div className={cn(LIST_HEADER, 'grid', className)}>{children}</div>;
}

export function DataListBody({ children, className }: Slot) {
  return (
    <ul role="list" className={cn('m-0 list-none divide-y divide-border p-0', className)}>
      {children}
    </ul>
  );
}

/**
 * One row. With href or onClick the row opens through its DataListTitle,
 * which becomes a link or a button; keep a DataListTitle in every such row.
 */
export function DataListRow({
  href,
  children,
  className,
  onClick,
  selected = false,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <li>
      <RowContext.Provider value={{ href, onClick }}>
        <ListRow reflow={false} selected={selected} className={className}>
          {children}
        </ListRow>
      </RowContext.Provider>
    </li>
  );
}

export function DataListTitle({ children, className }: Slot) {
  const { href, onClick } = useContext(RowContext);
  return (
    <ListRowTitle href={href} onOpen={onClick} className={className}>
      {children}
    </ListRowTitle>
  );
}

export function DataListMeta({ children, className }: Slot) {
  return <p className={cn('mb-0 mt-0.5 text-meta text-text-3', className)}>{children}</p>;
}
