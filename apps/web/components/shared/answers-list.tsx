import { CircleDashed } from 'lucide-react';
import { cn } from '../ui/cn';
import { OriginTicket } from './origin-ticket';

export interface Answer {
  question: string;
  /** What was said. null (or blank) when the question went unanswered. */
  answer: string | null;
  /** Seconds into the call where it was said: adds a time pill. */
  at?: number | null;
  /** Said on the call but not one of the job's questions: listed under "Also mentioned", never counted. */
  extra?: boolean;
}

const isAnswered = (item: Answer) => Boolean(item.answer?.trim());

/** Coverage over the job's own questions only. */
export function answerCoverage(items: readonly Answer[]): { answered: number; total: number } {
  const asked = items.filter((item) => !item.extra);
  return { answered: asked.filter(isAnswered).length, total: asked.length };
}

function Rows({ items, onSeek }: { items: readonly Answer[]; onSeek?: (at: number) => void }) {
  return (
    <dl className="m-0 divide-y divide-border">
      {items.map((item, i) => (
        <div key={i} className="grid gap-1 py-3 first:pt-0 last:pb-0">
          <dt className="text-meta font-medium text-text-2">{item.question}</dt>
          <dd className="m-0 flex items-start justify-between gap-3">
            {isAnswered(item) ? (
              <span className="min-w-0 text-body text-text [overflow-wrap:anywhere]">{item.answer}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-body text-text-3">
                <CircleDashed aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
                Not answered
              </span>
            )}
            {isAnswered(item) && item.at != null ? <OriginTicket at={item.at} onSeek={onSeek} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface AnswersListProps {
  /** The job's questions in order, then any extras. */
  items: readonly Answer[];
  /** Time pills call this with the answer's time: seek the recording, highlight the turn. */
  onSeek?: (at: number) => void;
  className?: string;
}

/**
 * Question and answer rows under a coverage line, one dot per question (filled when answered).
 * Reports what was said; never a score or verdict.
 */
export function AnswersList({ items, onSeek, className }: AnswersListProps) {
  if (items.length === 0) return null;
  const { answered, total } = answerCoverage(items);
  const asked = items.filter((item) => !item.extra);
  const extras = items.filter((item) => item.extra);
  return (
    <div className={cn('grid gap-4', className)}>
      {total > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="m-0 text-label font-medium text-text tabular-nums">
            {`${answered} of ${total} ${total === 1 ? 'question' : 'questions'} answered`}
          </p>
          {/* The sentence carries the count; the dots echo it per question, in order. */}
          <span aria-hidden className="flex flex-wrap items-center gap-1">
            {asked.map((item, i) => (
              <span
                key={i}
                className={cn(
                  'size-2 rounded-full',
                  isAnswered(item) ? 'bg-accent forced-colors:bg-[CanvasText]' : 'border border-input',
                )}
              />
            ))}
          </span>
        </div>
      ) : null}
      {asked.length > 0 ? <Rows items={asked} onSeek={onSeek} /> : null}
      {extras.length > 0 ? (
        // The rule only parts it from the job's questions above, when there are any.
        <section className={cn('grid gap-3', asked.length > 0 && 'border-t border-border pt-4')}>
          <h3 className="m-0 text-label font-semibold text-text">Also mentioned</h3>
          <Rows items={extras} onSeek={onSeek} />
        </section>
      ) : null}
    </div>
  );
}
