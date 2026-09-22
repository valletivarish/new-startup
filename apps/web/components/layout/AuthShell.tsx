'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrandLink, WaveMark } from '@/components/brand/WaveMark';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

/**
 * Auth pages: brand panel + form. Brand reads as the hero on large screens;
 * form stays the only interactive surface.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="surface-grain grid min-h-dvh bg-[var(--background)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <aside className="relative hidden overflow-hidden flex-col justify-between border-r border-[var(--separator-subtle)] bg-[var(--surface)] px-10 py-10 lg:flex xl:px-14">
        {/* Soft voice-line wash — atmosphere without glow/gradient SaaS cliché */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          aria-hidden
          style={{
            background:
              'radial-gradient(120% 80% at 0% 100%, color-mix(in srgb, var(--accent-soft) 28%, transparent), transparent 55%), radial-gradient(90% 60% at 100% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 50%)',
          }}
        />
        <div className="relative z-[1] flex h-full flex-col justify-between">
          <BrandLink className="text-[15px]" />
          <div className="max-w-sm">
            <WaveMark
              size="hero"
              animate
              className="mb-8 origin-bottom scale-90"
            />
            <p className="m-0 font-display text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
              Phone screens for every open role.
            </p>
            <p className="mt-4 mb-0 text-[15px] leading-relaxed text-[var(--foreground-tertiary)]">
              Open a role, add people, and let your hiring voice call them with
              that job’s description. You decide who moves forward.
            </p>
          </div>
          <p className="m-0 text-[13px] text-[var(--foreground-muted)]">
            <Link
              href="/"
              className="rounded-sm text-[var(--foreground-tertiary)] no-underline transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Back to home
            </Link>
          </p>
        </div>
      </aside>

      <div className="flex flex-col px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex items-center justify-between gap-3 lg:mb-10 lg:justify-end">
          <BrandLink className="text-[15px] lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center">
          {children}
        </div>
        <p className="mt-8 mb-0 text-center text-[13px] text-[var(--foreground-muted)] lg:hidden">
          Phone screens for every open role.
        </p>
      </div>
    </main>
  );
}
