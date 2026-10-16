import { FileUp, Headphones, PhoneCall, UsersRound, type LucideIcon } from 'lucide-react';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { cn } from '../ui/cn';
import { SAMPLE_CANDIDATES, SAMPLE_JOB, type SampleStripState } from './sample-data';
import fieldPhoto from '../../public/images/site/setup-field.jpg';
import Link from 'next/link';
import { CONTAINER, Italic, PhotoFrame, SAMPLE_NOTE, SECTION, SIGNUP_HREF } from './kit';

const STEPS: readonly { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: FileUp,
    title: 'Add the job',
    body: 'Paste the job description or upload the file you have (PDF, Word or PowerPoint). Then add the questions every candidate must answer.',
  },
  {
    icon: UsersRound,
    title: 'Add candidates',
    body: 'Type them in one at a time, upload a spreadsheet saved as CSV, or upload their resumes. We pick up each phone number from the resume.',
  },
  {
    icon: Headphones,
    title: 'Try a test call in your browser',
    body: 'You play the candidate and hear exactly what they will hear.',
  },
  {
    icon: PhoneCall,
    title: 'Call by phone',
    body: 'When your company’s calling number is set up, HRVoice phones each candidate. It spots voicemail and transfers the call to your team if a candidate asks for a person.',
  },
];

// Each row's agent acts out where that call stands, so the states read without a legend.
// The dot is the app's status colour: lime while a call is live, blue once it waits for a person.
const STATE: Partial<Record<SampleStripState, { label: string; agent: AgentState; dot: string }>> = {
  on_call: { label: 'On call', agent: 'speaking', dot: 'bg-site-lime' },
  calling: { label: 'Calling', agent: 'ringing', dot: 'bg-white motion-safe:animate-pulse' },
  ready_for_review: { label: 'Ready for review', agent: 'done', dot: 'bg-[#84adff]' },
  not_called: { label: 'Not called yet', agent: 'idle', dot: 'border border-white/50' },
};

// One candidate in each state the queue moves through.
const QUEUE = (['on_call', 'calling', 'ready_for_review', 'not_called'] as const)
  .map((state) => SAMPLE_CANDIDATES.find((candidate) => candidate.state === state))
  .filter((candidate) => candidate !== undefined);
const DONE = SAMPLE_CANDIDATES.find((candidate) => candidate.id === 'kavya');

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The job's queue as the app shows it, set on the photograph. Sample data. */
function QueuePanel() {
  return (
    <div className="site-smoke w-full max-w-[24rem] rounded-[18px] p-4 text-white">
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 truncate text-[0.875rem] font-medium">{SAMPLE_JOB.title}</p>
        <p className="m-0 shrink-0 text-[0.75rem] text-white/65">{SAMPLE_JOB.location}</p>
      </div>
      <ul role="list" className="m-0 mt-3 grid list-none gap-1.5 p-0">
        {QUEUE.map((candidate) => {
          const state = STATE[candidate.state];
          return (
            <li key={candidate.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.07] px-3 py-2">
              <Agent colour="pearl" size={24} state={state?.agent ?? 'idle'} />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{candidate.name}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.75rem] text-white/80">
                <span className={cn('size-1.5 rounded-full', state?.dot)} />
                {state?.label}
                {candidate.durationSeconds && candidate.state === 'on_call' ? (
                  <span className="tabular-nums text-white/60">{clock(candidate.durationSeconds)}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A finished screen, floating over the corner of the photograph. */
function DoneCard() {
  if (!DONE) return null;
  return (
    <div className="w-[16.5rem] rounded-[16px] bg-white p-3.5 text-site-black shadow-[0_24px_48px_-20px_rgb(5_5_5/0.55)]">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[0.75rem] font-medium text-[#5b616b]">Just finished</p>
        {/* The app's Ready for review tag: blue, new work waiting for a person. */}
        <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[7px] border border-status-info-border bg-status-info-bg px-2 text-[0.6875rem] font-medium text-status-info-text">
          Ready for review
        </span>
      </div>
      <p className="m-0 mt-1.5 text-[0.875rem] font-medium">{DONE.name}</p>
      <p className="m-0 mt-1 text-[0.75rem] text-[#5b616b]">
        All {DONE.answered} questions answered{DONE.durationSeconds ? ` in ${Math.round(DONE.durationSeconds / 60)} min` : ''}
      </p>
    </div>
  );
}

/**
 * Website section 4 (#how-it-works): the four things a recruiter does, with an icon each, beside
 * a photograph carrying the job's queue and a finished screen. The panels are pictures of the
 * product, so they are hidden from assistive tech; the steps carry the meaning.
 */
export function HowItWorksSection() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={cn(CONTAINER, 'grid grid-cols-1 items-center gap-14 lg:grid-cols-12 lg:gap-12')}>
        <div className="lg:col-span-5">
          <h2 data-reveal id="how-title" className="site-h2 m-0 text-white">
            <span className="block">From job description</span>
            <Italic>to first call</Italic>
          </h2>
          <p data-reveal className="m-0 mt-5 max-w-[32rem] text-[1.0625rem] leading-relaxed text-site-fg-2">
            No call scripts to write. If you can post a job ad, you can set this up.
          </p>
          {/* A real sequence, so it is numbered and joined by a line from one step to the next. */}
          <ol role="list" className="m-0 mt-10 grid list-none gap-7 p-0">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li data-reveal key={title} className="relative flex gap-4">
                {i < STEPS.length - 1 ? (
                  <span aria-hidden className="absolute -bottom-7 left-5 top-12 w-px bg-site-line" />
                ) : null}
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-site-line bg-site-black text-site-lime">
                  <Icon strokeWidth={1.5} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] font-medium tabular-nums text-site-fg-3">Step {i + 1}</span>
                  <span className="mt-0.5 block text-[1.0625rem] font-medium tracking-[-0.01em] text-white">{title}</span>
                  <span className="mt-1 block max-w-[34rem] text-[0.9375rem] leading-relaxed text-site-fg-2">{body}</span>
                </span>
              </li>
            ))}
          </ol>
          <div data-reveal className="mt-10">
            <p className="m-0 max-w-[34rem] text-[0.9375rem] leading-relaxed text-site-fg-2">
              Steps 1 to 3 work today, before any calling number is set up.
            </p>
            <Link
              href={SIGNUP_HREF}
              className="mt-2 inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-white underline decoration-white/40 underline-offset-[6px] transition-colors duration-200 hover:decoration-white"
            >
              Start a pilot
            </Link>
          </div>
        </div>

        <div data-reveal className="lg:col-span-7">
          <PhotoFrame
            photo={fieldPhoto}
            sizes="(min-width: 1024px) 55vw, 100vw"
            position="50% 60%"
            className="aspect-[4/5] w-full sm:aspect-[4/3.6]"
          >
            <div aria-hidden className="absolute inset-0 flex flex-col justify-between p-5 sm:p-7">
              <QueuePanel />
              <div className="flex justify-end">
                <DoneCard />
              </div>
            </div>
          </PhotoFrame>
          <p className="m-0 mt-4 text-[0.8125rem] text-site-fg-3">{SAMPLE_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
