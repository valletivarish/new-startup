import Link from 'next/link';
import { Agent } from '../brand/agent';
import { cn } from '../ui/cn';
import { BRAND } from '../../lib/brand';
import { CONTAINER, SIGN_IN_HREF, SIGNUP_HREF } from './kit';
import { SECTIONS } from './nav';

const LINK =
  'inline-flex min-h-11 items-center text-[0.9375rem] text-site-fg-2 no-underline transition-colors duration-200 hover:text-white';

/** The black footer: the brand and its line, the page's sections, the account links. */
export function SiteFooter() {
  return (
    <footer className="border-t border-site-line">
      <div className={cn(CONTAINER, 'grid grid-cols-1 gap-12 py-16 md:grid-cols-12 md:py-20')}>
        <div className="md:col-span-6">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-[10px] text-[1.0625rem] font-medium text-white no-underline"
          >
            <Agent colour="pearl" size={30} follow hoverable />
            {BRAND.name}
          </Link>
          <p className="m-0 mt-4 max-w-[30ch] text-[0.9375rem] leading-relaxed text-site-fg-2">{BRAND.tagline}</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 md:col-span-6">
          <div>
            <h2 className="m-0 text-[0.8125rem] font-medium text-site-fg-3">On this page</h2>
            <ul role="list" className="m-0 mt-3 grid list-none gap-1 p-0">
              {SECTIONS.map(({ href, label }) => (
                <li key={href}>
                  <a href={href} className={LINK}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="m-0 text-[0.8125rem] font-medium text-site-fg-3">Account</h2>
            <ul role="list" className="m-0 mt-3 grid list-none gap-1 p-0">
              <li>
                <Link href={SIGN_IN_HREF} className={LINK}>
                  Sign in
                </Link>
              </li>
              <li>
                <Link href={SIGNUP_HREF} className={LINK}>
                  Start a pilot
                </Link>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      {/* Room under the last line for the chat button, which stays fixed in the bottom corner. */}
      <div className={cn(CONTAINER, 'flex flex-wrap justify-between gap-x-8 gap-y-2 border-t border-site-line pb-24 pt-6')}>
        <p className="m-0 text-[0.8125rem] text-site-fg-3">
          © {new Date().getFullYear()} {BRAND.name}
        </p>
        <p className="m-0 text-[0.8125rem] text-site-fg-3">Names, calls and photos on this page are illustrative.</p>
      </div>
    </footer>
  );
}
