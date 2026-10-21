'use client';

/*
  The sidebar's icons, drawn from their parts so each part can move: the house's door swings,
  the phone rings with sound waves, the gear turns while its hub pulses, the chart's bars draw
  up from the axis. Shapes match lucide-react (24px grid, 1.5 stroke) so nothing changes at rest.

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
  // Home: the house hops and squashes; the door swings open and shut.
  '/dashboard': (v) => (
    <motion.g variants={v({ y: [0, -2.5, 0.5, 0], scaleY: [1, 1.06, 0.94, 1], transition: { duration: 0.55, ease: EASE } })} style={{ originY: 1 }}>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <motion.path
        d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
        variants={v({ scaleX: [1, 0.2, 0.2, 1], transition: { duration: 0.7, times: [0, 0.3, 0.6, 1], ease: EASE } })}
        style={{ originX: 0 }}
      />
    </motion.g>
  ),
  // Jobs: the briefcase is picked up by its handle and sways; the clasp glints.
  '/jobs': (v) => (
    <motion.g variants={v({ rotate: [0, -10, 7, -3, 0], y: [0, -1.5, 0, 0, 0], transition: { duration: 0.65, ease: EASE } })} style={{ originX: 0.5, originY: 0.1 }}>
      <motion.path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" variants={v({ y: [0, -1.5, 0], transition: { duration: 0.4, ease: EASE } })} />
      <path d="M22 13a18.15 18.15 0 0 1-20 0" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
      <motion.path d="M12 12h.01" strokeWidth={2.5} variants={v({ scale: [1, 2.2, 1], transition: { duration: 0.5, delay: 0.15 } })} />
    </motion.g>
  ),
  // Candidates: the front person nods; the one behind leans in.
  '/candidates': (v) => (
    <>
      <motion.g variants={v({ y: [0, -1.8, 0], transition: { duration: 0.45, ease: EASE } })}>
        <path d="M18 21a8 8 0 0 0-16 0" />
        <motion.circle cx="10" cy="8" r="5" variants={v({ rotate: [0, -8, 0], transition: { duration: 0.45 } })} />
      </motion.g>
      <motion.path
        d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"
        variants={v({ x: [0, 1.8, 0], opacity: [1, 0.55, 1], transition: { duration: 0.55, delay: 0.12, ease: EASE } })}
      />
    </>
  ),
  // Calls: the handset rings and sound waves ripple out.
  '/calls': (v) => (
    <>
      <motion.path
        d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"
        variants={v({ rotate: [0, -16, 14, -12, 9, -5, 0], transition: { duration: 0.7, ease: 'linear' } })}
      />
      <motion.path d="M14.05 6A5 5 0 0 1 18 10" initial={{ opacity: 0, pathLength: 0 }} variants={v({ opacity: [0, 1, 0], pathLength: [0, 1, 1], transition: { duration: 0.8, delay: 0.1 } })} />
      <motion.path d="M14.05 2a9 9 0 0 1 8 7.94" initial={{ opacity: 0, pathLength: 0 }} variants={v({ opacity: [0, 1, 0], pathLength: [0, 1, 1], transition: { duration: 0.8, delay: 0.22 } })} />
    </>
  ),
  // Agents: the bars speak, each to its own rhythm.
  '/agents': (v) => (
    <>
      {[
        ['M2 10v3', [1, 2.2, 0.6, 1.6, 1]],
        ['M6 6v11', [1, 0.45, 1.25, 0.7, 1]],
        ['M10 3v18', [1, 0.6, 1.05, 0.5, 1]],
        ['M14 8v7', [1, 1.7, 0.6, 1.4, 1]],
        ['M18 5v13', [1, 0.5, 1.2, 0.75, 1]],
        ['M22 10v3', [1, 2, 0.7, 1.5, 1]],
      ].map(([d, s], i) => (
        <motion.path key={d as string} d={d as string} variants={v({ scaleY: s as number[], transition: { duration: 0.8, delay: i * 0.05, ease: 'easeInOut' } })} />
      ))}
    </>
  ),
  // Knowledge: the book opens wide and a page turns across.
  '/knowledge': (v) => (
    <>
      <motion.g variants={v({ scaleX: [1, 1.14, 0.97, 1], transition: { duration: 0.6, ease: EASE } })}>
        <path d="M12 5v16" />
        <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
      </motion.g>
      <motion.path
        d="M12 6.5c1.2-1 2.8-1.6 5-1.5"
        initial={{ opacity: 0 }}
        variants={v({ opacity: [0, 1, 1, 0], scaleX: [1, 1, -1, -1], transition: { duration: 0.7, times: [0, 0.15, 0.75, 1], ease: EASE } })}
        style={{ originX: 0 }}
      />
    </>
  ),
  // Tools: the wrench gives a firm twist and settles.
  '/tools': (v) => (
    <motion.path
      d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"
      variants={v({ rotate: [0, -40, 18, -6, 0], transition: { duration: 0.75, ease: EASE } })}
      style={{ originX: 0.15, originY: 0.85 }}
    />
  ),
  // Analytics: the axis stays; each bar draws up from it, one after another.
  '/analytics': (v) => (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      {['M8 17v-3', 'M13 17V5', 'M18 17V9'].map((d, i) => (
        <motion.path key={d} d={d} variants={v({ pathLength: [1, 0, 1], transition: { duration: 0.65, delay: i * 0.1, times: [0, 0.2, 1], ease: EASE } })} />
      ))}
    </>
  ),
  // Settings: the gear turns a notch with a spring; its hub pulses.
  '/settings': (v) => (
    <>
      <motion.path
        d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        // Six teeth: a third of a turn lands on an identical outline, so the next play can restart at 0.
        variants={v({ rotate: [0, 120], transition: SPRING })}
        style={{ originX: 0.5, originY: 0.5 }}
      />
      <motion.circle cx="12" cy="12" r="3" variants={v({ scale: [1, 0.6, 1.15, 1], transition: { duration: 0.6, ease: EASE } })} />
    </>
  ),
  // Costs: the rupee writes itself, stroke by stroke.
  '/admin/costs': (v) => (
    <>
      {['M6 3h12', 'M6 8h12', 'M9 13c6.667 0 6.667-10 0-10', 'M6 13h3', 'm6 13 8.5 8'].map((d, i) => (
        <motion.path key={d} d={d} variants={v({ pathLength: [1, 0, 1], transition: { duration: 0.5, delay: i * 0.08, times: [0, 0.1, 1], ease: EASE } })} />
      ))}
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
