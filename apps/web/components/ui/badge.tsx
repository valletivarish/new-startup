import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium capitalize',
  {
    variants: {
      tone: {
        neutral:
          'bg-[var(--background-secondary)] text-[var(--foreground-secondary)]',
        accent:
          'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]',
        success:
          'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]',
        warning:
          'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]',
        danger:
          'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function statusTone(
  status: string,
): NonNullable<VariantProps<typeof badgeVariants>['tone']> {
  switch (status) {
    case 'open':
    case 'reviewed':
    case 'published':
    case 'completed':
    case 'ready':
      return 'success';
    case 'screening':
    case 'active':
    case 'processing':
      return 'accent';
    case 'draft':
    case 'new':
    case 'pending':
      return 'warning';
    case 'closed':
    case 'failed':
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}
