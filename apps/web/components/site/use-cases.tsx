import Image from 'next/image';
import { Agent } from '../brand/agent';
import { cn } from '../ui/cn';
import { MODULES } from '../../lib/brand';
import { formatDuration } from '../../lib/format';
import hiringPhoto from '../../public/images/site/module-hiring.jpg';
import { CONTAINER, Italic, SECTION, Tag } from './kit';
import { SAMPLE_CALL } from './sample-data';

// The colour washes of the reference's quote cards, one per module that isn't live yet.
const WASH: Record<string, string> = {
  support: '[background:radial-gradient(120%_90%_at_10%_0%,#6b5fd8_0%,#4a3fa8_45%,#241f4f_100%)]',
  sales: '[background:radial-gradient(120%_90%_at_10%_0%,#c98a52_0%,#9a5a33_45%,#3a2216_100%)]',
  booking: '[background:radial-gradient(120%_90%_at_10%_0%,#7fa24a_0%,#4f7330_45%,#1f2e14_100%)]',
};

// The wide card has room to show the section's point: each call is set up the same three ways.
// Restates ReceptionVoice's own summary; nothing here is a feature that ships today.
const RECEPTION_SETUP = [
  { term: 'Who to call', detail: 'People with an appointment coming up' },
  { term: 'What to ask', detail: 'Can they still make it, or would they like another time?' },
  { term: 'What you get back', detail: 'Who confirmed, who moved and who cancelled' },
] as const;

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-fit items-center gap-1.5 self-start rounded-[8px] border px-2.5 text-[0.75rem] font-medium text-white',
        live ? 'border-site-lime/60' : 'border-white/30',
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', live ? 'bg-site-lime' : 'border border-white/70')} />
      {live ? 'Live now' : 'Coming later'}
    </span>
  );
}

/** A picture of a screen in progress, set on the HRVoice photograph. Sample data; hidden from assistive tech. */
function LiveCallChip() {
  const turn = SAMPLE_CALL.turns.find((t) => t.speaker === 'contact' && t.text.includes('thirty days'));
  return (
    <div aria-hidden className="site-smoke w-full max-w-[19rem] rounded-[18px] p-3.5 text-white">
      <div className="flex items-center gap-2.5">
        <Agent colour="pearl" size={22} state="listening" />
        <p className="m-0 min-w-0 flex-1 truncate text-[0.8125rem] font-medium">Calling {SAMPLE_CALL.candidate}</p>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.75rem] tabular-nums text-white/80">
          <span className="size-1.5 rounded-full bg-site-lime" />
          {formatDuration(Math.floor(turn?.at ?? 0))}
        </span>
      </div>
      <p className="m-0 mt-3 rounded-[12px] bg-white/10 px-3 py-2 text-[0.8125rem] leading-snug">{turn?.text}</p>
      <p className="m-0 mt-2.5 text-[0.75rem] text-white/70">Notice period answered. 2 of 6 done so far.</p>
    </div>
  );
}

/**
 * Website section 5 (#use-cases): one engine, a module per kind of call. HRVoice is live and
 * gets the photograph with a call in progress on it; the rest are labelled "Coming later" on colour washes, so nobody mistakes
 * a roadmap card for a product they can buy today. Four cards, four cells.
 */
export function UseCasesSection() {
  const [hiring, ...later] = MODULES;
  return (
    <section id="use-cases" aria-labelledby="use-cases-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end">
          <div data-reveal className="lg:col-span-7">
            <Tag>Use cases</Tag>
            <h2 id="use-cases-title" className="site-h2 m-0 mt-6 text-white">
              <span className="block">One platform,</span>
              <Italic>hiring first</Italic>
            </h2>
          </div>
          <p data-reveal className="m-0 max-w-[30rem] text-[1.0625rem] leading-relaxed text-site-fg-2 lg:col-span-5 lg:justify-self-end">
            Every kind of call is set up the same way: who to call, what to ask and what you get back. Hiring is
            live today. The others are coming later.
          </p>
        </div>

        <ul role="list" className="m-0 mt-14 grid list-none grid-cols-1 gap-4 p-0 md:mt-16 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
          {hiring ? (
            <li data-reveal className="md:row-span-2">
              <article className="relative isolate flex h-full min-h-[32rem] flex-col justify-between overflow-hidden rounded-[26px] p-6 md:p-7">
                <Image
                  src={hiringPhoto}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                  placeholder="blur"
                  className="-z-20 object-cover object-[60%_50%]"
                />
                <div aria-hidden className="absolute inset-0 -z-10 [background:linear-gradient(to_bottom,rgb(5_5_5/0.1)_0%,rgb(5_5_5/0)_40%,rgb(5_5_5/0.75)_100%)]" />
                <LiveCallChip />
                <div>
                  <LiveBadge live />
                  <h3 className="m-0 mt-4 text-[1.75rem] font-medium tracking-[-0.03em] text-white">{hiring.name}</h3>
                  <p className="m-0 mt-2 max-w-[30ch] text-[0.9375rem] leading-relaxed text-white/85">{hiring.summary}</p>
                </div>
              </article>
            </li>
          ) : null}
          {later.map((module, i) => (
            <li key={module.id} data-reveal className={cn(i === 2 && 'md:col-span-2')}>
              <article
                className={cn(
                  'relative flex h-full min-h-[14rem] flex-col justify-between overflow-hidden rounded-[26px] p-6 md:p-7',
                  WASH[module.id],
                )}
              >
                <LiveBadge live={false} />
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h3 className="m-0 text-[1.5rem] font-medium tracking-[-0.025em] text-white">{module.name}</h3>
                    <p className="m-0 mt-2 max-w-[36ch] text-[0.9375rem] leading-relaxed text-white/85">{module.summary}</p>
                  </div>
                  {module.id === 'booking' ? (
                    <dl className="site-smoke m-0 grid w-full gap-3 rounded-[18px] p-4 text-white lg:max-w-[22rem]">
                      {RECEPTION_SETUP.map(({ term, detail }) => (
                        <div key={term}>
                          <dt className="text-[0.75rem] font-medium text-white/65">{term}</dt>
                          <dd className="m-0 mt-0.5 text-[0.875rem] leading-snug">{detail}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
