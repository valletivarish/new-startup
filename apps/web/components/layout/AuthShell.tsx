import type { ReactNode } from 'react';
import Link from 'next/link';
import { getImageProps } from 'next/image';
import { Agent } from '@/components/brand/agent';
import { cn } from '@/components/ui/cn';
import { BRAND } from '@/lib/brand';
// The website hero's photographs, reused as they are: sign-in is the step after the website.
import heroPhoto from '../../public/images/site/hero.jpg';
import heroPortrait from '../../public/images/site/hero-portrait.jpg';

/*
  Auth pages (sign in, create account, reset, invite) in the website's first impression: its
  sky-over-grass photograph full bleed, white words on dark glass, the agent as the brand mark.
  The form sits on a white card, so the fields and their states look exactly as in the app.
  A soft-light blue grade and a top scrim keep the white words over the sky at 4.5:1 or more.
*/

// Dark glass, the website's "smoke": a frosted dark tint with a bright top edge. Solid where
// blur is missing and under reduced transparency.
const SMOKE =
  'border border-white/15 bg-[rgb(13_21_30/0.9)] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] supports-[backdrop-filter:blur(1px)]:bg-[rgb(13_21_30/0.6)] supports-[backdrop-filter:blur(1px)]:backdrop-blur-[22px] [@media(prefers-reduced-transparency:reduce)]:bg-[rgb(13_21_30/0.94)] [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none';

// Light glass for the button over the sky, as the website's frost buttons.
const FROST =
  'border border-white/25 bg-[rgb(38_64_90/0.9)] text-white supports-[backdrop-filter:blur(1px)]:bg-[rgb(14_36_58/0.3)] supports-[backdrop-filter:blur(1px)]:backdrop-blur-[16px] hover:bg-[rgb(38_64_90/0.95)] [@media(prefers-reduced-transparency:reduce)]:bg-[rgb(38_64_90/0.94)] [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none';

/** The wide frame from 768px, the tall one on phones (the wide one would blur at phone heights). Decorative. */
function Photo() {
  const common = { alt: '', sizes: '100vw', priority: true, placeholder: 'blur' as const };
  const {
    props: { srcSet: wide },
  } = getImageProps({ ...common, src: heroPhoto, quality: 80 });
  const {
    props: { srcSet: tall, ...img },
  } = getImageProps({ ...common, src: heroPortrait, quality: 78 });
  return (
    <picture>
      <source media="(min-width: 768px)" srcSet={wide} />
      <source srcSet={tall} />
      {/* A plain img inside picture: getImageProps supplies src, sizes and alt="". */}
      <img
        {...img}
        className="absolute inset-0 size-full object-cover object-[50%_100%]"
        style={{ ...img.style, width: undefined, height: undefined }}
      />
    </picture>
  );
}

/** The auth frame. Children are the page's form, set on a white card. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-[#4a7fae]">
      <div aria-hidden className="absolute inset-0 -z-20">
        <Photo />
      </div>
      {/* The website hero's grade and scrim, so the sky reads the same and white words hold 4.5:1. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-75 mix-blend-soft-light [background:linear-gradient(to_bottom,#1f5fa3_0%,#2f72b4_50%,rgb(47_114_180/0)_72%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:linear-gradient(to_bottom,rgb(9_27_46/0.5)_0%,rgb(9_27_46/0.3)_30%,rgb(9_27_46/0.12)_60%,rgb(9_27_46/0.2)_100%)]"
      />

      <div className="mx-auto flex min-h-dvh w-full max-w-[80rem] flex-col px-4 pb-6 pt-3 sm:px-8 sm:pt-5 lg:px-12">
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-button text-title font-semibold tracking-tight text-white no-underline [text-shadow:0_1px_12px_rgb(9_27_46/0.45)]"
          >
            <Agent size={30} follow hoverable />
            <span className="truncate">{BRAND.name}</span>
          </Link>
          <Link
            href="/"
            className={cn(
              'inline-flex h-10 shrink-0 items-center rounded-button px-4 text-label font-medium no-underline transition-colors [@media(pointer:coarse)]:h-11',
              FROST,
            )}
          >
            Back to home
          </Link>
        </header>

        <div className="grid flex-1 content-center items-center gap-6 py-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16">
          <main className="w-full max-w-[27rem] justify-self-center rounded-canvas bg-canvas p-6 text-text shadow-float sm:p-8 lg:col-start-2 lg:row-start-1">
            {children}
          </main>

          <aside
            className={cn(
              'w-full max-w-[27rem] justify-self-center rounded-canvas p-6 text-white sm:p-7 lg:col-start-1 lg:row-start-1 lg:max-w-[34rem] lg:justify-self-start',
              SMOKE,
            )}
          >
            <Agent size={52} follow hoverable />
            <p className="m-0 mt-5 text-[clamp(1.6rem,1.2rem+1.4vw,2.35rem)] font-normal leading-[1.08] tracking-[-0.035em]">
              Your AI hiring agent makes the calls.{' '}
              <span className="serif-accent">You decide who&rsquo;s&nbsp;next.</span>
            </p>
            <p className="m-0 mt-4 max-w-[40ch] text-md leading-relaxed text-white/85">
              It phones each candidate with your must-ask questions and hands you the recording,
              transcript and answers.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
