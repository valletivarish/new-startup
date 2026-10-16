import { describe, expect, it } from 'vitest';
import { answerItems } from './answers';

const QUESTIONS = [
  { id: 'java', label: 'How many years have you worked with Java?' },
  { id: 'spring', label: 'Describe a Spring Boot service you built.' },
];

describe('answerItems', () => {
  it('keeps the job questions in order, unanswered ones as null, then what else was said', () => {
    expect(answerItems({ notice: '30 days', spring: '', java: 'Six years' }, QUESTIONS)).toEqual([
      { question: QUESTIONS[0]!.label, answer: 'Six years', extra: false },
      { question: QUESTIONS[1]!.label, answer: null, extra: false },
      { question: 'Notice', answer: '30 days', extra: true },
    ]);
  });

  it('counts nothing as a question when the job has none', () => {
    expect(answerItems({ notice: '30 days' }, [])).toEqual([{ question: 'Notice', answer: '30 days', extra: true }]);
    expect(answerItems(null, [])).toEqual([]);
  });
});
