import type { ReactNode } from 'react';
import { cn } from './cn';

export interface PageHeaderProps {
  /** The page's one h1, 28px/600. */
  title: ReactNode;
  /**
   * The page's one serif-italic accent, set right after the title inside the h1:
   * <PageHeader title="Good evening," accent={firstName} /> reads "Good evening, Priya".
   * Leave out on pages that already carry their accent elsewhere.
   */
  accent?: ReactNode;
  /** A record's state beside its name, as JobHeader shows a job's: <StatusTag domain="agent" … />. */
  status?: ReactNode;
  /** One line in text-2. */
  description?: ReactNode;
  /** Page actions, the main one an ink-navy Button with a leading icon. Right of the title from md, below it on phones. */
  actions?: ReactNode;
  /**
   * A record page's <Breadcrumb />, above the title on phones only: from md the shell's header
   * carries the same trail (pass the crumbs to AppShell too).
   */
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader({ title, accent, status, description, actions, breadcrumb, className }: PageHeaderProps) {
  const heading = (
    <h1 className="m-0 text-page text-text">
      {title}
      {accent ? (
        <>
          {' '}
          <span className="serif-accent">{accent}</span>
        </>
      ) : null}
    </h1>
  );
  return (
    <header
      className={cn(
        'mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-2 md:hidden">{breadcrumb}</div> : null}
        {status ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {heading}
            {status}
          </div>
        ) : (
          heading
        )}
        {description ? <div className="mt-2 max-w-[65ch] text-text-2">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Page content column: 72rem, 16px gutters on phones. Boards and lists may pass max-w-none.
 * The page's one <main> only while the shell's content slot is a <div id="main-content">.
 * Spec 6 puts <main id="main-content"> in the shell: the change that lands it turns this into a
 * <div>, or every page nests a second main.
 */
export function PageMain({ children, className }: { children: ReactNode; className?: string }) {
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
