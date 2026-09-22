'use client';

import { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useReducedMotion } from 'motion/react';
import { VoiceWaveform } from '@/components/calls/VoiceWaveform';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const CHAPTERS = [
  {
    id: 'job',
    label: 'Create a job',
    title: 'Save the description on the role.',
    body: 'Name the role, paste the description once, and add any questions you want asked. Every phone screen for this opening uses that setup.',
    panel: 'job' as const,
  },
  {
    id: 'candidates',
    label: 'Add candidates',
    title: 'People belong to the role they applied for.',
    body: 'Add one person or upload a CSV on that job. Duplicate phones on the same job are blocked so your list stays clean.',
    panel: 'candidates' as const,
  },
  {
    id: 'screen',
    label: 'Screen by phone',
    title: 'Calls follow this role’s description.',
    body: 'Try a browser screen first, then Call phone when your line is connected. You watch clear status while it runs.',
    panel: 'screen' as const,
  },
  {
    id: 'review',
    label: 'Review answers',
    title: 'Transcript and answers land on the candidate.',
    body: 'Read what was said, ask about the call, then move the person forward yourself. The product never recommends hire or reject.',
    panel: 'review' as const,
  },
] as const;

function StoryPanel({ kind }: { kind: (typeof CHAPTERS)[number]['panel'] }) {
  if (kind === 'job') {
    return (
      <div className="space-y-0 p-5 md:p-6">
        <p className="m-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
          Job setup
        </p>
        <div className="mt-4 divide-y divide-[var(--separator-subtle)]">
          <div className="py-3 first:pt-0">
            <p className="m-0 text-[11px] text-[var(--foreground-muted)]">Role</p>
            <p className="m-0 mt-1 text-[14px] font-semibold">
              Java Backend Developer
            </p>
            <p className="m-0 mt-0.5 font-mono text-[11px] tabular-nums tracking-tight text-[var(--foreground-muted)]">
              Ref A3F91C02
            </p>
          </div>
          <div className="py-3">
            <p className="m-0 text-[11px] text-[var(--foreground-muted)]">
              Job description
            </p>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-[var(--foreground-secondary)]">
              2–4 years Spring Boot. Own REST APIs end to end. Notice period
              under 60 days.
            </p>
          </div>
          <div className="py-3 last:pb-0">
            <p className="m-0 text-[11px] text-[var(--foreground-muted)]">
              Must-ask (optional)
            </p>
            <p className="m-0 mt-1 text-[13px] text-[var(--foreground-secondary)]">
              Walk through a production API you owned.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'candidates') {
    return (
      <div className="space-y-0 p-5 md:p-6">
        <p className="m-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
          On this job
        </p>
        <ul className="m-0 mt-4 list-none divide-y divide-[var(--separator-subtle)] p-0">
          {[
            ['Priya S', 'Mobile saved'],
            ['Rahul Sharma', 'CSV import'],
            ['Asha Patel', 'Added today'],
          ].map(([name, meta]) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="text-[14px] font-semibold">{name}</span>
              <span className="text-[12px] text-[var(--foreground-tertiary)]">
                {meta}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (kind === 'screen') {
    return (
      <div className="space-y-4 p-5 md:p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="m-0 text-[15px] font-semibold">Priya S</p>
            <p className="m-0 mt-0.5 text-[12px] text-[var(--foreground-tertiary)]">
              Java Backend Developer
              <span className="text-[var(--foreground-muted)]"> · </span>
              <span className="font-mono tabular-nums tracking-tight text-[var(--foreground-muted)]">
                Ref A3F91C02
              </span>
            </p>
          </div>
          <span className="rounded-sm bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-foreground)]">
            Speaking
          </span>
        </div>
        <VoiceWaveform active className="py-2" />
        <p className="m-0 text-center text-[12px] text-[var(--foreground-tertiary)]">
          Live phone screen · 02:14
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0 p-5 md:p-6">
      <p className="m-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
        After the call
      </p>
      <div className="mt-4 divide-y divide-[var(--separator-subtle)]">
        <div className="py-3 first:pt-0">
          <p className="m-0 text-[11px] text-[var(--foreground-muted)]">Summary</p>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-[var(--foreground-secondary)]">
            Covered Spring Boot experience and notice period. Answers recorded on
            this candidate.
          </p>
        </div>
        <div className="py-3">
          <p className="m-0 text-[11px] text-[var(--foreground-muted)]">
            Ask about this screen
          </p>
          <p className="m-0 mt-1 text-[13px] text-[var(--foreground-secondary)]">
            “What did they say about notice period?” → 30 days.
          </p>
        </div>
        <p className="m-0 py-3 last:pb-0 text-[12px] text-[var(--foreground-tertiary)]">
          You choose the next stage from what they said on the call.
        </p>
      </div>
    </div>
  );
}

export function ProductStory() {
  const rootRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  useGSAP(
    () => {
      if (!rootRef.current || reduce) return;
      const sections = gsap.utils.toArray<HTMLElement>(
        rootRef.current.querySelectorAll('[data-story-chapter]'),
      );
      sections.forEach((section, i) => {
        ScrollTrigger.create({
          trigger: section,
          start: 'top center',
          end: 'bottom center',
          onToggle: (self) => {
            if (self.isActive) setActive(i);
          },
        });
      });
      ScrollTrigger.refresh();
    },
    { scope: rootRef, dependencies: [reduce] },
  );

  function goToChapter(index: number) {
    setActive(index);
    const section = rootRef.current?.querySelectorAll<HTMLElement>(
      '[data-story-chapter]',
    )[index];
    if (!section) return;
    const lenis = (window as unknown as { __landingLenis?: { scrollTo: (el: HTMLElement, opts?: object) => void } }).__landingLenis;
    if (lenis) {
      lenis.scrollTo(section, { offset: -96 });
    } else {
      section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }

  return (
    <section
      ref={rootRef}
      id="walkthrough"
      className="scroll-mt-24 border-y border-[var(--separator-subtle)] bg-[var(--background)]"
      aria-label="How the product works"
    >
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:px-8 md:py-24">
        <div className="max-w-xl">
          <p className="m-0 text-[13px] font-semibold text-[var(--accent)]">
            Product walkthrough
          </p>
          <h2 className="mt-2 mb-0 font-display text-[clamp(1.65rem,3.2vw,2.35rem)] font-semibold tracking-[-0.035em]">
            From open role to clear answers — without leaving the job.
          </h2>
        </div>

        <div className="mt-12 space-y-12 md:hidden">
          {CHAPTERS.map((ch) => (
            <article key={ch.id} className="space-y-4">
              <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--accent)]">
                {ch.label}
              </p>
              <h3 className="m-0 font-display text-xl font-semibold tracking-tight">
                {ch.title}
              </h3>
              <p className="m-0 text-[15px] leading-relaxed text-[var(--foreground-tertiary)]">
                {ch.body}
              </p>
              <div className="preview-frame overflow-hidden bg-[var(--surface-secondary)]">
                <StoryPanel kind={ch.panel} />
              </div>
            </article>
          ))}
        </div>

        <div className="mt-16 hidden gap-14 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="space-y-28 pb-8">
            {CHAPTERS.map((ch, i) => (
              <article
                key={ch.id}
                data-story-chapter
                className={cn(
                  'max-w-md transition-opacity duration-slow ease-out',
                  reduce || active === i ? 'opacity-100' : 'opacity-40',
                )}
              >
                <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--accent)]">
                  {String(i + 1).padStart(2, '0')} · {ch.label}
                </p>
                <h3 className="mt-3 mb-0 font-display text-[1.5rem] font-semibold leading-snug tracking-tight">
                  {ch.title}
                </h3>
                <p className="mt-3 mb-0 text-[15px] leading-relaxed text-[var(--foreground-tertiary)]">
                  {ch.body}
                </p>
              </article>
            ))}
          </div>

          <div className="relative min-h-full">
            <div className="preview-frame sticky top-[4.75rem] overflow-hidden bg-[var(--surface-secondary)]">
              <div
                className="flex flex-wrap gap-1 border-b border-[var(--separator-subtle)] px-3 py-2.5"
                role="tablist"
                aria-label="Walkthrough steps"
              >
                {CHAPTERS.map((ch, i) => (
                  <button
                    key={ch.id}
                    type="button"
                    role="tab"
                    aria-selected={active === i}
                    onClick={() => goToChapter(i)}
                    className={cn(
                      'rounded-md border-0 px-2.5 py-1 text-[11px] font-medium transition-colors duration-fast',
                      active === i
                        ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                        : 'bg-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]',
                    )}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
              <StoryPanel kind={CHAPTERS[active]?.panel ?? 'job'} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
