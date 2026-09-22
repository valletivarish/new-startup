'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP);

const HEIGHTS = {
  sm: [6, 12, 8, 14, 7],
  md: [5, 10, 7, 12, 6],
  hero: [28, 52, 36, 64, 32],
} as const;

/**
 * Wave brand mark — shared across landing, auth, and product chrome.
 * Motion is optional so the shell stays calm.
 */
export function WaveMark({
  className,
  size = 'sm',
  animate = false,
}: {
  className?: string;
  size?: keyof typeof HEIGHTS;
  animate?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const [motionReady, setMotionReady] = useState(false);
  const heights = HEIGHTS[size];
  // Defer motion until after mount so SSR and first client paint match.
  const run = animate && motionReady && !reduce;

  useEffect(() => {
    setMotionReady(true);
  }, []);

  useGSAP(
    () => {
      if (!run || !ref.current) return;
      const bars = ref.current.querySelectorAll<HTMLElement>('[data-mark-bar]');
      bars.forEach((bar, i) => {
        gsap.to(bar, {
          scaleY: 0.55 + (i % 3) * 0.15,
          transformOrigin: '50% 100%',
          duration: 0.5 + i * 0.05,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          delay: i * 0.08,
        });
      });
    },
    { scope: ref, dependencies: [run, size] },
  );

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-end',
        size === 'hero' ? 'h-16 gap-1.5' : size === 'md' ? 'h-3.5 gap-0.5' : 'h-4 gap-0.5',
        className,
      )}
      aria-hidden
    >
      {heights.map((h, i) => (
        <span
          key={i}
          data-mark-bar
          className={cn(
            'inline-block origin-bottom rounded-full bg-[var(--accent)]',
            size === 'hero' ? 'w-2' : size === 'md' ? 'w-[2.5px]' : 'w-[3px]',
          )}
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  );
}

/** Auth / marketing wordmark link. */
export function BrandLink({
  href = '/',
  className,
  markSize = 'md',
  animate = false,
  labelClassName,
}: {
  href?: string;
  className?: string;
  markSize?: keyof typeof HEIGHTS;
  animate?: boolean;
  labelClassName?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-w-0 items-center gap-2 font-display font-semibold tracking-tight text-[var(--foreground)] no-underline',
        className,
      )}
    >
      <WaveMark size={markSize} animate={animate} />
      <span className={cn('truncate', labelClassName)}>Hiring desk</span>
    </Link>
  );
}
