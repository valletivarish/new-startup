import Link from "next/link";
import { Agent } from "../brand/agent";
import { cn } from "../ui/cn";
import { MODULES } from "../../lib/brand";
import { CONTACT } from "./contact";
import { SupportChat } from "./support-chat";
import {
  CONTAINER,
  SECTIONS,
  SIGN_IN_HREF,
  SIGNUP_HREF,
  WORDMARK,
} from "./kit";

const LINK =
  "inline-flex min-h-11 items-center text-[0.9375rem] text-site-fg-2 no-underline transition-colors duration-200 hover:text-white";
const HEAD = "m-0 text-[0.8125rem] font-medium text-site-fg-3";

/**
 * The footer, continuing the closing band's black (Aerosea's structure): the wordmark and its
 * line, the page's sections, the modules (HRVoice live, the rest later: the roadmap in one
 * column), the account links. Then the legal row and an oversized wordmark cropped by the
 * page's edge. Company name, Privacy and Terms show only once set in contact.ts.
 */
export function SiteFooter() {
  const legal = [
    CONTACT.privacy ? { href: CONTACT.privacy, label: "Privacy" } : null,
    CONTACT.terms ? { href: CONTACT.terms, label: "Terms" } : null,
  ].filter((l) => l !== null);
  return (
    <footer className="relative overflow-hidden">
      <div
        className={cn(
          CONTAINER,
          "grid grid-cols-2 gap-x-8 gap-y-10 pb-12 pt-4 md:grid-cols-12 md:pb-16",
        )}
      >
        <div className="col-span-2 md:col-span-5">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-[10px] text-[1.0625rem] font-medium text-white no-underline"
          >
            <Agent colour="pearl" size={30} follow hoverable />
            {WORDMARK}
          </Link>
          <p className="m-0 mt-3 max-w-[32ch] text-[0.9375rem] leading-relaxed text-site-fg-2">
            HRVoice phones your candidates and hands you the record. Made in
            India.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="col-span-2 grid grid-cols-2 gap-x-8 gap-y-10 md:col-span-7 md:grid-cols-3"
        >
          <div>
            <h2 className={HEAD}>On this page</h2>
            <ul role="list" className="m-0 mt-2 grid list-none p-0">
              {SECTIONS.map(({ href, label }) => (
                <li key={href}>
                  <a href={`/${href}`} className={LINK}>
                    {label}
                  </a>
                </li>
              ))}
              <li><Link href="/developers" className={LINK}>Developers</Link></li>
            </ul>
          </div>
          <div>
            <h2 className={HEAD}>Modules</h2>
            <ul role="list" className="m-0 mt-2 grid list-none p-0">
              {MODULES.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 text-[0.9375rem]",
                    m.live ? "text-white" : "text-site-fg-3",
                  )}
                >
                  {m.live ? (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-site-lime"
                    />
                  ) : null}
                  {m.name}
                  <span className={m.live ? "text-site-fg-2" : undefined}>
                    {m.live ? "Live" : "Later"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* Phones have Start a pilot and Sign in in the header already. */}
          <div className="hidden md:block">
            <h2 className={HEAD}>Account</h2>
            <ul role="list" className="m-0 mt-2 grid list-none p-0">
              <li>
                <Link href={SIGNUP_HREF} className={LINK}>
                  Start a pilot
                </Link>
              </li>
              <li>
                <Link href={SIGN_IN_HREF} className={LINK}>
                  Sign in
                </Link>
              </li>
              {CONTACT.email ? (
                <li>
                  <a href={`mailto:${CONTACT.email}`} className={LINK}>
                    {CONTACT.email}
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </nav>
      </div>
      <div className={cn(CONTAINER, "flex flex-wrap items-end justify-between gap-6 pb-10")}>
        <SupportChat />
        <Link href="/status" className={LINK}>
          Service status
        </Link>
      </div>
      <div className={CONTAINER}>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-1 border-t border-site-line py-4 text-[0.8125rem] text-site-fg-3">
          <p className="m-0 flex flex-wrap items-center gap-x-5">
            <span>
              © {new Date().getFullYear()} {CONTACT.company ?? WORDMARK}
            </span>
            {legal.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="inline-flex min-h-11 items-center text-site-fg-3 no-underline hover:text-white"
              >
                {l.label}
              </Link>
            ))}
          </p>
          <p className="m-0">
            Names, calls and photos on this page are illustrative.
          </p>
          <a
            href="#top"
            className="inline-flex min-h-11 items-center text-site-fg-3 no-underline hover:text-white"
          >
            Back to top ↑
          </a>
        </div>
      </div>
      {/* The oversized wordmark, cropped by the page's foot. Decorative; room under it for the chat button. */}
      <p
        aria-hidden
        className="m-0 -mb-[0.22em] select-none text-center text-[clamp(6rem,24vw,22rem)] font-normal leading-none tracking-[-0.06em] text-white/[0.06]"
      >
        {WORDMARK}
      </p>
    </footer>
  );
}
