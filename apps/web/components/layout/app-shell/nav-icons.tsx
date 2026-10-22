'use client';

/*
  The sidebar's icons, drawn from their parts so each part can move: a job card rises out of its
  folder, the heads of a group nod, the chart's bars grow up from the axis, the gear turns. One family: 24px grid, 1.5 stroke, round caps and joins,
  2-2.5 corner radii, art inside 2-22.

  An icon plays once each time `play` changes (row hovered or focused, or the rail opening, with
  `delay` for the ripple) and always ends exactly at rest. Never under reduced motion.
*/

import { useEffect, useRef } from 'react';
import { motion, useAnimationControls, useReducedMotion, type Variants } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

const SPRING = { type: 'spring', stiffness: 380, damping: 14, mass: 0.6 } as const;
const EASE = [0.32, 0.72, 0, 1] as const;

type Parts = (v: (play: Variants['play']) => Variants) => React.ReactNode;

const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Each page's icon as moving parts. `v` builds the variants for one part from its play target. */
const ICONS: Record<string, Parts> = {
  // Jobs: a folder holding a ticked job card. The card rises out of the folder, its check redraws,
  // and it drops back in as the folder gives a little.
  '/jobs': (v) => (
    <>
      <motion.g variants={v({ scaleY: [1, 1.35, 1], transition: { duration: 0.7, times: [0, 0.4, 1], ease: EASE } })} style={{ originY: 1 }}>
        <path d="M10.5 10.5V5A1.5 1.5 0 0 1 12 3.5h5.5A1.5 1.5 0 0 1 19 5v5.5" />
      </motion.g>
      <motion.path d="m12.75 6.75 1.25 1.25 2.25-2.5" variants={v({ y: [0, -1.4, -1.2, 0], pathLength: [1, 0, 1, 1], transition: { duration: 0.7, times: [0, 0.25, 0.6, 1], ease: EASE } })} />
      <motion.g variants={v({ scaleY: [1, 0.9, 1.03, 1], transition: { duration: 0.6, times: [0, 0.35, 0.7, 1], ease: EASE } })} style={{ originY: 1 }}>
        <path d="M3 18.5v-8a2 2 0 0 1 2-2h1.75a1.5 1.5 0 0 1 1.17.56l1.58 1.94h9.5a2 2 0 0 1 2 2v5.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5" />
      </motion.g>
    </>
  ),
  // People: a group of three heads, each nodding in turn.
  '/people': (v) => (
    <>
      <motion.circle cx="12" cy="7.5" r="3" variants={v({ y: [0, -1.6, 0.4, 0], transition: { duration: 0.5, ease: EASE } })} />
      <motion.circle cx="5.5" cy="9.5" r="2.25" variants={v({ y: [0, -1.4, 0.3, 0], transition: { duration: 0.5, delay: 0.1, ease: EASE } })} />
      <motion.circle cx="18.5" cy="9.5" r="2.25" variants={v({ y: [0, -1.4, 0.3, 0], transition: { duration: 0.5, delay: 0.2, ease: EASE } })} />
      <path d="M6.5 20.5v-1A4.5 4.5 0 0 1 11 15h2a4.5 4.5 0 0 1 4.5 4.5v1" />
      <path d="M1.5 19.5v-.5A3.5 3.5 0 0 1 5 15.5" />
      <path d="M22.5 19.5v-.5a3.5 3.5 0 0 0-3.5-3.5" />
    </>
  ),
  // Reports: the axis stays; each bar grows up from it, one after another, with a little overshoot.
  '/reports': (v) => (
    <>
      <path d="M3 3.5v15A2.5 2.5 0 0 0 5.5 21h15" />
      {['M8 17v-3', 'M13 17V6', 'M18 17v-7'].map((d, i) => (
        <motion.path key={d} d={d} style={{ originY: 1 }} variants={v({ scaleY: [1, 0, 1.12, 1], transition: { duration: 0.6, delay: i * 0.08, times: [0, 0.15, 0.7, 1], ease: EASE } })} />
      ))}
    </>
  ),
  // Settings: the gear turns a notch with a spring; its hub pulses.
  '/settings': (v) => (
    <>
      <motion.path
        d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        // Six teeth: a third of a turn lands on an identical outline, then snaps back to 0 unseen.
        variants={v({ rotate: [0, 120], transition: SPRING, transitionEnd: { rotate: 0 } })}
        style={{ originX: 0.5, originY: 0.5 }}
      />
      <motion.circle cx="12" cy="12" r="3" variants={v({ scale: [1, 0.6, 1.15, 1], transition: { duration: 0.6, ease: EASE } })} />
    </>
  ),
};

export function NavIcon({
  href,
  fallback: Fallback,
  play,
  delay = 0,
}: {
  href: string;
  fallback: LucideIcon;
  /** Changes each time the icon should play (hover, focus, rail opening). 0 = never yet. */
  play: number;
  /** Seconds before playing, for the rail-opening ripple. */
  delay?: number;
}) {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const delayRef = useRef(delay);
  delayRef.current = delay;

  useEffect(() => {
    if (play === 0 || reduce) return;
    void controls.start('play');
  }, [play, reduce, controls]);

  const parts = ICONS[href];
  if (!parts) {
    return (
      <motion.span className="inline-flex" animate={controls} variants={{ play: { y: [0, -2, 0], scale: [1, 1.1, 1], transition: { duration: 0.4, ease: EASE } } }}>
        <Fallback aria-hidden strokeWidth={1.5} className="size-[1.125rem] shrink-0" />
      </motion.span>
    );
  }

  // Delay is read when each part starts, so one icon's ripple delay applies to all its parts.
  const v = (target: Variants['play']): Variants => ({
    play: () => {
      const t = target as { transition?: { delay?: number } };
      return { ...t, transition: { ...t.transition, delay: (t.transition?.delay ?? 0) + delayRef.current } };
    },
  });

  return (
    <motion.svg {...svgProps} aria-hidden animate={controls} initial={false} className="size-[1.125rem] shrink-0 overflow-visible">
      {parts(v)}
    </motion.svg>
  );
}
