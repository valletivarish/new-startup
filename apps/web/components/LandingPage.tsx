'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Briefcase, Home, Phone, Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { VoiceWaveform } from '@/components/calls/VoiceWaveform';
import { SmoothScroll } from '@/components/landing/SmoothScroll';
import { ProductStory } from '@/components/landing/ProductStory';
import { BrandLink, WaveMark } from '@/components/brand/WaveMark';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Home', icon: Home },
  { label: 'Jobs', icon: Briefcase, active: true },
  { label: 'People', icon: Users },
  { label: 'Activity', icon: Phone },
] as const;

const JOBS = [
  {
    title: 'Java Backend Developer',
    created: '12 Sep · 10:24',
    next: 'Screen 4',
  },
  {
    title: 'Java Backend Developer',
    created: '4 Sep · 16:08',
    next: 'Add people',
  },
  {
    title: 'Frontend Engineer',
    created: '28 Aug · 09:41',
    next: 'Review 2',
  },
] as const;

function JobsPreview() {
  return (
    <div className="preview-frame w-full min-w-0 overflow-hidden" aria-hidden>
      <div className="flex min-h-[18rem] sm:min-h-[22rem] lg:min-h-[26rem]">
        <aside className="flex w-12 shrink-0 flex-col border-r border-[var(--separator-subtle)] bg-[var(--surface-secondary)] sm:w-36 lg:w-44">
          <div className="border-b border-[var(--separator-subtle)] px-2 py-3 sm:px-3.5 sm:py-3.5">
            <p className="m-0 hidden font-display text-[12px] font-semibold tracking-tight sm:block">
              Hiring desk
            </p>
            <p className="m-0 mt-0.5 hidden truncate text-[11px] text-[var(--foreground-tertiary)] sm:block">
              Hiring desk
            </p>
            <span className="mx-auto flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] sm:hidden">
              <Briefcase className="h-3.5 w-3.5 text-[var(--accent)]" />
            </span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 p-1.5 sm:p-2">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = 'active' in item && item.active;
              return (
                <span
                  key={item.label}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md px-2 py-2 text-[12px] font-medium transition-colors duration-fast sm:justify-start sm:px-2.5',
                    active
                      ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                      : 'text-[var(--foreground-tertiary)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden truncate sm:inline">{item.label}</span>
                </span>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 bg-[var(--surface)] p-4 sm:p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 font-display text-base font-semibold tracking-tight sm:text-lg">
                Jobs
              </p>
              <p className="m-0 mt-0.5 text-[11px] text-[var(--foreground-tertiary)] sm:text-[12px]">
                Open roles ready to screen
              </p>
            </div>
            <span className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md bg-[var(--accent)] px-3 text-[12px] font-semibold text-[var(--accent-foreground)]">
              Create job
            </span>
          </div>
          <div className="mt-5 sm:mt-6">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--separator-subtle)] pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
              <span>Job title</span>
              <span>Status</span>
            </div>
            {JOBS.map((job) => (
              <div
                key={job.title + job.created}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--separator-subtle)] py-3 last:border-b-0 sm:py-3.5"
              >
                <div className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">
                    {job.title}
                  </span>
                  <p className="m-0 mt-0.5 truncate text-[11px] text-[var(--foreground-tertiary)]">
                    Created {job.created}
                  </p>
                </div>
                <span className="shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                  {job.next}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CallMonitorPreview() {
  return (
    <div className="preview-frame mx-auto mt-12 max-w-3xl overflow-hidden" aria-hidden>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--separator-subtle)] px-5 py-4 md:px-6">
        <div className="min-w-0">
          <p className="m-0 font-display text-base font-semibold tracking-tight">
            Call Monitor
          </p>
          <p className="m-0 mt-1 text-[12px] text-[var(--foreground-tertiary)]">
            Job · Java Backend Developer
            <span className="text-[var(--foreground-muted)]"> · </span>
            <span className="font-mono tabular-nums tracking-tight text-[var(--foreground-muted)]">
              Ref A3F91C02
            </span>
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-[var(--surface-secondary)] px-2.5 py-1 font-mono text-[11px] font-medium tabular-nums text-[var(--foreground-secondary)]">
          02:14
        </span>
      </div>
      <div className="p-5 md:p-6">
        <div className="rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--background-secondary)] text-[12px] font-semibold text-[var(--foreground-secondary)]">
              PS
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[15px] font-semibold">Priya S</p>
                <span className="rounded-sm bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-foreground)]">
                  Speaking
                </span>
              </div>
              <p className="m-0 mt-0.5 text-[12px] text-[var(--foreground-tertiary)]">
                Live phone screen
              </p>
            </div>
          </div>

          <VoiceWaveform className="mt-10 h-20" active />

          <div className="mt-8 space-y-3 border-t border-[var(--separator-subtle)] pt-5">
            <div>
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
                Hiring voice
              </p>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-[var(--foreground-secondary)]">
                Walk me through a production API you owned end to end.
              </p>
            </div>
            <div>
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--accent)]">
                Candidate
              </p>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-[var(--foreground)]">
                Spring Boot order service — owned the REST layer and notice is
                thirty days.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPageView() {
  const reduce = useReducedMotion();
  const ease = [0.22, 1, 0.36, 1] as const;
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setScrolled(!entry.isIntersecting);
      },
      { rootMargin: '-1px 0px 0px 0px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <SmoothScroll>
      <div className="surface-grain min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
        <div ref={sentinelRef} className="pointer-events-none h-px w-full" aria-hidden />
        <header
          className={cn(
            'material sticky top-0 z-40 border-b transition-[border-color,box-shadow] duration-fast ease-out',
            scrolled
              ? 'border-[var(--separator)] shadow-[var(--shadow-md)]'
              : 'border-[var(--separator-subtle)] shadow-none',
          )}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-5 md:px-8">
            <div className="flex min-w-0 items-center gap-6 lg:gap-10">
              <BrandLink
                animate
                className="min-w-0 text-[14px] sm:gap-2.5 sm:text-[15px]"
                labelClassName="max-[340px]:sr-only"
              />
              <nav className="hidden items-center gap-0.5 md:flex" aria-label="Page">
                <a
                  href="#how"
                  className="rounded-md px-3 py-2 text-[13px] font-medium text-[var(--foreground-tertiary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  Product
                </a>
                <a
                  href="#walkthrough"
                  className="rounded-md px-3 py-2 text-[13px] font-medium text-[var(--foreground-tertiary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  How it works
                </a>
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
              <ThemeToggle />
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="px-2 text-[13px] sm:px-3"
              >
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="px-2.5 sm:px-3">
                <Link href="/login?mode=register">Start hiring</Link>
              </Button>
            </div>
          </div>
        </header>

        <main>
          <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-14 pt-4 sm:gap-10 sm:px-6 sm:pb-16 sm:pt-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12 lg:px-8 lg:pb-28 lg:pt-12 xl:gap-14">
            <div className="min-w-0">
              <motion.div
                className="flex flex-col items-start gap-4 sm:gap-5"
                initial={reduce ? false : { y: 14 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.55, ease }}
              >
                <WaveMark
                  size="hero"
                  animate
                  className="origin-bottom scale-[0.78] sm:scale-100"
                />
                <p className="m-0 max-w-[12ch] font-display text-[clamp(2.25rem,8.5vw,4.5rem)] font-semibold leading-[0.92] tracking-[-0.05em]">
                  Hiring desk
                </p>
              </motion.div>
              <motion.h1
                className="mt-4 mb-0 max-w-[18ch] text-[clamp(1.2rem,3.6vw,1.85rem)] font-semibold leading-snug tracking-tight text-[var(--foreground-secondary)] sm:mt-5 sm:max-w-[15ch]"
                initial={reduce ? false : { y: 10 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.5, delay: reduce ? 0 : 0.06, ease }}
              >
                Phone screens for every open role.
              </motion.h1>
              <motion.p
                className="mt-3 mb-0 max-w-[36ch] text-[14px] leading-relaxed text-[var(--foreground-tertiary)] sm:mt-4 sm:text-[15px]"
                initial={reduce ? false : { y: 8 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.45, delay: reduce ? 0 : 0.1, ease }}
              >
                Create a job, add people, and let your hiring voice call with
                that role’s description.
              </motion.p>
              <motion.div
                className="mt-7 flex flex-wrap gap-2.5 sm:mt-8 sm:gap-3"
                initial={reduce ? false : { y: 6 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.4, delay: reduce ? 0 : 0.14, ease }}
              >
                <Button asChild size="lg" className="min-w-[8.5rem] flex-1 sm:flex-none sm:min-w-[9rem]">
                  <Link href="/login?mode=register">Start hiring</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="min-w-[8.5rem] flex-1 sm:flex-none">
                  <a href="#walkthrough">How it works</a>
                </Button>
              </motion.div>
            </div>
            <motion.div
              className="min-w-0 w-full"
              initial={reduce ? false : { y: 16 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.55, delay: reduce ? 0 : 0.1, ease }}
            >
              <JobsPreview />
            </motion.div>
          </section>

          <section
            id="how"
            className="scroll-mt-24 border-y border-[var(--separator-subtle)] bg-[var(--surface)] px-4 py-16 sm:px-6 md:px-8 md:py-24"
          >
            <div className="mx-auto max-w-6xl text-center">
              <h2 className="m-0 text-balance font-display text-[clamp(1.65rem,3.2vw,2.35rem)] font-semibold tracking-[-0.035em]">
                Every call follows the job.
              </h2>
              <p className="mx-auto mt-3 mb-0 max-w-md text-[15px] text-[var(--foreground-tertiary)]">
                Paste the description once. Phone screens for that role use it.
              </p>
              <CallMonitorPreview />
            </div>
          </section>

          <ProductStory />

          <section className="border-t border-[var(--separator-subtle)] bg-[var(--surface)]">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:px-8 md:py-24">
              <h2 className="m-0 max-w-lg font-display text-[clamp(1.65rem,3.2vw,2.35rem)] font-semibold tracking-[-0.035em]">
                Ready to screen your next role?
              </h2>
              <p className="mt-3 mb-0 max-w-md text-[15px] text-[var(--foreground-tertiary)]">
                Create a workspace, open a role, add people, and start calling —
                setup stays simple.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className="min-w-[9.5rem]">
                  <Link href="/login?mode=register">Start hiring</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#walkthrough">See the walkthrough</a>
                </Button>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-[var(--separator-subtle)] bg-[var(--surface)] px-4 py-12 sm:px-6 md:px-8 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-6 border-b border-[var(--separator-subtle)] pb-10 md:flex-row md:items-end md:justify-between md:gap-8 md:pb-12">
              <div className="max-w-md">
                <BrandLink animate className="text-[15px]" />
                <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--foreground-tertiary)]">
                  Phone screens that stay on the job — for hiring teams who need
                  clear answers from each screen.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="sm">
                  <Link href="/login?mode=register">Start hiring</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-8 pt-10 sm:grid-cols-2 sm:gap-10 sm:pt-12 lg:grid-cols-4">
              <div>
                <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                  Product
                </p>
                <ul className="mt-4 m-0 list-none space-y-2.5 p-0 text-sm">
                  <li>
                    <a
                      href="#how"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Why each role gets its own screen
                    </a>
                  </li>
                  <li>
                    <a
                      href="#walkthrough"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      How it works
                    </a>
                  </li>
                  <li>
                    <Link
                      href="/login?mode=register"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Start hiring
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/login"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Sign in
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                  Workspace
                </p>
                <ul className="mt-4 m-0 list-none space-y-2.5 p-0 text-sm">
                  <li>
                    <Link
                      href="/dashboard"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Home
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/jobs"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Jobs
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/candidates"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      People
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/settings"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Settings
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/knowledge"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Documents
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                  Activity
                </p>
                <ul className="mt-4 m-0 list-none space-y-2.5 p-0 text-sm">
                  <li>
                    <Link
                      href="/calls"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Activity
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/analytics"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Analytics
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/settings"
                      className="rounded-sm text-[var(--foreground-secondary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      Settings
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                  How we screen
                </p>
                <ul className="mt-4 m-0 list-none space-y-2.5 p-0 text-sm text-[var(--foreground-tertiary)]">
                  <li>Phone screens follow each role’s description</li>
                  <li>People stay with the job they applied for</li>
                  <li>You decide who moves forward — we only report what was said</li>
                </ul>
              </div>
            </div>

            <div className="mt-10 flex flex-col gap-3 border-t border-[var(--separator-subtle)] pt-6 text-[13px] text-[var(--foreground-muted)] sm:mt-14 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <span suppressHydrationWarning>
                © {new Date().getFullYear()} Hiring desk
              </span>
              <span className="sm:text-right">
                Phone screens for hiring teams in India
              </span>
            </div>
          </div>
        </footer>
      </div>
    </SmoothScroll>
  );
}
