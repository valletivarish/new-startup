'use client';

/*
  The sidebar's icons, drawn from their parts so each part can move: the house's roof lifts and
  its live dot pulses, a job card rises out of its folder, the phone rings with sound waves, the
  chart's bars grow up from the axis. One family: 24px grid, 1.5 stroke, round caps and joins,
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
  // Home: a split-roof house with a live dot at its heart. The roof lifts and settles, the house
  // squashes under it, and the dot sends out one pulse, as if a call just came in.
  '/dashboard': (v) => (
    <>
      <motion.path d="M3 10.5 12 3.5l9 7" variants={v({ y: [0, -2.5, 0.6, 0], transition: { duration: 0.6, times: [0, 0.35, 0.7, 1], ease: EASE } })} />
      <motion.g variants={v({ scaleY: [1, 0.92, 1.04, 1], transition: { duration: 0.6, times: [0, 0.35, 0.7, 1], ease: EASE } })} style={{ originY: 1 }}>
        <path d="M5.5 11.5v7A2.5 2.5 0 0 0 8 21h8a2.5 2.5 0 0 0 2.5-2.5v-7" />
        <circle cx="12" cy="15.5" r="1.75" fill="currentColor" stroke="none" />
      </motion.g>
      <motion.circle
        cx="12"
        cy="15.5"
        initial={{ opacity: 0, r: 1.75 }}
        variants={v({ opacity: [0, 0.9, 0], r: [1.75, 1.75, 4.75], transition: { duration: 0.7, delay: 0.2, times: [0, 0.1, 1], ease: 'easeOut' } })}
      />
    </>
  ),
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
  // Candidates: the second person steps in from behind; the first nods hello.
  '/candidates': (v) => (
    <>
      <motion.g variants={v({ x: [0, -3, 0], opacity: [1, 0, 1], transition: { duration: 0.65, times: [0, 0.15, 1], ease: EASE } })}>
        <path d="M16 4.5a3.25 3.25 0 0 1 0 6.5" />
        <path d="M17.5 14.5A5.5 5.5 0 0 1 21 19.5v1" />
      </motion.g>
      <motion.g variants={v({ y: [0, -1.5, 0.4, 0], transition: { duration: 0.5, delay: 0.2, ease: EASE } })}>
        <circle cx="9" cy="7.75" r="3.75" />
        <path d="M3 20.5v-1A5.5 5.5 0 0 1 8.5 14h1a5.5 5.5 0 0 1 5.5 5.5v1" />
      </motion.g>
    </>
  ),
  // Calls: the handset rings, and two sound waves ripple out of it in turn.
  '/calls': (v) => (
    <>
      <motion.path
        d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"
        variants={v({ rotate: [0, -14, 12, -10, 7, -3, 0], transition: { duration: 0.65, ease: 'easeInOut' } })}
      />
      <motion.path d="M14.05 6A5 5 0 0 1 18 10" initial={{ opacity: 0, pathLength: 0 }} variants={v({ opacity: [0, 1, 1, 0], pathLength: [0, 1, 1, 1], transition: { duration: 0.75, delay: 0.1, times: [0, 0.35, 0.7, 1] } })} />
      <motion.path d="M14.05 2a9 9 0 0 1 8 7.94" initial={{ opacity: 0, pathLength: 0 }} variants={v({ opacity: [0, 1, 1, 0], pathLength: [0, 1, 1, 1], transition: { duration: 0.75, delay: 0.25, times: [0, 0.35, 0.7, 1] } })} />
    </>
  ),
  // Agents: a voice speaking, five bars each to its own rhythm, settling back to the waveform.
  '/agents': (v) => (
    <>
      {[
        ['M4 10.5v3', [1, 2, 0.7, 1.5, 1]],
        ['M8 7v10', [1, 0.5, 1.15, 0.7, 1]],
        ['M12 3.5v17', [1, 0.65, 1.05, 0.55, 1]],
        ['M16 7v10', [1, 1.2, 0.5, 1.1, 1]],
        ['M20 10.5v3', [1, 1.8, 0.8, 2, 1]],
      ].map(([d, s], i) => (
        <motion.path key={d as string} d={d as string} variants={v({ scaleY: s as number[], transition: { duration: 0.75, delay: i * 0.05, ease: 'easeInOut' } })} />
      ))}
    </>
  ),
  // Knowledge: an open book whose right page turns over the spine.
  '/knowledge': (v) => (
    <>
      <path d="M2.5 4.5A1 1 0 0 1 3.5 3.5H8a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H3.5a1 1 0 0 1-1-1z" />
      <path d="M21.5 4.5a1 1 0 0 0-1-1H16a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h5.5a1 1 0 0 0 1-1z" />
      <motion.path
        d="M12 7.5a4 4 0 0 1 4-4h4.5a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1H15a3 3 0 0 0-3 3"
        initial={{ opacity: 0 }}
        variants={v({ opacity: [0, 1, 1, 0], scaleX: [1, 1, -1, -1], transition: { duration: 0.7, times: [0, 0.05, 0.85, 1], ease: 'easeInOut' } })}
        style={{ originX: 0 }}
      />
    </>
  ),
  // Tools: the wrench tightens a bolt, two quick turns in place.
  '/tools': (v) => (
    <motion.path
      d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"
      variants={v({ rotate: [0, -24, 0, -24, 0], transition: { duration: 0.7, times: [0, 0.25, 0.5, 0.75, 1], ease: 'easeInOut' } })}
      style={{ originX: 0.62, originY: 0.38 }}
    />
  ),
  // Analytics: the axis stays; each bar grows up from it, one after another, with a little overshoot.
  '/analytics': (v) => (
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
