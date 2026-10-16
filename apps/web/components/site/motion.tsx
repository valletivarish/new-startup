'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * The website's scroll motion, one calm register (power3.out, no bounce):
 * - the hero photo drifts down slower than the page and its words fade as they leave;
 * - [data-reveal] blocks rise 28px into place the first time they enter, in order;
 * - photographs in [data-photo-frame] drift inside their frames ([data-photo-drift]).
 * Blocks already on screen at load are left alone, so nothing blinks out and back. Reduced
 * motion gets none of it. Renders nothing.
 */
export function SiteMotion() {
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const hero = document.querySelector<HTMLElement>('[data-hero]');
      if (hero) {
        gsap.to('[data-hero-photo]', {
          yPercent: 14,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
        });
        gsap.to('[data-hero-content]', {
          yPercent: -6,
          autoAlpha: 0.15,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: '70% top', scrub: true },
        });
      }

      const fold = window.innerHeight;
      const blocks = gsap.utils
        .toArray<HTMLElement>('[data-reveal]')
        .filter((el) => el.getBoundingClientRect().top > fold * 0.9);
      // Opacity, not autoAlpha: hidden blocks stay in the tab order and the accessibility tree.
      gsap.set(blocks, { opacity: 0, y: 28 });
      ScrollTrigger.batch(blocks, {
        start: 'top 88%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, overwrite: true }),
      });

      gsap.utils.toArray<HTMLElement>('[data-photo-frame]').forEach((frame) => {
        const photo = frame.querySelector('[data-photo-drift]');
        if (!photo) return;
        gsap.fromTo(
          photo,
          { yPercent: -4 },
          {
            yPercent: 4,
            ease: 'none',
            scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom top', scrub: true },
          },
        );
      });
    });
    return () => mm.revert();
  });
  return null;
}
