'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowRight, FileText, Mic, PhoneCall, Users } from 'lucide-react';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { cn } from '../ui/cn';
import { SAMPLE_CALL, SAMPLE_CANDIDATES, SAMPLE_JOB, type SampleStripState } from './sample-data';
import skyPhoto from '../../public/images/site/hero.jpg';
import { CONTAINER, PhotoFrame, SECTION, SIGNUP_HREF } from './kit';

/*
  Option B, "Bento flow": all four steps on screen at once in an asymmetric grid. Each tile is
  a small product moment that loops quietly while it is in view (and holds still for reduced
  motion). Round connectors between tiles make the order read. The previews are pictures of
  the product with sample data, hidden from assistive tech; the list items carry the meaning.
*/

const QUESTIONS = SAMPLE_CALL.answers.filter((a) => !('extra' in a && a.extra)).map((a) => a.question);
const byId = (id: string) => SAMPLE_CANDIDATES.find((c) => c.id === id);

const CSS = `
@media (prefers-reduced-motion: no-preference) {
  .hiwb-live .hiwb-loop { animation: hiwb-in var(--hiwb-d, 9s) var(--hiwb-delay, 0s) infinite both; }
  .hiwb-live .hiwb-ping { animation: hiwb-ping 2.2s ease-out infinite; }
  .hiwb-live .hiwb-bar { animation: hiwb-bar 1.1s ease-in-out infinite alternate; }
  .hiwb-live .hiwb-flow { animation: hiwb-flow 2.4s ease-in-out infinite; }
}
@keyframes hiwb-in {
  0% { opacity: 0; transform: translateY(8px); }
  6%, 86% { opacity: 1; transform: none; }
  94%, 100% { opacity: 0; transform: translateY(-2px); }
}
@keyframes hiwb-ping { 0% { box-shadow: 0 0 0 0 rgb(var(--site-lime-rgb) / .55); } 80%, 100% { box-shadow: 0 0 0 8px rgb(var(--site-lime-rgb) / 0); } }
@keyframes hiwb-bar { from { transform: scaleY(.3); } to { transform: scaleY(1); } }
@keyframes hiwb-flow { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
`;

/** A row that arrives on a loop, one after another. */
function Loop({ i, children, className, d = 9 }: { i: number; children: ReactNode; className?: string; d?: number }) {
  return (
    <div
      className={cn('hiwb-loop', className)}
      style={{ ['--hiwb-delay' as string]: `${i * 0.55}s`, ['--hiwb-d' as string]: `${d}s` }}
    >
      {children}
    </div>
  );
}

function JobMoment() {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[0.9375rem] font-medium">{SAMPLE_JOB.title}</p>
        <p className="m-0 text-[0.8125rem] text-white/70">{SAMPLE_JOB.location}</p>
      </div>
      <p className="m-0 mt-3 flex items-center gap-2 rounded-[10px] bg-white/[0.08] px-3 py-2 text-[0.8125rem]">
        <FileText strokeWidth={1.75} className="size-4 shrink-0 text-white/75" />
        Job description added
      </p>
      <p className="m-0 mt-4 text-[0.8125rem] text-white/70">Must-ask questions</p>
      <ol role="list" className="m-0 mt-2 grid list-none gap-1.5 p-0">
        {QUESTIONS.map((q, i) => (
          <li key={q}>
            <Loop i={i} d={9} className="flex items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[0.875rem] leading-snug">
              <span className="w-3 shrink-0 tabular-nums text-white/60">{i + 1}</span>
              {q}
            </Loop>
          </li>
        ))}
      </ol>
    </div>
  );
}

const SOURCES = [
  ['kavya', 'From resume'],
  ['rohan', 'From CSV'],
  ['ananya', 'From careers form'],
  ['farhan', 'From resume'],
  ['divya', 'From CSV'],
] as const;

function PeopleMoment() {
  return (
    <div className="grid gap-2">
      <div className="mb-1 flex flex-wrap gap-2 text-[0.8125rem] text-white/85">
        {['One at a time', 'CSV', 'Resumes', 'Careers page'].map((t) => (
          <span key={t} className="rounded-full border border-white/20 bg-white/[0.08] px-3 py-1">{t}</span>
        ))}
      </div>
      {SOURCES.map(([id, source], i) => {
        const c = byId(id);
        return (
          <Loop key={id} i={i} d={8} className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-black/30 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.875rem]">{c?.name}</span>
              <span className="block text-[0.8125rem] tabular-nums text-white/70">{c?.phoneMasked}</span>
            </span>
            <span className="shrink-0 rounded-[6px] border border-white/25 px-2 py-0.5 text-[0.75rem] text-white/90">{source}</span>
          </Loop>
        );
      })}
    </div>
  );
}

function TestCallMoment() {
  const [a, b, c] = [SAMPLE_CALL.turns[2], SAMPLE_CALL.turns[3], SAMPLE_CALL.turns[4]];
  return (
    <div className="site-smoke rounded-[18px] p-4 text-white">
      <div className="flex items-center gap-3">
        <Agent colour="pearl" size={40} state="speaking" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[0.875rem] font-medium">Test call</p>
          <p className="m-0 text-[0.8125rem] text-white/75">You are the candidate</p>
        </div>
        <span aria-hidden className="flex h-5 items-end gap-[3px]">
          {[0.5, 1, 0.7, 0.9, 0.4].map((h, i) => (
            <span key={i} className="hiwb-bar block w-[3px] origin-bottom rounded-full bg-white/80" style={{ height: `${h * 100}%`, animationDelay: `${i * 0.13}s` }} />
          ))}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-[0.875rem] leading-snug">
        <Loop i={0} d={10} className="max-w-[92%] rounded-[12px] rounded-tl-[4px] bg-white/[0.12] px-3 py-2">{a?.text}</Loop>
        <Loop i={2} d={10} className="ml-auto max-w-[88%] rounded-[12px] rounded-tr-[4px] bg-white px-3 py-2 text-site-black">{b?.text}</Loop>
        <Loop i={4} d={10} className="max-w-[80%] rounded-[12px] rounded-tl-[4px] bg-white/[0.12] px-3 py-2">{c?.text}</Loop>
      </div>
      <p className="m-0 mt-3 inline-flex items-center gap-2 text-[0.8125rem] text-white/80">
        <Mic strokeWidth={2} className="size-4" /> Your microphone is on
      </p>
    </div>
  );
}

const STATE: Partial<Record<SampleStripState, { label: string; agent: AgentState; dot: string }>> = {
  on_call: { label: 'On the phone', agent: 'speaking', dot: 'bg-site-lime' },
  calling: { label: 'Ringing', agent: 'ringing', dot: 'bg-white' },
  ready_for_review: { label: 'Ready for review', agent: 'done', dot: 'bg-[#84adff]' },
  not_called: { label: 'Not called yet', agent: 'idle', dot: 'border border-white/60' },
};
const QUEUE = ['kavya', 'rohan', 'priya', 'arjun', 'ananya', 'sameer'].map(byId).filter((c) => c !== undefined);

function CallsMoment() {
  return (
    <div className="grid gap-3">
      <p className="m-0 inline-flex w-fit items-center gap-2 rounded-[10px] border border-white/15 bg-black/30 px-3 py-2 text-[0.875rem]">
        <span className="hiwb-ping size-2 rounded-full bg-site-lime" />
        Your calling number
        <span className="text-white/70">Connected</span>
      </p>
      <ul role="list" className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {QUEUE.map((c, i) => {
          const s = STATE[c.state];
          return (
            <li key={c.id}>
              <Loop i={i} d={9} className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-black/30 px-3 py-2.5">
                <Agent colour="pearl" size={24} state={s?.agent ?? 'idle'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem]">{c.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-white/75">
                    <span className={cn('size-1.5 rounded-full', s?.dot)} />
                    {s?.label}
                  </span>
                </span>
              </Loop>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STEPS = [
  {
    icon: FileText,
    title: 'Add the job',
    body: 'Paste the job description or upload the file, then add the questions every candidate must answer.',
    moment: <JobMoment />,
    span: 'lg:col-span-7',
    sky: false,
  },
  {
    icon: Users,
    title: 'Add people',
    body: 'Type them in, upload a CSV or resumes, or add one line to your careers page.',
    moment: <PeopleMoment />,
    span: 'lg:col-span-5',
    sky: false,
  },
  {
    icon: Mic,
    title: 'Hear a test call',
    body: 'Play the candidate in your browser and hear the call as they will. No calling number needed.',
    moment: <TestCallMoment />,
    span: 'lg:col-span-5 lg:col-start-8 lg:row-start-2',
    sky: true,
  },
  {
    icon: PhoneCall,
    title: 'Calls go out',
    body: 'We set up your calling number with you. Then HRVoice phones each candidate, and passes the call to your team if they ask for a person.',
    moment: <CallsMoment />,
    span: 'lg:col-span-7 lg:col-start-1 lg:row-start-2',
    sky: false,
  },
] as const;

// Where the round arrow sits to join a tile to the next one. Laptop: a U, so every arrow points at
// the very next step (1 → 2, 2 ↓ 3 under it, 3 ← 4). Phones: below, pointing down.
const DOWN = 'max-lg:-bottom-[1.75rem] max-lg:left-1/2 max-lg:-translate-x-1/2';
const JOIN = [
  `${DOWN} lg:-right-[1.65rem] lg:top-24 lg:-translate-y-1/2`,
  `${DOWN} lg:bottom-[-1.75rem] lg:left-1/2 lg:-translate-x-1/2`,
  `${DOWN} lg:-left-[1.65rem] lg:top-24 lg:-translate-y-1/2`,
];
const JOIN_ICON = [ArrowRight, ArrowDown, ArrowLeft];

function Tile({ index, step }: { index: number; step: (typeof STEPS)[number] }) {
  const { icon: Icon, title, body, moment, span, sky } = step;
  const Join = JOIN_ICON[index];
  const inner = (
    <div className="flex h-full flex-col p-5 sm:p-7">
      <span className="flex items-center gap-3 text-[0.8125rem] font-medium text-white/80">
        <span className="grid size-9 place-items-center rounded-full border border-white/20 bg-white/10">
          <Icon strokeWidth={1.75} className="size-[1.125rem] text-white" />
        </span>
        Step {index + 1}
      </span>
      <h3 className="m-0 mt-5 text-[1.25rem] font-medium leading-snug tracking-[-0.015em] text-white">{title}</h3>
      <p className="m-0 mt-2 max-w-[44ch] text-[1rem] leading-[1.55] text-site-fg-2">{body}</p>
      <div aria-hidden className="mt-6 flex flex-1 flex-col justify-start">
        {moment}
      </div>
    </div>
  );
  return (
    <li data-reveal className={cn('relative', span)}>
      {sky ? (
        <PhotoFrame photo={skyPhoto} sizes="(min-width: 1024px) 40vw, 100vw" position="50% 35%" className="h-full">
          <div className="absolute inset-0 -z-10 bg-[#0e243a]/35" />
          {inner}
        </PhotoFrame>
      ) : (
        <div className="h-full overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(160deg,rgb(255_255_255/0.07),rgb(255_255_255/0.02))] backdrop-blur-sm">
          {inner}
        </div>
      )}
      {Join && (
        <span
          aria-hidden
          className={cn(
            'absolute z-10 grid size-10 place-items-center rounded-full border border-white/20 bg-site-black text-white shadow-[0_0_0_4px_var(--site-black)]',
            JOIN[index],
          )}
        >
          <Join strokeWidth={1.75} className="hiwb-flow size-4 max-lg:hidden" />
          <ArrowDown strokeWidth={1.75} className="hiwb-flow size-4 lg:hidden" />
        </span>
      )}
    </li>
  );
}

export function HowItWorksSection() {
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setLive(!!e?.isIntersecting), { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="how-it-works" aria-labelledby="how-title" className={cn(SECTION, 'border-t border-site-line')}>
      <style>{CSS}</style>
      <div className={CONTAINER}>
        <div data-reveal className="max-w-[56rem]">
          <h2
            id="how-title"
            className="m-0 text-[clamp(2.25rem,4vw,3.5rem)] font-normal leading-[1.05] tracking-[-0.04em] text-white [text-wrap:balance]"
          >
            Set up today. Call when you&rsquo;re ready.
          </h2>
          <p className="m-0 mt-5 max-w-[60ch] text-[1.0625rem] leading-[1.55] text-site-fg-2 [text-wrap:pretty]">
            Add a job and the people for it, then hear a test call in your browser. Calls to candidates&rsquo; phones start once your calling number is set up.
          </p>
        </div>

        <div ref={ref} className={cn('mt-12 md:mt-16', live && 'hiwb-live')}>
          <ol role="list" className="m-0 grid list-none gap-10 p-0 lg:grid-cols-12 lg:gap-8">
            {STEPS.map((s, i) => (
              <Tile key={s.title} index={i} step={s} />
            ))}
          </ol>
        </div>

        <Link
          href={SIGNUP_HREF}
          className="mt-10 inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-white underline decoration-white/40 underline-offset-[6px] transition-colors duration-200 hover:decoration-white focus-visible:outline-white"
        >
          Create account
        </Link>
      </div>
    </section>
  );
}
