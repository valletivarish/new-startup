import { Check, FileText, Minus } from 'lucide-react';
import { Agent } from '../brand/agent';
import { cn } from '../ui/cn';
import { SAMPLE_CALL, SAMPLE_JOB } from './sample-data';
import { clock, DURATION } from './sample-call-timeline';
import questionsPhoto from '../../public/images/site/product-questions.jpg';
import answersPhoto from '../../public/images/site/product-answers.jpg';
import summaryPhoto from '../../public/images/site/product-summary.jpg';
import { CONTAINER, Italic, PhotoFrame, SAMPLE_NOTE, SECTION, Tag } from './kit';

const FIRST_NAME = SAMPLE_CALL.candidate.split(' ')[0] ?? SAMPLE_CALL.candidate;
const ASKED = SAMPLE_CALL.answers.filter((answer) => !('extra' in answer && answer.extra));
const ANSWERED = ASKED.filter((answer) => answer.answer !== null).length;
// The candidate's own question, and the agent's answer from the job description.
const ASK = SAMPLE_CALL.turns.find((turn) => turn.text.includes('first round') && turn.speaker === 'contact');
const REPLY = SAMPLE_CALL.turns.find((turn) => turn.text.includes('first round') && turn.speaker === 'agent');

// The summary's first sentence: a whole thought, never cut off mid-word.
const SUMMARY_START = SAMPLE_CALL.summary.slice(0, SAMPLE_CALL.summary.indexOf('. ') + 1);

const CARD_SIZES = '(min-width: 768px) 33vw, 100vw';

function CardText({ title, body }: { title: string; body: string }) {
  return (
    <div className="relative mt-auto px-6 pb-6 pt-16 [background:linear-gradient(to_bottom,rgb(5_5_5/0),rgb(5_5_5/0.72))]">
      <h3 className="m-0 text-[1.25rem] font-medium tracking-[-0.02em] text-white">{title}</h3>
      {/* Three lines held open, so the three titles sit on one line across the row. */}
      <p className="m-0 mt-2 max-w-[30ch] text-[0.9375rem] leading-relaxed text-white/80 md:min-h-[4.875em]">{body}</p>
    </div>
  );
}

/** Panel 1: the job's must-ask questions, ticked as the call answers them. */
function QuestionsPanel() {
  return (
    <div className="site-smoke rounded-[18px] p-4 text-white">
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[0.875rem] font-medium">Must-ask questions</p>
        <p className="m-0 text-[0.75rem] tabular-nums text-white/70">
          {ANSWERED} of {ASKED.length} answered
        </p>
      </div>
      <ul role="list" className="m-0 mt-3 grid list-none gap-2.5 p-0">
        {ASKED.map(({ question, answer }) => (
          <li key={question} className="flex gap-2.5">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 grid size-[1.125rem] shrink-0 place-items-center rounded-full',
                answer ? 'bg-site-lime text-site-black' : 'border border-white/35 text-white/60',
              )}
            >
              {answer ? <Check strokeWidth={3} className="size-3" /> : <Minus strokeWidth={2.5} className="size-3" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[0.8125rem] leading-snug text-white">{question}</span>
              <span className="block text-[0.75rem] leading-snug text-white/65">
                {answer ?? 'Not answered'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Panel 2: the candidate asks about the job; the agent answers from the job description. */
function AnswerPanel() {
  return (
    <div className="rounded-[18px] bg-white p-4 text-site-black shadow-[0_20px_40px_-20px_rgb(5_5_5/0.45)]">
      <p className="m-0 text-[0.75rem] font-medium text-[#5b616b]">{FIRST_NAME} asks</p>
      <p className="m-0 mt-1.5 rounded-[12px] bg-[#f1f3f5] px-3 py-2 text-[0.8125rem] leading-snug">
        {ASK?.text.replace('Yes, Tuesday or Wednesday afternoon is good for me. ', '')}
      </p>
      <p className="m-0 mt-3 text-[0.75rem] font-medium text-[#5b616b]">AI agent answers</p>
      <p className="m-0 mt-1.5 rounded-[12px] border border-[#e3e6ea] px-3 py-2 text-[0.8125rem] leading-snug">
        {REPLY?.text}
      </p>
      <p className="m-0 mt-3 inline-flex items-center gap-1.5 rounded-[8px] bg-[#eef6df] px-2.5 py-1 text-[0.75rem] font-medium text-[#3b5a12]">
        <FileText aria-hidden strokeWidth={2} className="size-3.5" />
        From your job description
      </p>
    </div>
  );
}

/** Panel 3: the call as it comes back: who, where it stands, the summary and the recording. */
function SummaryPanel() {
  const bars = [6, 10, 14, 9, 16, 12, 7, 13, 17, 11, 8, 15, 10, 6, 12, 9, 14, 7, 11, 5];
  return (
    <div className="site-smoke rounded-[18px] p-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <Agent colour="pearl" size={30} state="done" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[0.875rem] font-medium">{SAMPLE_CALL.candidate}</p>
          <p className="m-0 truncate text-[0.75rem] text-white/65">{SAMPLE_JOB.title}</p>
        </div>
        {/* The app's tag: blue, new work waiting for a person. */}
        <span className="inline-flex h-6 shrink-0 items-center rounded-[7px] border border-status-info-border bg-status-info-bg px-2 text-[0.6875rem] font-medium text-status-info-text">
          Ready for review
        </span>
      </div>
      <p className="m-0 mt-3 text-[0.8125rem] leading-relaxed text-white/85">{SUMMARY_START}</p>
      {/* A picture of the recording, not a player: no play button that does nothing. */}
      <div className="mt-3 flex items-center gap-3 rounded-[12px] bg-white/10 px-3 py-2">
        <span className="shrink-0 text-[0.75rem] text-white/75">Recording</span>
        <span aria-hidden className="flex h-5 flex-1 items-center gap-[3px]">
          {bars.map((h, i) => (
            <span key={i} className={cn('w-[3px] rounded-full', i < 7 ? 'bg-site-lime' : 'bg-white/45')} style={{ height: h }} />
          ))}
        </span>
        <span className="text-[0.75rem] tabular-nums text-white/75">{clock(DURATION)}</span>
      </div>
    </div>
  );
}

const CARDS = [
  {
    photo: questionsPhoto,
    position: '50% 70%',
    title: 'Asks your questions',
    body: 'It asks the questions you set for the job. Same words, every call.',
    panel: <QuestionsPanel />,
  },
  {
    photo: answersPhoto,
    position: '50% 40%',
    title: 'Answers from your job description',
    body: 'Candidates ask about the job. It answers from what you uploaded and passes on anything it can’t answer.',
    panel: <AnswerPanel />,
  },
  {
    photo: summaryPhoto,
    position: '50% 50%',
    title: 'Hands you the full record',
    body: 'Recording, transcript, answers and a short summary. Nothing is decided for you.',
    panel: <SummaryPanel />,
  },
] as const;

/**
 * Website section 2 (#product): what comes back from a screen. Three photographs, each with a
 * product panel set on it (sample data, labelled), and a line under each. The panels are
 * pictures of the product, not controls, so nothing in them is focusable.
 */
export function ProductSection() {
  return (
    <section id="product" aria-labelledby="product-title" className={SECTION}>
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end">
          <div data-reveal className="lg:col-span-7">
            <Tag>The product</Tag>
            <h2 id="product-title" className="site-h2 m-0 mt-6 text-white">
              <span className="block">Every call comes back</span>
              <Italic>ready to review</Italic>
            </h2>
          </div>
          <p data-reveal className="m-0 max-w-[30rem] text-[1.0625rem] leading-relaxed text-site-fg-2 lg:col-span-5 lg:justify-self-end">
            HRVoice asks your questions, answers the candidate’s questions from your job description and gives
            you everything that was said. You decide who moves forward.
          </p>
        </div>

        <ul role="list" className="m-0 mt-14 grid list-none grid-cols-1 gap-5 p-0 md:mt-16 md:grid-cols-3">
          {CARDS.map(({ photo, position, title, body, panel }) => (
            <li key={title} data-reveal>
              <PhotoFrame
                photo={photo}
                position={position}
                sizes={CARD_SIZES}
                className="flex min-h-[34rem] flex-col md:min-h-[36rem]"
              >
                <div aria-hidden className="p-4 pt-5 md:p-5">
                  {panel}
                </div>
                <CardText title={title} body={body} />
              </PhotoFrame>
            </li>
          ))}
        </ul>
        <p data-reveal className="m-0 mt-5 text-[0.8125rem] text-site-fg-3">
          {SAMPLE_NOTE}
        </p>
      </div>
    </section>
  );
}
