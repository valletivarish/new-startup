'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { cn } from '../ui/cn';
import {
  agentFrame,
  agentMarkup,
  type AgentColour,
  type AgentFace,
  type AgentShape,
  type AgentState,
} from './agent-draw';

/** The brand's look: a pebble of pearl glass (the founder's pick). Used wherever a caller doesn't pick one. */
export const AGENT_DEFAULTS = { shape: 'pebble', colour: 'glass', face: 'neutral' } as const satisfies {
  shape: AgentShape;
  colour: AgentColour;
  face: AgentFace;
};

// One pointer listener for every agent on the page.
const pointer = { x: 0, y: 0, active: false };
let followers = 0;
function onPointer(e: PointerEvent) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.active = true;
}
function onLeave() {
  pointer.active = false;
}

export interface AgentProps {
  /** Rendered width and height in px. */
  size: number;
  state?: AgentState;
  shape?: AgentShape;
  colour?: AgentColour;
  face?: AgentFace;
  /** Eyes follow the pointer anywhere on the page. */
  follow?: boolean;
  /** Turns happy and lifts while the pointer is over it. */
  hoverable?: boolean;
  /** On a light surface: a soft ground shadow instead of a glow, and ink extras. */
  onLight?: boolean;
  /** Names it for assistive tech. Without a label it is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/**
 * The voice agent, drawn in SVG and alive: it breathes, blinks, glances around, follows the
 * pointer, and acts out the call (ringing, listening, thinking, speaking, done, no answer).
 * The server draws its first frame, so it never flashes in empty; each frame after that only
 * rewrites what moves. The loop pauses off screen and in hidden tabs, and never runs under
 * reduced motion (one still frame).
 * <Agent size={32} follow hoverable />
 */
export function Agent({
  size,
  state = 'idle',
  shape = AGENT_DEFAULTS.shape,
  colour = AGENT_DEFAULTS.colour,
  face = AGENT_DEFAULTS.face,
  follow = false,
  hoverable = false,
  onLight = false,
  label,
  className,
}: AgentProps) {
  const ref = useRef<SVGSVGElement>(null);
  // Gradient ids must be unique on the page and safe inside url(#...).
  const id = `ag${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const seed = (size * 7.3) % 4.3;
  // Logo sizes get the small drawing: no darkened edge, softer glow, slightly larger eyes.
  const small = size <= 44;
  const live = useRef({ state, face, hover: false });
  live.current.state = state;
  live.current.face = face;
  // Redraws one frame on demand (state changes under reduced motion, where no loop runs).
  const redraw = useRef<((t: number) => void) | null>(null);
  // The server's frame. Built from the first state only: a later state change must not
  // replace the svg's insides, or the loop would keep drawing into detached nodes.
  const first = useRef({ state, face });
  // One object, not a fresh { __html } per render: React 19 re-applies inner HTML whenever
  // that object changes identity, even with the same text, which would detach the nodes the
  // loop draws into and freeze the agent on its first frame.
  const markup = useMemo(
    () => ({
      __html: agentMarkup({ shape, colour, onLight, seed, small, face: first.current.face, state: first.current.state, still: true }, 0, id),
    }),
    [shape, colour, onLight, seed, small, id],
  );

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const body = svg.querySelector('[data-body]');
    const faceNode = svg.querySelector('[data-face]');
    const extra = svg.querySelector('[data-extra]');
    const voice = svg.querySelector('[data-voice]');
    const ground = svg.querySelector('[data-ground]');
    const ear = svg.querySelector('[data-ear]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (t: number) => {
      const now = live.current;
      let eyes: { x: number; y: number } | undefined;
      if (follow && pointer.active) {
        const box = svg.getBoundingClientRect();
        eyes = {
          x: Math.max(-1, Math.min(1, (pointer.x - (box.left + box.width / 2)) / 320)),
          y: Math.max(-1, Math.min(1, (pointer.y - (box.top + box.height / 2)) / 240)),
        };
      }
      const f = agentFrame(
        { shape, colour, onLight, seed, small, face: now.face, state: now.state, hover: now.hover, look: eyes, still: reduce },
        t,
        id,
      );
      body?.setAttribute('transform', f.body);
      if (faceNode) faceNode.innerHTML = f.face;
      if (extra) extra.innerHTML = f.extra;
      voice?.setAttribute('opacity', String(f.voice));
      ear?.setAttribute('opacity', String(f.ear));
      if (ground && !onLight) {
        ground.setAttribute('rx', String(Math.round(48 * f.ground * 10) / 10));
        ground.setAttribute('ry', String(Math.round(46 * f.ground * 10) / 10));
      } else if (ground) {
        ground.setAttribute('rx', String(Math.round(27 * f.ground * 10) / 10));
      }
    };
    redraw.current = draw;
    if (reduce) {
      draw(0);
      return () => {
        redraw.current = null;
      };
    }

    if (follow && followers++ === 0) {
      window.addEventListener('pointermove', onPointer, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
    }
    let frame = 0;
    let onScreen = true;
    const start = performance.now();
    const tick = (now: number) => {
      draw(Math.max(0, (now - start) / 1000));
      frame = onScreen && !document.hidden ? requestAnimationFrame(tick) : 0;
    };
    const resume = () => {
      if (!frame && onScreen && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      resume();
    });
    observer.observe(svg);
    document.addEventListener('visibilitychange', resume);
    const enter = () => {
      live.current.hover = true;
    };
    const leave = () => {
      live.current.hover = false;
    };
    if (hoverable) {
      svg.addEventListener('pointerenter', enter);
      svg.addEventListener('pointerleave', leave);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      redraw.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', resume);
      svg.removeEventListener('pointerenter', enter);
      svg.removeEventListener('pointerleave', leave);
      if (follow && --followers === 0) {
        window.removeEventListener('pointermove', onPointer);
        document.documentElement.removeEventListener('pointerleave', onLeave);
      }
    };
    // state and face are read through live.current each frame; these rebuild the svg.
  }, [shape, colour, onLight, follow, hoverable, id, seed, small]);

  // A new state shows at once, even when no loop is running.
  useEffect(() => {
    redraw.current?.(0);
  }, [state, face]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0 overflow-visible', className)}
      // The first frame, drawn on the server: still, so the server and the client agree.
      dangerouslySetInnerHTML={markup}
    />
  );
}
