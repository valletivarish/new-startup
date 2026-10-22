'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FileText, Mic } from 'lucide-react';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { cn } from '../ui/cn';
import { SAMPLE_CALL, SAMPLE_CANDIDATES, SAMPLE_JOB, type SampleStripState } from './sample-data';
import fieldPhoto from '../../public/images/site/setup-field.jpg';
import { CONTAINER, PhotoFrame, SECTION, SIGNUP_HREF } from './kit';

const QUESTIONS = SAMPLE_CALL.answers.filter((answer) => !('extra' in answer && answer.extra)).map((a) => a.question);

/** The job and its must-ask questions, as the app shows them. */
function JobPreview() {
  return (
    <Panel title={SAMPLE_JOB.title} meta={SAMPLE_JOB.location}>
      <p className="m-0 flex items-center gap-2 rounded-[10px] bg-white/[0.08] px-3 py-2 text-[0.8125rem]">
        <FileText strokeWidth={1.75} className="size-4 shrink-0 text-white/70" />
        Job description added
      </p>
      <p className="m-0 mt-3.5 text-[0.75rem] text-white/60">Must-ask questions</p>
      <ol role="list" className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
        {QUESTIONS.map((q, i) => (
          <li key={q} className="flex gap-2.5 text-[0.8125rem] leading-snug">
            <span className="w-3 shrink-0 tabular-nums text-white/50">{i + 1}</span>
            {q}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** Candidates added from resumes, each phone number picked up from the file. */
function CandidatesPreview() {
  const people = SAMPLE_CANDIDATES.slice(4, 8);
  return (
    <Panel title="Add candidates" meta="One at a time, CSV or resumes">
      <ul role="list" className="m-0 grid list-none gap-1.5 p-0">
        {people.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.07] px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem]">{c.name}</span>
              <span className="block text-[0.75rem] tabular-nums text-white/60">{c.phoneMasked}</span>
            </span>
            <span className="shrink-0 rounded-[6px] border border-white/20 px-1.5 py-0.5 text-[0.6875rem] text-white/80">
              From resume
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A test call in the browser: the recruiter plays the candidate. */
function TestCallPreview() {
  const first = SAMPLE_CALL.turns[0];
  return (
    <Panel title="Test call in your browser" meta="You are the candidate">
      <div className="flex flex-col items-center py-2 text-center">
        <Agent colour="pearl" size={56} state="speaking" />
        <p className="m-0 mt-3 text-[0.75rem] text-white/60">Hiring team call</p>
        <p className="m-0 mt-1.5 max-w-[30ch] text-[0.875rem] leading-snug">{first?.text}</p>
        <span className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[0.8125rem] font-medium text-site-black">
          <Mic strokeWidth={2} className="size-4" />
          Your microphone is on
        </span>
      </div>
    </Panel>
  );
}

// Each row's agent acts out where that call stands, so the states read without a legend.
const STATE: Partial<Record<SampleStripState, { label: string; agent: AgentState; dot: string }>> = {
  on_call: { label: 'On the phone', agent: 'speaking', dot: 'bg-site-lime' },
  calling: { label: 'On the phone', agent: 'ringing', dot: 'bg-white' },
  ready_for_review: { label: 'Ready for review', agent: 'done', dot: 'bg-[#84adff]' },
  not_called: { label: 'Not called yet', agent: 'idle', dot: 'border border-white/50' },
};
const QUEUE = ['priya', 'arjun', 'kavya', 'rohan', 'sameer']
  .map((id) => SAMPLE_CANDIDATES.find((c) => c.id === id))
  .filter((c) => c !== undefined);

/** The job's queue once calls go out: who is on a call, who is ready for review. */
function QueuePreview() {
  return (
    <Panel title={SAMPLE_JOB.title} meta="Calling by phone">
      <ul role="list" className="m-0 grid list-none gap-1.5 p-0">
        {QUEUE.map((c) => {
          const state = STATE[c.state];
          return (
            <li key={c.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.07] px-3 py-2">
              <Agent colour="pearl" size={22} state={state?.agent ?? 'idle'} />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{c.name}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.75rem] text-white/80">
                <span className={cn('size-1.5 rounded-full', state?.dot)} />
                {state?.label}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Panel({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <div className="site-smoke w-full max-w-[24rem] rounded-[18px] p-4 text-white">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="m-0 truncate text-[0.875rem] font-medium">{title}</p>
        <p className="m-0 shrink-0 text-[0.75rem] text-white/60">{meta}</p>
      </div>
      {children}
    </div>
  );
}

const STEPS: readonly { title: string; body: string; preview: ReactNode }[] = [
  {
    title: 'Add a job and your must-ask questions',
    body: 'Paste the job description or upload the file you have (PDF, Word or PowerPoint). Then add the questions every candidate must answer. No call script to write.',
    preview: <JobPreview />,
  },
  {
    title: 'Add candidates',
    body: 'Type them in one at a time, upload a spreadsheet saved as CSV, or upload their resumes. We pick up each phone number from the resume. Or paste one line into your careers page, and applicants ask for their call there. There is no applicant tracking system link yet.',
    preview: <CandidatesPreview />,
  },
  {
    title: 'Try a test call in your browser',
    body: 'You play the candidate and hear how natural the call feels, exactly as they will. This works on day one, before any calling number is set up.',
    preview: <TestCallPreview />,
  },
  {
    title: 'We connect your calling number. HRVoice phones each candidate.',
    body: 'Calls to phones need your company’s own calling number, and the phone carrier runs a KYC check on it first. We go through it with you and agree the price per completed call. Then it phones each candidate and talks it through naturally, spots voicemail, and hands the call to your team if a candidate asks for a person.',
    preview: <QueuePreview />,
  },
];

/**
 * Website section 4 (#how-it-works), the one place the pilot is told. On laptops, Cadence's
 * sticky stepper: four steps on the left, the one in the middle of the screen full white and
 * the rest dimmed, beside a sticky photograph whose product preview crossfades to match (CSS
 * sticky and an IntersectionObserver, no pinning). On phones, a snap carousel of four cards,
 * preview above the words. The previews are pictures of the product (sample data), hidden
 * from assistive tech; the steps carry the meaning.
 */
export function HowItWorksSection() {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="how-it-works" aria-labelledby="how-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={CONTAINER}>
        <div data-reveal className="max-w-[40rem]">
          <h2 id="how-title" className="site-h2 m-0 text-white">
            From job description to first call
          </h2>
          <p className="m-0 mt-5 text-[1.0625rem] leading-relaxed text-site-fg-2">
            If you can post a job ad, you can set this up. Steps 1 to 3 work today, before any calling number.
          </p>
        </div>

        {/* Laptops: the sticky stepper. */}
        <div className="mt-6 hidden grid-cols-12 gap-12 lg:grid">
          <ol role="list" className="col-span-5 m-0 list-none p-0">
            {STEPS.map(({ title, body }, i) => (
              <li
                key={title}
                ref={(el) => {
                  steps.current[i] = el;
                }}
                data-step={i}
                className={cn(
                  'flex min-h-[42vh] flex-col justify-center transition-opacity duration-500',
                  active === i ? 'opacity-100' : 'opacity-40',
                )}
              >
                <span className="text-[0.8125rem] font-medium tabular-nums text-site-fg-3">0{i + 1}</span>
                <h3 className="m-0 mt-2 text-[1.625rem] font-normal leading-tight tracking-[-0.03em] text-white">{title}</h3>
                <p className="m-0 mt-3 max-w-[34rem] text-[1rem] leading-relaxed text-site-fg-2">{body}</p>
                <span aria-hidden className="mt-6 block h-px w-full bg-site-line">
                  <span
                    className={cn(
                      'block h-px origin-left bg-white transition-transform duration-700 ease-out',
                      active === i ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                </span>
              </li>
            ))}
          </ol>
          <div className="col-span-7">
            <div className="sticky top-[calc(50vh-17rem)]">
              <PhotoFrame photo={fieldPhoto} sizes="55vw" position="50% 60%" className="aspect-[4/3.3] w-full">
                <div aria-hidden className="absolute inset-0 grid place-items-center p-8">
                  {STEPS.map(({ title, preview }, i) => (
                    <div
                      key={title}
                      className={cn(
                        'col-start-1 row-start-1 flex w-full justify-center transition-[opacity,transform] duration-500 motion-reduce:transition-none',
                        active === i ? 'opacity-100' : 'translate-y-2 opacity-0',
                      )}
                    >
                      {preview}
                    </div>
                  ))}
                </div>
              </PhotoFrame>
            </div>
          </div>
        </div>

        {/* Phones and tablets: a snap carousel, preview above the words. */}
        <ol
          role="list"
          tabIndex={0}
          aria-label="Steps, scroll sideways"
          className="-mx-5 m-0 mt-10 flex list-none snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 md:scroll-px-8 pb-2 [scrollbar-width:none] focus-visible:outline-white md:-mx-8 md:px-8 lg:hidden"
        >
          {STEPS.map(({ title, body, preview }, i) => (
            <li key={title} className="w-[84%] max-w-[26rem] shrink-0 snap-start">
              <PhotoFrame photo={fieldPhoto} sizes="84vw" position="50% 60%" className="flex aspect-[4/4.1] items-center justify-center p-4">
                <div aria-hidden className="flex w-full justify-center">
                  {preview}
                </div>
              </PhotoFrame>
              <span className="mt-5 block text-[0.8125rem] font-medium tabular-nums text-site-fg-3">0{i + 1} of 04</span>
              <h3 className="m-0 mt-1 text-[1.1875rem] font-normal leading-snug tracking-[-0.02em] text-white">{title}</h3>
              <p className="m-0 mt-2 text-[0.9375rem] leading-relaxed text-site-fg-2">{body}</p>
            </li>
          ))}
        </ol>

        <Link
          href={SIGNUP_HREF}
          className="mt-6 inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-white underline decoration-white/40 underline-offset-[6px] transition-colors duration-200 hover:decoration-white lg:mt-10"
        >
          Start a pilot
        </Link>
      </div>
    </section>
  );
}
