'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from 'motion/react';
import { Agent } from '../brand/agent';
import type { AgentFace, AgentState } from '../brand/agent-draw';
import { cn } from '../ui/cn';
import { SIGN_IN_HREF, SIGNUP_HREF, WORDMARK } from './kit';
import { SiteMenu, type SiteMenuLink } from './menu';

/**
 * A web take on Apple's Liquid Glass for the website header (an approximation: Apple ships the
 * material for its own platforms, not the web). One floating glass capsule pinned to the top:
 * the agent and name, the section links, Sign in and Create account. Behind the links rides a
 * clear glass lens; the label it sits under brightens and grows a little. It slides to the
 * link you point at or focus, and you can drag it: it stretches with speed, wobbles a little
 * as it lands, and letting go over a link takes you there. Reduced motion: the lens jumps,
 * no stretch, no wobble, no growing label. On phones the bar keeps the wordmark, a compact
 * Create account and the menu button.
 */

// What the header's agent acts out while the page scrolls: every state, and a few faces.
const ACTS: readonly { state: AgentState; face?: AgentFace }[] = [
  { state: 'ringing' },
  { state: 'listening' },
  { state: 'thinking' },
  { state: 'speaking' },
  { state: 'done' },
  { state: 'missed' },
  { state: 'idle', face: 'happy' },
  { state: 'idle', face: 'curious' },
  { state: 'idle', face: 'wink' },
  { state: 'idle', face: 'surprised' },
];

/**
 * The brand agent in the header. While the page scrolls it acts out a random state every
 * 1.6 seconds, never the same one twice running; 1.2 seconds after scrolling stops it rests.
 * Reduced motion: it stays at rest.
 */
export function NavAgent({ size }: { size: number }) {
  const [act, setAct] = useState(-1);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let last = -Infinity;
    let rest = 0;
    const onScroll = () => {
      const now = performance.now();
      if (now - last > 1600) {
        last = now;
        setAct((prev) => {
          const next = Math.floor(Math.random() * (ACTS.length - 1));
          return next >= prev ? next + 1 : next;
        });
      }
      window.clearTimeout(rest);
      rest = window.setTimeout(() => {
        last = -Infinity;
        setAct(-1);
      }, 1200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(rest);
    };
  }, []);
  const a = ACTS[act];
  return <Agent colour="pearl" size={size} state={a?.state ?? 'idle'} face={a?.face ?? 'neutral'} follow fixed />;
}

/**
 * Gives each label in the bar ([data-ink]) the ink that reads over what is under it right
 * now: dark over bright content (a white app card), white over the photos and the black.
 * One point per label on every scroll frame, written straight to the label's --ink and
 * --paper, so a bar that sits half over the black and half over a white card stays readable
 * end to end.
 */
function useInk(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const bar = ref.current;
      if (!bar) return;
      const own = bar.closest('header') ?? bar;
      for (const el of bar.querySelectorAll<HTMLElement>('[data-ink]')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const under = document
          .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          .find((e) => !own.contains(e));
        const onBright = !!under && isBright(under);
        el.style.setProperty('--ink', onBright ? INK_DARK : INK_LIGHT);
        el.style.setProperty('--paper', onBright ? INK_LIGHT : INK_DARK);
      }
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    return () => {
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}

const INK_LIGHT = '255 255 255';
const INK_DARK = '5 5 5';

/**
 * Whether the first solid background at or above an element is bright. Photos and gradients
 * count as dark: the site's are graded for white text.
 */
function isBright(el: Element) {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e instanceof HTMLImageElement) return false;
    const style = getComputedStyle(e);
    if (style.backgroundImage !== 'none') return false;
    const [r = 0, g = 0, b = 0, a = 1] = (style.backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    if (a >= 0.5) return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160;
  }
  return false;
}

type Box = { left: number; width: number };

export function LiquidNav({ sections }: { sections: readonly SiteMenuLink[] }) {
  const reduce = useReducedMotion();
  const bar = useRef<HTMLDivElement>(null);
  useInk(bar);
  const track = useRef<HTMLUListElement>(null);
  const items = useRef<(HTMLAnchorElement | null)[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  // The link the lens sits under, or -1 when the lens is hidden.
  const [active, setActive] = useState(-1);
  const shown = active >= 0;
  const drag = useRef<{ startX: number; startLeft: number; moved: boolean; id: number } | null>(null);
  // The click that follows a drag's release; the drag already navigated.
  const dragged = useRef(false);

  // The lens: where it is and how wide, chased by springs so it lands with a small wobble.
  const targetX = useMotionValue(0);
  const targetW = useMotionValue(0);
  // Reduced motion: stiff enough to land at once, damped so it never overshoots.
  const spring = reduce ? { stiffness: 3000, damping: 200 } : { stiffness: 420, damping: 30, mass: 0.7 };
  const x = useSpring(targetX, spring);
  const w = useSpring(targetW, spring);
  // Stretch with speed, like liquid: longer and thinner the faster it moves.
  const speed = useVelocity(x);
  const scaleX = useTransform(speed, (v) => (reduce ? 1 : 1 + Math.min(Math.abs(v) / 2600, 0.28)));
  const scaleY = useTransform(speed, (v) => (reduce ? 1 : 1 - Math.min(Math.abs(v) / 5200, 0.14)));

  const measure = useCallback(() => {
    const row = track.current;
    if (!row) return;
    const base = row.getBoundingClientRect().left;
    setBoxes(
      items.current.map((el) => {
        const r = el?.getBoundingClientRect();
        return r ? { left: r.left - base, width: r.width } : { left: 0, width: 0 };
      }),
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const row = track.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    // Web fonts change the links' widths once they load.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure]);

  const moveTo = useCallback(
    (i: number) => {
      const b = boxes[i];
      if (!b) return;
      targetX.set(b.left);
      targetW.set(b.width);
      if (!shown) {
        // First show: appear in place rather than sliding in from the left edge.
        x.jump(b.left);
        w.jump(b.width);
      }
      setActive(i);
    },
    [boxes, shown, targetX, targetW, x, w],
  );

  const nearest = (centre: number) => {
    let best = 0;
    boxes.forEach((b, i) => {
      if (Math.abs(b.left + b.width / 2 - centre) < Math.abs((boxes[best]?.left ?? 0) + (boxes[best]?.width ?? 0) / 2 - centre)) best = i;
    });
    return best;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLUListElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { startX: e.clientX, startLeft: x.get(), moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLUListElement>) => {
    const row = track.current;
    if (!row) return;
    const d = drag.current;
    if (d && d.id === e.pointerId && (d.moved || Math.abs(e.clientX - d.startX) > 6)) {
      if (!d.moved) {
        d.moved = true;
        row.setPointerCapture(e.pointerId);
      }
      // Dragging: the lens follows the finger, its width eases toward the nearest link's.
      const first = boxes[0];
      const last = boxes[boxes.length - 1];
      if (!first || !last) return;
      const left = Math.min(Math.max(d.startLeft + (e.clientX - d.startX), first.left), last.left + last.width - w.get());
      const i = nearest(left + w.get() / 2);
      targetX.set(left);
      targetW.set(boxes[i]?.width ?? w.get());
      setActive(i);
      return;
    }
    // Hovering: the lens slides to the link under the pointer.
    const base = row.getBoundingClientRect().left;
    const i = boxes.findIndex((b) => e.clientX - base >= b.left - 4 && e.clientX - base <= b.left + b.width + 4);
    if (i >= 0) moveTo(i);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    // Let go: snap to the nearest link and go there.
    const i = nearest(x.get() + w.get() / 2);
    moveTo(i);
    const href = sections[i]?.href;
    if (href?.startsWith('#')) document.querySelector(href)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    dragged.current = true;
    window.setTimeout(() => (dragged.current = false), 0);
    e.preventDefault();
  };

  // A click that ends a drag has already been handled in onPointerUp.
  const swallowDragClick = (e: React.MouseEvent) => {
    if (dragged.current) e.preventDefault();
  };

  useEffect(() => {
    if (!shown) return;
    const hide = () => setActive(-1);
    window.addEventListener('scroll', hide, { passive: true, once: true });
    return () => window.removeEventListener('scroll', hide);
  }, [shown]);

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-6">
      <div
        ref={bar}
        className="liquid-glass mx-auto flex h-14 max-w-[64rem] items-center justify-between gap-3 rounded-full pl-3 pr-2 md:h-[3.75rem] md:pl-4"
      >
        <Link
          href="/"
          data-ink
          className="inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-full pr-2 text-[1rem] font-medium tracking-[-0.01em] text-[rgb(var(--ink))] no-underline transition-colors duration-300"
        >
          <NavAgent size={28} />
          <span className="truncate">{WORDMARK}</span>
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul
            ref={track}
            role="list"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onPointerLeave={() => !drag.current && setActive(-1)}
            className="relative m-0 flex list-none items-center p-0 [touch-action:pan-y]"
          >
            {sections.map(({ href, label }, i) => (
              <li key={href}>
                <a
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  href={href}
                  onFocus={() => moveTo(i)}
                  onBlur={() => setActive(-1)}
                  onClick={swallowDragClick}
                  draggable={false}
                  data-ink
                  className={cn(
                    'relative z-10 inline-flex h-10 select-none items-center rounded-full px-4 text-[0.9375rem] text-[rgb(var(--ink)/0.9)] no-underline transition-[color,scale] duration-300 hover:text-[rgb(var(--ink))] focus-visible:text-[rgb(var(--ink))]',
                    active === i && 'text-[rgb(var(--ink))] motion-safe:[scale:1.05]',
                  )}
                >
                  {label}
                </a>
              </li>
            ))}
            {/* The lens: a clear glass bead behind the label. Decorative. */}
            <motion.li
              aria-hidden
              role="presentation"
              // top-0, not a translate: Motion writes the inline transform (x, stretch) and would drop a CSS translate.
              className="liquid-lens pointer-events-none absolute left-0 top-0 h-10 rounded-full"
              style={{ x, width: w, scaleX, scaleY, opacity: shown ? 1 : 0 }}
              transition={{ opacity: { duration: reduce ? 0 : 0.18 } }}
            />
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href={SIGN_IN_HREF}
            data-ink
            className="hidden h-10 items-center rounded-full px-3.5 text-[0.9375rem] text-[rgb(var(--ink)/0.9)] no-underline transition-colors duration-300 hover:bg-[rgb(var(--ink)/0.1)] hover:text-[rgb(var(--ink))] sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href={SIGNUP_HREF}
            data-ink
            className="inline-flex h-11 items-center whitespace-nowrap rounded-[10px] bg-[rgb(var(--ink))] px-3.5 text-[0.875rem] font-medium text-[rgb(var(--paper))] no-underline transition-[background-color,color,scale] duration-300 hover:bg-[rgb(var(--ink)/0.86)] motion-safe:active:[scale:0.98] sm:h-10 sm:px-4 [@media(pointer:coarse)]:h-11"
          >
            Create account
          </Link>
          <div data-ink className="lg:hidden">
            <SiteMenu
              links={sections}
              className="rounded-[10px] border-[rgb(var(--ink)/0.25)] bg-[rgb(var(--ink)/0.12)] text-[rgb(var(--ink))] hover:bg-[rgb(var(--ink)/0.2)]"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
