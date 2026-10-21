import { ArrowUpRight, FileText } from 'lucide-react';
import { cn } from '../ui/cn';
import { SAMPLE_CALL, SAMPLE_JOB } from './sample-data';
import { clock, DURATION } from './sample-call-timeline';
import summaryPhoto from '../../public/images/site/product-summary.jpg';
import { CONTAINER, PhotoFrame, SECTION, Tag } from './kit';

const FIRST_NAME = SAMPLE_CALL.candidate.split(' ')[0] ?? SAMPLE_CALL.candidate;
const ASKED = SAMPLE_CALL.answers.filter((answer) => !('extra' in answer && answer.extra));
const ANSWERED = ASKED.filter((answer) => answer.answer !== null).length;
// The candidate's own question, answered from the job description.
const ASK = SAMPLE_CALL.answers.find((answer) => 'extra' in answer && answer.extra && answer.question.includes('first round'));

// The summary's first two sentences: whole thoughts, never cut mid-word.
const SUMMARY_START = SAMPLE_CALL.summary.split('. ').slice(0, 2).join('. ') + '.';

// The notice-period exchange, where the transcript and the answers meet.
const EXCERPT = SAMPLE_CALL.turns.filter((turn) => turn.at >= 18 && turn.at < 25);

/** What each part of the record is for: beside the panel on laptops, under it on phones. */
const POINTS = [
  { title: 'Asks your questions', body: 'The questions you set for the job, in the same words on every call.' },
  { title: 'Answers from your job description', body: 'Candidates ask about the job. It answers from what you uploaded and passes on the rest.' },
  { title: 'Hands you the full record', body: 'Summary first, then the answers, transcript and recording. Nothing is decided for you.' },
] as const;

/**
 * The call as it comes back, summary first (OpenPhone's order), then the transcript beside the
 * answers with the second each was said (Margin's split). Sample data; a picture of the
 * product, so it is hidden from assistive tech and the section's words carry the meaning.
 */
function RecordPanel() {
  return (
    <div aria-hidden className="site-smoke w-full rounded-[22px] p-4 text-white sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[1rem] font-medium">{SAMPLE_CALL.candidate}</p>
          <p className="m-0 truncate text-[0.75rem] text-white/65">
            {SAMPLE_JOB.title} · Call ended · {clock(DURATION)}
          </p>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center rounded-[7px] border border-status-info-border bg-status-info-bg px-2 text-[0.6875rem] font-medium text-status-info-text">
          Ready for review
        </span>
      </div>

      <p className="m-0 mt-4 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-white/60">Summary</p>
      <p className="m-0 mt-1.5 line-clamp-3 text-[0.875rem] leading-relaxed text-white/90 sm:line-clamp-none">{SUMMARY_START}</p>

      <div className="mt-5 grid grid-cols-1 gap-5 border-t border-white/10 pt-4 sm:grid-cols-2">
        <div className="hidden sm:block">
          <p className="m-0 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-white/60">Transcript</p>
          <ol role="list" className="m-0 mt-2.5 grid list-none gap-2.5 p-0">
            {EXCERPT.map((turn) => (
              <li
                key={turn.at}
                className={cn(
                  'grid grid-cols-[2.25rem_1fr] gap-2 border-l-2 pl-2.5 text-[0.8125rem] leading-snug',
                  turn.text.includes('thirty days') ? 'border-site-lime' : 'border-transparent',
                )}
              >
                <span className="tabular-nums text-white/55">{clock(turn.at)}</span>
                <span>
                  <span className="block text-[0.6875rem] text-white/60">{turn.speaker === 'agent' ? 'AI agent' : FIRST_NAME}</span>
                  {turn.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="m-0 flex justify-between text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-white/60">
            Must-ask answers
            <span className="normal-case tracking-normal tabular-nums">
              {ANSWERED} of {ASKED.length}
            </span>
          </p>
          <ul role="list" className="m-0 mt-2.5 grid list-none gap-2 p-0">
            {ASKED.slice(0, 4).map(({ question, answer, at }) => (
              <li key={question} className="flex items-start justify-between gap-3 text-[0.8125rem] leading-snug">
                <span className="min-w-0">
                  <span className="block text-white/60">{question}</span>
                  <span className="block truncate">{answer}</span>
                </span>
                {at !== null ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[6px] bg-white/10 px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-white/80">
                    {clock(at)}
                    <ArrowUpRight strokeWidth={2} className="size-3" />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {ASK ? (
        <p className="m-0 mt-4 hidden items-start gap-2 rounded-[12px] sm:flex bg-white/[0.07] px-3 py-2 text-[0.75rem] leading-snug text-white/85">
          <FileText strokeWidth={1.75} className="mt-px size-3.5 shrink-0 text-site-lime" />
          <span>
            {FIRST_NAME} asked if the first round is online. {ASK.answer}, from your job description.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Point({ title, body, className }: { title: string; body: string; className?: string }) {
  return (
    <div className={className}>
      <h3 className="m-0 text-[1.375rem] font-normal leading-tight tracking-[-0.03em] text-white">{title}</h3>
      <p className="m-0 mt-2 max-w-[26ch] text-[0.9375rem] leading-relaxed text-white/80">{body}</p>
    </div>
  );
}

/**
 * Website section 3 (#product): what comes back from a screen. One photograph with one glass
 * panel at its centre (Terra), holding the same sample call as the player above, so the two
 * connect. On laptops the three points float beside the panel in light sans; on phones they
 * list under the photograph.
 */
export function ProductSection() {
  const [asks, answers, record] = POINTS;
  return (
    <section id="product" aria-labelledby="product-title" className={SECTION}>
      <div className={CONTAINER}>
        <div data-reveal className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Tag>Sample record</Tag>
            <h2 id="product-title" className="site-h2 m-0 mt-5 text-white">
              Every call comes back ready to review
            </h2>
          </div>
          <p className="m-0 max-w-[30rem] text-[1.0625rem] leading-relaxed text-site-fg-2 max-sm:hidden lg:col-span-5 lg:justify-self-end">
            You read what was said, then decide who moves forward. HRVoice reports. It never recommends hire or
            reject.
          </p>
        </div>

        <div data-reveal className="mt-10 md:mt-14">
          <PhotoFrame
            photo={summaryPhoto}
            sizes="(min-width: 1280px) 1184px, 100vw"
            position="50% 50%"
            className="p-3 sm:p-8 lg:grid lg:min-h-[44rem] lg:grid-cols-[1fr_minmax(0,40rem)_1fr] lg:items-center lg:gap-10 lg:p-12"
          >
            <div aria-hidden className="absolute inset-0 -z-[5] bg-[rgb(5_5_5/0.28)]" />
            <div className="hidden gap-12 self-center lg:grid">
              <Point {...asks} />
              <Point {...answers} />
            </div>
            <RecordPanel />
            <Point {...record} className="hidden self-end lg:block" />
          </PhotoFrame>
          <ul role="list" className="m-0 mt-6 grid list-none gap-4 p-0 sm:grid-cols-3 lg:hidden">
            {POINTS.map((point) => (
              <li key={point.title}>
                <h3 className="m-0 text-[1.0625rem] font-medium tracking-[-0.01em] text-white">{point.title}</h3>
                <p className="m-0 mt-1 text-[0.9375rem] leading-relaxed text-site-fg-2">{point.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
