import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-4 rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-6 py-10 sm:px-8',
        className,
      )}
    >
      {icon ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--separator-subtle)]">
          {icon}
        </span>
      ) : null}
      <div>
        <h2 className="m-0 font-display text-[1.05rem] font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 mb-0 max-w-md text-sm leading-relaxed text-[var(--foreground-tertiary)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="m-0 font-display text-[1.75rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 mb-0 max-w-2xl text-sm leading-relaxed text-[var(--foreground-tertiary)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** Quiet field surface — elevation reserved for dialogs / live focus objects. */
export function Surface({
  children,
  className,
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)] p-5',
        elevated && 'shadow-sm',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Shared page content width — matches landing max-w-6xl. */
export function PageMain({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 md:px-8 md:py-8',
        className,
      )}
    >
      {children}
    </main>
  );
}

export function Notice({
  children,
  kind = 'ok',
}: {
  children: ReactNode;
  kind?: 'ok' | 'err' | 'warn';
}) {
  return (
    <p
      role={kind === 'err' ? 'alert' : 'status'}
      className={cn(
        'm-0 rounded-md px-3.5 py-2.5 text-[13px] leading-snug',
        kind === 'err' &&
          'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]',
        kind === 'warn' &&
          'border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]',
        kind === 'ok' &&
          'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]',
      )}
    >
      {children}
    </p>
  );
}
