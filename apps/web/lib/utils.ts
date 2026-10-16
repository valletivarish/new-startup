import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge does not know the Strip Board scale, so it reads `text-label` as a
// colour and silently drops it next to `text-ink`. This cn knows the keys, and treats the
// width roles, motion durations, easings and animations as groups so a later one wins.
// tailwind-merge 3 also follows Tailwind 4 names: a bare `outline` counts as a width and
// vanishes next to `outline-2`; write `[outline:2px_solid_var(--ink)]` instead.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'caption',
        'meta',
        'label',
        'body',
        'title',
        'section',
        'subpage',
        'page',
        'lead',
        'display-1',
        'display-2',
      ],
      // The role radii, so a caller's rounded-* replaces a component's (Button's rounded-button).
      radius: ['strip', 'control', 'sheet', 'button', 'input', 'card-sm', 'card', 'canvas', 'hero', 'pill'],
      ease: ['standard', 'exit', 'stamp'],
      animate: [
        'stamp',
        'live-bar',
        'live-bar-brief',
        'fade-in',
        'fade-out',
        'slide-in-right',
        'slide-in-left',
        'slide-in-up',
        'slide-out-right',
        'slide-out-left',
        'slide-out-down',
      ],
    },
    classGroups: {
      'font-stretch': [{ stretch: ['announce', 'read', 'strip'] }],
      duration: [{ duration: ['instant', 'fast', 'base', 'slow', 'strip', 'normal'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
