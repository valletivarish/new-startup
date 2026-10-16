import type { Answer } from '../shared/answers-list';
import { scorecardRows } from './screening-answers';

/**
 * A call's structured answers as AnswersList rows: the job's questions in order (null when
 * nothing was said), then anything else the call collected, apart as extras. With no
 * questions to match, everything is an extra, so nothing counts as a question it wasn't.
 */
export function answerItems(
  answers: Record<string, unknown> | null | undefined,
  questions: readonly { id: string; label: string }[],
): Answer[] {
  return scorecardRows(answers, questions).map((row, i) => ({
    question: row.label,
    answer: row.answered && row.value !== 'None' ? row.value : null,
    extra: i >= questions.length,
  }));
}
