import type { ReactNode } from 'react';
import { cn } from './cn';
import { Alert, type AlertKind } from './notice';

// Legacy module. New code imports from page-header, empty-state and notice directly.
export { EmptyState } from './empty-state';
export { PageHeader, PageMain } from './page-header';

type LegacyKind = 'ok' | 'err' | 'warn';

// 'ok' renders as success. Some callers still pass 'ok' for errors (audit S1); their pages fix that.
const KIND: Record<LegacyKind | AlertKind, AlertKind> = {
  ok: 'success',
  err: 'error',
  warn: 'warning',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

/** @deprecated Import Alert from './notice' and pass a required kind and a title. */
export function Notice({
  children,
  kind = 'ok',
}: {
  children: ReactNode;
  kind?: LegacyKind | AlertKind;
}) {
  return <Alert kind={KIND[kind]}>{children}</Alert>;
}

/** @deprecated A section of the page: a hairline rule, not a box. */
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
    <section className={cn('border-t border-border py-6', elevated && 'border-0 py-0', className)}>
      {children}
    </section>
  );
}
