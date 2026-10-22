import Image, { type StaticImageData } from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../ui/cn';
import type { SiteMenuLink } from './menu';

/*
  Shared by the website sections (Synergos styling). Server-safe: no 'use client'.
*/

/** The one signup route. Its label is always "Start a pilot". */
export const SIGNUP_HREF = '/login?mode=register';
export const SIGN_IN_HREF = '/login';

/** The website's wordmark: the live module. The platform name stays off the site until it is chosen. */
export const WORDMARK = 'HRVoice';

/** The page's sections, in page order: the header's links, the menu sheet and the footer. */
export const SECTIONS: readonly SiteMenuLink[] = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

/** The header's links: the page's sections plus the one real page beyond them. */
export const HEADER_LINKS: readonly SiteMenuLink[] = [...SECTIONS, { href: '/developers', label: 'Developers' }];

/** The website container: 1280px wide, 20px gutters on phones, 32px from md, 48px from lg. */
export const CONTAINER = 'mx-auto w-full max-w-[80rem] px-5 md:px-8 lg:px-12';

/** The vertical rhythm between dark sections. */
export const SECTION = 'py-16 md:py-32';


type Tone = 'ink' | 'paper' | 'frost';

const TONE: Record<Tone, string> = {
  ink: 'bg-site-black text-white hover:bg-[#1c1d1f]',
  paper: 'bg-white text-site-black hover:bg-[#e9ebee]',
  frost: 'site-frost text-white hover:bg-white/25',
};

/**
 * Soft-cornered buttons, the reference's shape (10px, not pills). For links and buttons alike:
 * <Link className={siteButton('paper')} href={SIGNUP_HREF}>Start a pilot</Link>
 */
export function siteButton(tone: Tone, size: 'md' | 'lg' = 'lg') {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-transparent font-medium no-underline',
    'transition-[background-color,scale] duration-200 motion-safe:active:[scale:0.98] [&_svg]:size-4 [&_svg]:shrink-0',
    // These buttons sit on photos and black, where the app's slate ring disappears: a white
    // ring over a thin black gap shows on sky, on black and beside a white button.
    'focus-visible:outline-white focus-visible:[box-shadow:0_0_0_2px_#050505]',
    size === 'lg' ? 'h-12 px-6 text-[0.9375rem]' : 'h-10 px-4 text-[0.875rem] [@media(pointer:coarse)]:h-11',
    tone === 'frost' && 'border-[var(--site-frost-border)]',
    TONE[tone],
  );
}

/**
 * The small outlined label above a heading: a ring and a few words. Lime on black, white on
 * the sky. Used on a few sections, not all of them.
 */
export function Tag({
  children,
  tone = 'dark',
  live = false,
  className,
  style,
}: {
  children: ReactNode;
  tone?: 'dark' | 'sky';
  /** Something live right now: a filled lime dot instead of the ring. */
  live?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <p
      style={style}
      className={cn(
        'm-0 inline-flex h-8 items-center gap-2 rounded-[8px] border px-3 text-[0.8125rem] font-medium',
        tone === 'dark' ? 'border-site-lime/60 text-white' : 'site-frost text-white',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2.5 shrink-0 rounded-full',
          live ? 'bg-site-lime' : cn('border-[1.5px]', tone === 'dark' ? 'border-site-lime' : 'border-white'),
        )}
      />
      {children}
    </p>
  );
}

/** The serif-italic phrase. Three on the whole page: the hero, the sample call and the closing band. */
export function Italic({ children }: { children: ReactNode }) {
  return <span className="site-italic">{children}</span>;
}

export interface PhotoFrameProps {
  photo: StaticImageData;
  /** Decorative by default: the panel on top carries the meaning. */
  alt?: string;
  sizes: string;
  className?: string;
  /** Where the photo sits in its frame. */
  position?: string;
  children?: ReactNode;
}

/**
 * A rounded photograph with something set on it: a glass panel, a product card. The photo
 * drifts a little on scroll (site motion), inside its own overflow so the frame never moves.
 */
export function PhotoFrame({ photo, alt = '', sizes, className, position = '50% 50%', children }: PhotoFrameProps) {
  return (
    <div data-photo-frame className={cn('relative isolate overflow-hidden rounded-[26px] bg-site-raised', className)}>
      <div data-photo-drift className="absolute inset-[-8%] -z-10">
        <Image
          src={photo}
          alt={alt}
          fill
          sizes={sizes}
          placeholder="blur"
          className="object-cover"
          style={{ objectPosition: position }}
        />
      </div>
      {children}
    </div>
  );
}
