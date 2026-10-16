import { Building2 } from 'lucide-react';
import { initials } from '@/components/shared/user-initials';
import { cn } from '@/lib/utils';

/**
 * The sidebar rail: 72px, icons only. It shows when someone collapsed the sidebar, and from 768
 * to 1023px unless they expanded it. CSS reads data-rail on the sidebar (named group "side"), so
 * the first paint is right at every width. These classes apply to elements inside it.
 */
export const RAIL = {
  /** Text that names a control: gone from view in the rail, still read out. */
  srOnly: 'group-data-[rail=on]/side:sr-only max-lg:group-data-[rail=auto]/side:sr-only',
  hidden: 'group-data-[rail=on]/side:hidden max-lg:group-data-[rail=auto]/side:hidden',
  /** Drawn in the rail only. */
  only: 'hidden group-data-[rail=on]/side:block max-lg:group-data-[rail=auto]/side:block',
  /** A row's content centred in the 40px rail column. */
  center:
    'group-data-[rail=on]/side:justify-center group-data-[rail=on]/side:px-0 max-lg:group-data-[rail=auto]/side:justify-center max-lg:group-data-[rail=auto]/side:px-0',
} as const;

/** Radix DropdownMenu parts, in the D2 language: white panel, 16px radius, 12px items. */
export const MENU = {
  panel:
    'z-50 min-w-[15rem] max-w-[min(20rem,calc(100vw-1.5rem))] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-card-sm border border-border bg-canvas p-1.5 text-label text-text shadow-float outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-dialog-in',
  // Keyboard focus keeps the global outline, drawn inside the item so the panel never clips it.
  item: 'flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-input px-2.5 text-label text-text focus-visible:-outline-offset-2 data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[state=open]:bg-muted data-[disabled]:text-text-3 [@media(pointer:coarse)]:min-h-11 [&>svg]:size-[1.125rem] [&>svg]:shrink-0 [&>svg]:text-text-2',
  label: 'px-2.5 pb-2 pt-1.5',
  separator: '-mx-1.5 my-1.5 h-px bg-border',
} as const;

/**
 * Loading placeholders, drawn here rather than with ui Skeleton because they need a fill that
 * shows on the ground. Give each its radius.
 */
export const PLACEHOLDER = {
  onGround: 'block bg-canvas opacity-70 motion-safe:animate-pulse',
  onCanvas: 'block bg-muted motion-safe:animate-pulse',
} as const;

/** A workspace's initials on a small ink tile. Decorative. */
export function OrgAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-xs bg-primary text-caption font-semibold text-primary-foreground',
        className,
      )}
    >
      {initials(name) || <Building2 strokeWidth={1.5} className="size-4" />}
    </span>
  );
}
