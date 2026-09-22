'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP);

/** Soft periwinkle bars — live call visualizer. */
const BAR_COUNT = 14;
const BASE_HEIGHTS = [22, 36, 16, 44, 28, 52, 18, 40, 30, 46, 26, 38, 14, 32];

export function VoiceWaveform({
  active = true,
  className,
  barClassName,
}: {
  active?: boolean;
  className?: string;
  barClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const bars = root.querySelectorAll<HTMLElement>('[data-wave-bar]');
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;

      if (!active || reduced) {
        gsap.set(bars, { scaleY: 1, transformOrigin: '50% 100%' });
        return;
      }

      bars.forEach((bar, i) => {
        const peak = 0.5 + ((i * 19) % 50) / 100;
        gsap.fromTo(
          bar,
          { scaleY: 0.32 + (i % 5) * 0.05, transformOrigin: '50% 100%' },
          {
            scaleY: peak,
            duration: 0.36 + (i % 5) * 0.08,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: i * 0.04,
          },
        );
      });
    },
    { scope: rootRef, dependencies: [active] },
  );

  return (
    <div
      ref={rootRef}
      className={cn('flex h-14 items-end justify-center gap-[5px]', className)}
      aria-hidden
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          data-wave-bar
          className={cn(
            'inline-block w-[5px] origin-bottom rounded-full bg-[var(--accent-soft)]',
            'dark:bg-[color-mix(in_srgb,var(--accent)_70%,white)]',
            barClassName,
          )}
          style={{ height: BASE_HEIGHTS[i] ?? 24 }}
        />
      ))}
    </div>
  );
}
