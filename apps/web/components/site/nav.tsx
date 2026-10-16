import Link from 'next/link';
import { cn } from '../ui/cn';
import { BRAND } from '../../lib/brand';
import { CONTAINER, SIGN_IN_HREF, SIGNUP_HREF, siteButton } from './kit';
import { SiteMenu, type SiteMenuLink } from './menu';
import { NavAgent } from './nav-liquid';

/** The page's sections, in page order: the header's nav group, and the menu below 1024px. */
export const SECTIONS: readonly SiteMenuLink[] = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
  { href: '#use-cases', label: 'Use cases' },
];

/**
 * The header over the hero photo: the brand, a frosted group of section links in the middle,
 * Sign in and the white "Start a pilot" on the right. It scrolls away with the hero.
 * Below 1024px the links move into the menu sheet; below 640px Sign in does too.
 */
export function SiteNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className={cn(CONTAINER, 'flex h-20 items-center justify-between gap-4 md:h-24')}>
        <Link
          href="/"
          className="inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-[10px] text-[1.0625rem] font-medium tracking-[-0.01em] text-white no-underline"
        >
          <NavAgent size={30} />
          <span className="truncate">{BRAND.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul role="list" className="site-frost m-0 flex list-none items-center gap-0.5 rounded-[12px] p-1">
            {SECTIONS.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex h-9 items-center rounded-[9px] px-4 text-[0.9375rem] text-white/90 no-underline transition-colors duration-200 hover:bg-white/15 hover:text-white"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={SIGN_IN_HREF}
            className="hidden h-11 items-center rounded-[10px] px-3 text-[0.9375rem] text-white/90 no-underline transition-colors duration-200 hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link href={SIGNUP_HREF} className={cn(siteButton('paper', 'md'), 'max-sm:hidden')}>
            Start a pilot
          </Link>
          <SiteMenu links={SECTIONS} className="lg:hidden" />
        </div>
      </div>
    </header>
  );
}
