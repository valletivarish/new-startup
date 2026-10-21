import { getImageProps } from 'next/image';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { cn } from '../ui/cn';
import heroPhoto from '../../public/images/site/hero.jpg';
import heroMeta from '../../public/images/site/hero.json';
import heroPortrait from '../../public/images/site/hero-portrait.jpg';
import { CONTAINER, Italic, SIGNUP_HREF, Tag, siteButton } from './kit';
import { LiveCall } from './live-call';

const rise = (seconds: number) => ({ '--rise-delay': `${seconds}s` }) as CSSProperties;

/**
 * The photo, art-directed: the wide frame from 768px, the tall one on phones, where the wide
 * frame would crop her face too large. Both keep her at the bottom centre.
 */
function HeroPhoto() {
  const common = { alt: heroMeta.alt, sizes: '100vw', priority: true, placeholder: 'blur' as const };
  const {
    props: { srcSet: wide },
  } = getImageProps({ ...common, src: heroPhoto, quality: 82 });
  const {
    props: { srcSet: tall, ...img },
  } = getImageProps({ ...common, src: heroPortrait, quality: 80 });
  return (
    <picture>
      <source media="(min-width: 768px)" srcSet={wide} />
      <source srcSet={tall} />
      {/* A plain img inside picture: getImageProps supplies src, sizes and alt. */}
      <img
        {...img}
        className="site-settle absolute inset-0 size-full object-cover object-[50%_100%]"
        style={{ ...img.style, width: undefined, height: undefined }}
      />
    </picture>
  );
}

/**
 * The first viewport: tall grass under open sky, full bleed. Centred in the sky, the way the
 * Levito sky hero sits: a small tag, the two-line headline with the page's first italic phrase,
 * one line, Start a pilot and Hear a sample call, and a quiet line under them. The live call
 * card is the glass object in the scene (Lodge's glass panel), rising out of the grass and
 * across the fold into the black (Apogee). Phones leave it out: the playable sample call
 * follows straight after. The photo settles and the words rise on load (CSS, so the first paint is never blank),
 * then the photo drifts on scroll (site motion). Its foot fades into the black of the next
 * section. A top scrim keeps the white text at 4.5:1 or more over the sky.
 */
export function SiteHero() {
  return (
    <section id="top" data-hero aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-site-sky">
      <div data-hero-photo className="absolute inset-0 -z-20">
        <HeroPhoto />
      </div>
      {/* A soft-light blue deepens the sky toward the reference's; the scrim keeps white text at 4.5:1 or more. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-75 mix-blend-soft-light [background:linear-gradient(to_bottom,#1f5fa3_0%,#2f72b4_50%,rgb(47_114_180/0)_72%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:linear-gradient(to_bottom,rgb(9_27_46/0.46)_0%,rgb(9_27_46/0.44)_42%,rgb(9_27_46/0.42)_56%,rgb(9_27_46/0.14)_68%,rgb(9_27_46/0)_78%)]"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 -z-10 h-[30%] [background:linear-gradient(to_bottom,rgb(5_5_5/0)_0%,rgb(5_5_5/0.5)_55%,#050505_100%)]"
      />

      <div
        data-hero-content
        className={cn(
          CONTAINER,
          'flex min-h-[max(100svh,40rem)] flex-col items-center pb-20 pt-32 text-center md:min-h-0 md:pb-24 md:pt-36',
        )}
      >
        <Tag tone="sky" live className="site-rise" style={rise(0.1)}>
          For hiring teams in India · English
        </Tag>
        <h1
          id="hero-title"
          className="site-display site-rise m-0 mt-6 text-white [text-shadow:0_1px_24px_rgb(9_27_46/0.25)]"
          style={rise(0.18)}
        >
          <span className="block">It calls every candidate.</span>
          <span className="block">
            You decide <Italic>who&rsquo;s&nbsp;next.</Italic>
          </span>
        </h1>
        <p
          className="site-rise m-0 mt-6 max-w-[34rem] text-[1.0625rem] leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgb(9_27_46/0.35)] lg:max-w-[40rem]"
          style={rise(0.3)}
        >
          Add a job and your must-ask questions. HRVoice, an AI voice agent, phones each candidate and sends
          you the recording, transcript and answers.
        </p>
        <div className="site-rise mt-9 flex flex-wrap justify-center gap-3" style={rise(0.4)}>
          <Link href={SIGNUP_HREF} className={siteButton('paper')}>
            Start a pilot
          </Link>
          <a href="#sample-call-card" className={siteButton('frost')}>
            Hear a sample call
          </a>
        </div>
        <p
          className="site-rise m-0 mt-5 max-w-[30rem] text-[0.875rem] leading-relaxed text-white [text-shadow:0_1px_10px_rgb(9_27_46/0.55)]"
          style={rise(0.45)}
        >
          Test calls in your browser. No calling number needed to start.
        </p>
        {/* The glass object in the scene: a call in progress, rising out of the grass under the buttons. */}
        <div
          className="site-rise mt-16 hidden h-[22rem] w-full max-w-[31rem] text-left md:flex"
          style={rise(0.6)}
        >
          <LiveCall className="w-full" />
        </div>
      </div>
    </section>
  );
}
