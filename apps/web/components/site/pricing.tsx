'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '../ui/cn';
import { CONTAINER, SECTION, SIGNUP_HREF, siteButton } from './kit';

/** What the pilot includes. No numbers and no tiers anywhere in this section. */
export const INCLUDED = [
  'Test calls in your browser',
  'Calls to candidates’ phones, once your calling number is set up',
  'A recording, transcript, summary and answers for every call',
  'Your whole team can log in. You choose who can hear recordings.',
  'Each candidate’s call status, such as Rang out or Voicemail',
] as const;

const MIN = 20;
const MAX = 1000;
const TICKS = [20, 250, 500, 750, 1000] as const;
const count = (n: number) => n.toLocaleString('en-IN');

// The native range is the control: a white played part, a lime thumb.
const RANGE =
  'h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none ' +
  'forced-colors:appearance-auto ' +
  '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,#fff_var(--pct),rgb(255_255_255/0.18)_var(--pct))] ' +
  '[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-site-black [&::-webkit-slider-thumb]:bg-site-lime ' +
  '[&:focus-visible::-webkit-slider-thumb]:[box-shadow:0_0_0_2px_#050505,0_0_0_4px_#fff] ' +
  '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/20 ' +
  '[&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-white ' +
  '[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-site-black [&::-moz-range-thumb]:bg-site-lime ' +
  '[&:focus-visible::-moz-range-thumb]:[box-shadow:0_0_0_2px_#050505,0_0_0_4px_#fff]';

/**
 * Website section 5 (#pricing): usage pricing without a published price. Relay's calculator
 * idea, turned round: the slider sets how many candidates you screen a month and shows what
 * comes back, never a rupee figure. Beside it, what the pilot includes. The pilot's steps are
 * told once, in How it works.
 */
export function PricingSection() {
  const [candidates, setCandidates] = useState(200);
  const pct = ((candidates - MIN) / (MAX - MIN)) * 100;

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={CONTAINER}>
        <div data-reveal className="max-w-[40rem]">
          <h2 id="pricing-title" className="site-h2 m-0 text-white">
            Pay per completed call, not per user
          </h2>
          <p className="m-0 mt-5 text-[1.0625rem] leading-relaxed text-site-fg-2">
            We agree the price per completed call with you before any call goes out.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 md:mt-14 lg:grid-cols-12">
          <div data-reveal className="rounded-[26px] border border-site-line bg-site-raised p-6 sm:p-9 lg:col-span-7">
            <label htmlFor="pricing-candidates" className="block text-[0.9375rem] text-site-fg-2">
              Candidates you call each month
            </label>
            <p aria-hidden className="m-0 mt-2 text-[clamp(2.5rem,2rem+1.6vw,3.5rem)] font-normal leading-none tracking-[-0.04em] tabular-nums text-white">
              {count(candidates)}
            </p>
            <input
              id="pricing-candidates"
              type="range"
              min={MIN}
              max={MAX}
              step={10}
              value={candidates}
              aria-valuetext={`${count(candidates)} candidates a month`}
              onChange={(e) => setCandidates(Number(e.currentTarget.value))}
              style={{ '--pct': `${pct}%` } as CSSProperties}
              className={cn(RANGE, 'mt-5')}
            />
            <div aria-hidden className="mt-1 flex justify-between text-[0.75rem] tabular-nums text-site-fg-3">
              {TICKS.map((t) => (
                <span key={t}>{count(t)}</span>
              ))}
            </div>

            <output htmlFor="pricing-candidates" className="mt-6 block rounded-[18px] bg-white/[0.05] p-4 text-[0.9375rem] sm:p-5 sm:text-[1rem] leading-relaxed text-site-fg-2">
              <span className="block text-[1.125rem] tracking-[-0.01em] text-white">
                Up to {count(candidates)} screening calls a month
              </span>
              Each completed call gives you the recording, transcript, summary and answers. You pay only for
              completed calls. No fee per user.
            </output>

            <Link href={SIGNUP_HREF} className={cn(siteButton('paper'), 'mt-7')}>
              Create account
            </Link>
          </div>

          <div data-reveal className="rounded-[26px] border border-site-line p-6 sm:p-9 lg:col-span-5">
            <h3 className="m-0 text-[1.0625rem] font-medium text-white">What you get</h3>
            <ul role="list" className="m-0 mt-4 grid list-none gap-2.5 p-0 sm:gap-3.5">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-3 text-[1rem] leading-relaxed text-site-fg-2">
                  <Check aria-hidden strokeWidth={2} className="mt-1 size-4 shrink-0 text-site-lime" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
