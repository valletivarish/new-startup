import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Quiet table-like list for Jobs, people, agents, activity. */
export function DataList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DataListHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid items-center gap-3 border-b border-[var(--separator-subtle)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DataListBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'm-0 list-none divide-y divide-[var(--separator-subtle)] p-0',
        className,
      )}
    >
      {children}
    </ul>
  );
}

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
  const rowClass = cn(
    'grid items-center gap-3 px-4 py-2.5 text-[var(--foreground)] transition-colors duration-fast hover:bg-[var(--surface-secondary)]',
    href && 'no-underline',
    selected &&
      'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]',
    className,
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          className={rowClass}
          onClick={onClick}
          aria-current={selected ? 'true' : undefined}
        >
          {children}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <div
        className={rowClass}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-current={selected ? 'true' : undefined}
      >
        {children}
      </div>
    </li>
  );
}

export function DataListTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('block truncate text-sm font-semibold', className)}>
      {children}
    </span>
  );
}

export function DataListMeta({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]',
        className,
      )}
    >
      {children}
    </p>
  );
}
