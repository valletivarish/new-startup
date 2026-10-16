import * as React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight } from 'lucide-react';
import { cn } from './cn';

// D2's soft 10px corners, the website's button shape too. Filled variants keep a transparent
// 1px border, so forced colours still draw an edge.
const primary =
  'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-muted disabled:text-text-3';
const secondary =
  'border-border bg-canvas text-text hover:bg-subtle disabled:bg-subtle disabled:text-text-3';
const tertiary =
  'border-transparent bg-transparent text-text-2 hover:bg-muted hover:text-text disabled:bg-transparent disabled:text-text-3';
const destructive =
  'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive-hover disabled:bg-muted disabled:text-text-3';
const destructiveSecondary =
  'border-status-danger-border bg-canvas text-status-danger-text hover:bg-status-danger-bg disabled:border-border disabled:bg-subtle disabled:text-text-3';

const md = 'h-10 px-4 text-label [&_svg]:size-[1.125rem] [@media(pointer:coarse)]:h-11';

const variants = cva(
  // The press scale is movement, so it is motion-safe only; reduced motion keeps the colour change.
  // The individual scale property composes with any transform the caller sets (centring, say).
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-button border font-medium transition-[color,background-color,border-color,scale] motion-safe:active:[scale:0.97] disabled:cursor-not-allowed aria-busy:cursor-progress [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary,
        secondary,
        tertiary,
        destructive,
        'destructive-secondary': destructiveSecondary,
        link: 'border-transparent bg-transparent text-accent underline decoration-1 underline-offset-4 hover:decoration-2 disabled:text-text-3',
        /** Quiet action on the ink-navy band. Its main action is `secondary`: a white button. */
        'on-rail':
          'border-[var(--glass-border)] bg-transparent text-primary-foreground hover:bg-[var(--glass)] focus-visible:outline-accent-soft disabled:text-border-input',
        /** Frosted button over a photograph (the .glass surface). The photo must keep white text at 4.5:1. */
        glass: 'glass',
        // Legacy names, mapped onto the roles above.
        default: primary,
        outline: secondary,
        quiet: tertiary,
        ghost: tertiary,
        danger: destructiveSecondary,
      },
      size: {
        // 36 and 40px with a mouse, 44px wherever the pointer is a finger.
        sm: 'h-9 gap-1.5 px-3.5 text-label [&_svg]:size-4 [@media(pointer:coarse)]:h-11',
        md,
        lg: 'h-12 px-6 text-md [&_svg]:size-5',
        icon: 'size-10 p-0 [&_svg]:size-5 [@media(pointer:coarse)]:size-11',
        'icon-sm': 'size-9 p-0 [&_svg]:size-4 [@media(pointer:coarse)]:size-11',
        default: md, // legacy
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

/** The merged class string, for styling a link or other element as a button. */
const buttonVariants = (props?: Parameters<typeof variants>[0]) => cn(variants(props));

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {
  asChild?: boolean;
  /** Busy: a spinner leads the label, the label stays, clicks are ignored, aria-busy is set. */
  loading?: boolean;
  /** L1's trailing arrow dot. For the one main call to action in a view, not for every button. */
  arrow?: boolean;
}

// Module level so a server-rendered Button that is not loading never carries a function.
function ignoreClick(event: React.MouseEvent) {
  event.preventDefault();
}

/** Busy ring. Still under reduced motion: the label and aria-busy carry the state. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-pill border-2 border-current border-r-transparent motion-safe:animate-spin"
    />
  );
}

// The dot takes the text colour; its arrow takes the fill, so it reads as cut out of the dot.
const ARROW_ON_FILL: Partial<Record<NonNullable<ButtonProps['variant']>, string>> = {
  primary: 'text-primary',
  default: 'text-primary',
  destructive: 'text-destructive',
  glass: 'text-primary',
  'on-rail': 'text-primary',
};

function ArrowDot({ variant }: { variant: ButtonProps['variant'] }) {
  return (
    <span
      aria-hidden
      className="-mr-1 inline-flex size-[1.25em] shrink-0 items-center justify-center rounded-pill bg-current"
    >
      <ArrowRight
        strokeWidth={2.5}
        className={cn('!size-[0.8125em]', ARROW_ON_FILL[variant ?? 'primary'] ?? 'text-canvas')}
      />
    </span>
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, arrow = false, onClick, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // While busy the spinner stands in for a leading icon.
        className={cn(variants({ variant, size }), loading && '[&>svg]:hidden', className)}
        aria-busy={loading || undefined}
        onClick={loading && !asChild ? ignoreClick : onClick}
        {...props}
      >
        {loading ? <Spinner /> : null}
        <Slottable>{children}</Slottable>
        {arrow && !loading ? <ArrowDot variant={variant} /> : null}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
