import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';

export interface Crumb {
  label: string;
  /** Leave out on the last crumb: it is the current page. */
  href?: string;
}

/** "Jobs > Java backend developer", 14px with chevrons. The last crumb is the current page. */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol role="list" className="m-0 flex list-none flex-wrap items-center gap-x-1.5 p-0 text-label text-text-3">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="flex min-w-0 items-center gap-x-1.5">
              {i > 0 ? <ChevronRight aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" /> : null}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  // ::after widens the hit area to 44px tall without moving the layout.
                  className="relative rounded-xs text-text-2 underline-offset-4 transition duration-fast after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-text hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn('truncate', last && 'font-medium text-text')}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
