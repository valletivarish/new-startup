'use client';

import { useEffect, type ReactNode } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/** Landing-only smooth scroll + ScrollTrigger sync. Off when reduced-motion. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bindHashClicks = (scrollTo: (el: HTMLElement) => void) => {
      const onClick = (e: MouseEvent) => {
        const a = (e.target as HTMLElement | null)?.closest(
          'a[href^="#"]',
        ) as HTMLAnchorElement | null;
        if (!a) return;
        const id = a.getAttribute('href')?.slice(1);
        if (!id) return;
        const el = document.getElementById(id);
        if (!el) return;
        e.preventDefault();
        scrollTo(el);
        history.replaceState(null, '', `#${id}`);
      };
      document.addEventListener('click', onClick);
      return () => document.removeEventListener('click', onClick);
    };

    if (reduced) {
      return bindHashClicks((el) => {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }

    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      // Keep native scroll position as source of truth so hash jumps,
      // scrollIntoView, and scrollbar drags reach the footer.
      syncTouch: true,
    });
    (window as unknown as { __landingLenis?: Lenis }).__landingLenis = lenis;

    lenis.on('scroll', ScrollTrigger.update);

    const ticker = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(ticker);
    gsap.ticker.lagSmoothing(0);

    const unbind = bindHashClicks((el) => {
      lenis.scrollTo(el, { offset: -12 });
    });

    requestAnimationFrame(() => ScrollTrigger.refresh());

    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) {
        requestAnimationFrame(() =>
          lenis.scrollTo(el, { offset: -12, immediate: true }),
        );
      }
    }

    return () => {
      unbind();
      gsap.ticker.remove(ticker);
      const w = window as unknown as { __landingLenis?: Lenis };
      if (w.__landingLenis === lenis) delete w.__landingLenis;
      lenis.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  return <>{children}</>;
}
