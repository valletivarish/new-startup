'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Button } from '../ui/button';
import { SIGN_IN_HREF, SIGNUP_HREF } from './kit';
import { IconButton } from '../ui/icon-button';
import { cn } from '../ui/cn';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';

export interface SiteMenuLink {
  /** A section on the page ("#pricing") or another page on the site ("/developers"). */
  href: `#${string}` | `/${string}`;
  label: string;
}

export interface SiteMenuProps {
  /** The page's sections, in page order. */
  links: readonly SiteMenuLink[];
  /** The menu button. */
  className?: string;
}

/**
 * The website's menu below 1024px, where the header's nav group doesn't show: a frosted menu
 * button opening a bottom sheet with the sections and Sign in. Following a link closes the
 * sheet and moves focus to the section it jumped to.
 * <SiteMenu links={[{ href: '#pricing', label: 'Pricing' }]} className="lg:hidden" />
 */
export function SiteMenu({ links, className }: SiteMenuProps) {
  const [open, setOpen] = useState(false);
  // The section a link jumped to, so closing the sheet can hand focus there.
  const jumpedTo = useRef<string | null>(null);

  // Focus follows the jump instead of returning to the menu button. Without a target, Sheet's default applies.
  const focusSection = (event: Event) => {
    const id = jumpedTo.current;
    jumpedTo.current = null;
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <IconButton
          label="Menu"
          // Frosted over the sky photo, like the header's other controls.
          className={cn(
            'rounded-[10px] border-white/25 bg-white/15 text-white backdrop-blur-md hover:bg-white/25',
            className,
          )}
        >
          <Menu aria-hidden strokeWidth={1.5} />
        </IconButton>
      </SheetTrigger>
      <SheetContent side="bottom" aria-describedby={undefined} onCloseAutoFocus={focusSection}>
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <SheetBody className="pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <nav aria-label="Main">
            <ul role="list" className="m-0 grid list-none gap-1 p-0">
              {links.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={() => {
                      jumpedTo.current = href.startsWith('#') ? href.slice(1) : null;
                      setOpen(false);
                    }}
                    className="flex min-h-12 items-center rounded-input px-3 text-title font-medium text-text transition-colors duration-fast hover:bg-subtle"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Button asChild size="lg" className="mt-5 w-full">
            <Link href={SIGNUP_HREF} onClick={() => setOpen(false)}>
              Create account
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg" className="mt-2 w-full">
            <Link href={SIGN_IN_HREF} onClick={() => setOpen(false)}>
              Sign in
            </Link>
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
