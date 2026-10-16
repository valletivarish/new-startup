import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '../ui/cn';
import { CONTAINER, Italic, SECTION, SIGNUP_HREF, siteButton } from './kit';

/** What the pilot includes. No numbers and no tiers anywhere in this section. */
export const INCLUDED = [
  'Test calls in your browser',
  'Calls to candidates’ phones, once your calling number is set up',
  'Recordings, transcripts and answers',
  'Your whole team. You choose who can hear recordings.',
  'Reports on your own calls',
] as const;

/** The pilot in order, from the FAQ's "What happens after I start a pilot?". No new promises. */
export const PILOT_STEPS = [
  { title: 'Add one real job', body: 'Create your account, add the job and the questions every candidate must answer.' },
  { title: 'Hear it first', body: 'Try test calls in your browser and hear exactly what candidates will hear.' },
  { title: 'Agree the price', body: 'We set up your company’s calling number with you and agree the price per call.' },
  { title: 'Call candidates', body: 'HRVoice phones each candidate. You pay for each completed call.' },
] as const;

/**
 * Website section 6 (#pricing): one pilot, no published prices. The terms sit on the app's
 * own sky-blue card (D2), so the website and the product share a surface; what's included sits
 * beside it on the black.
 */
export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={CONTAINER}>
        <h2 data-reveal id="pricing-title" className="site-h2 m-0 max-w-[18ch] text-white">
          <span className="block">Pay per call,</span>
          <Italic>not per user</Italic>
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-4 md:mt-16 lg:grid-cols-12">
          <div
            data-reveal
            className="relative isolate flex min-h-[22rem] flex-col overflow-hidden rounded-[26px] p-7 text-white sm:p-9 lg:col-span-7 [background:linear-gradient(135deg,#1e56c8_0%,#2e73e0_100%)]"
          >
            <div
              aria-hidden
              className="absolute -right-24 -top-24 -z-10 size-80 rounded-full [background:radial-gradient(circle,rgb(255_255_255/0.22),transparent_70%)]"
            />
            <p className="m-0 inline-flex h-8 w-fit items-center rounded-[8px] border border-white/40 px-3 text-[0.8125rem] font-medium">
              Pilot
            </p>
            <p className="m-0 mt-8 max-w-[18ch] text-[clamp(1.75rem,1.2rem+1.6vw,2.5rem)] font-normal leading-[1.08] tracking-[-0.035em]">
              Start on one real job. <Italic>Agree the price first.</Italic>
            </p>
            <p className="m-0 mt-5 max-w-[34rem] text-[1rem] leading-relaxed text-white/85">
              You pay for each completed screening call. We agree the price per call with you before any real
              candidate is called. No fee per user.
            </p>
            <div className="mt-auto pt-9">
              <Link href={SIGNUP_HREF} className={siteButton('paper')}>
                Start a pilot
              </Link>
            </div>
          </div>

          <div data-reveal className="rounded-[26px] border border-site-line bg-site-raised p-7 sm:p-9 lg:col-span-5">
            <h3 className="m-0 text-[1.0625rem] font-medium text-white">Included in the pilot</h3>
            <ul role="list" className="m-0 mt-6 grid list-none gap-4 p-0">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-3 text-[1rem] leading-relaxed text-site-fg-2">
                  <span aria-hidden className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-site-lime text-site-black">
                    <Check strokeWidth={3} className="size-3" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div data-reveal className="mt-16 md:mt-20">
          <h3 className="m-0 text-[1.0625rem] font-medium text-white">How the pilot goes</h3>
          <ol role="list" className="m-0 mt-6 grid list-none grid-cols-1 gap-x-6 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {PILOT_STEPS.map(({ title, body }, i) => (
              <li key={title} className="border-t border-site-line pt-5">
                <span className="block text-[0.8125rem] font-medium tabular-nums text-site-lime">Step {i + 1}</span>
                <span className="mt-2 block text-[1.0625rem] font-medium tracking-[-0.01em] text-white">{title}</span>
                <span className="mt-1.5 block max-w-[30ch] text-[0.9375rem] leading-relaxed text-site-fg-2">{body}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
