import { describe, it, expect } from 'vitest';
import { extractScreeningResult } from '../src/hiring/screening-extract.js';

const QUESTIONS = [
  { id: 'notice_period', label: 'What is your notice period?' },
  { id: 'current_ctc', label: 'What is your current CTC?' },
];
const TRANSCRIPT = [
  { role: 'agent', message: 'What is your notice period?' },
  { role: 'user', message: 'Thirty days.' },
];

function fakeFetch(reply: unknown, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }),
      { status },
    );
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('extractScreeningResult', () => {
  it('keeps only answers for the job questions, dropping blanks and unknown ids', async () => {
    const { fn, calls } = fakeFetch({
      summary: 'Notice period is thirty days. CTC not discussed.',
      answers: [
        { id: 'notice_period', answer: '30 days' },
        { id: 'current_ctc', answer: '' },
        { id: 'made_up', answer: 'x' },
      ],
    });
    const result = await extractScreeningResult(
      { questions: QUESTIONS, transcript: TRANSCRIPT, language: 'en' },
      { apiKey: 'k', baseUrl: 'https://example.test/v1/publishers/google', model: 'm', fetchFn: fn },
    );
    expect(result.summary).toBe('Notice period is thirty days. CTC not discussed.');
    expect(result.answers).toEqual({ notice_period: '30 days' });
    expect(calls[0]!.url).toBe('https://example.test/v1/publishers/google/models/m:generateContent');
  });

  it('scrubs hire/reject advice from the summary', async () => {
    const { fn } = fakeFetch({ summary: 'Strong fit. We should hire this candidate.', answers: [] });
    const result = await extractScreeningResult(
      { questions: QUESTIONS, transcript: TRANSCRIPT, language: 'en' },
      { apiKey: 'k', model: 'm', fetchFn: fn },
    );
    expect(result.summary ?? '').not.toMatch(/hire this candidate/i);
  });

  it('returns nothing (no throw) without a key or on a provider error', async () => {
    const none = await extractScreeningResult(
      { questions: QUESTIONS, transcript: TRANSCRIPT, language: 'en' },
      { apiKey: '' },
    );
    expect(none).toEqual({ summary: null, answers: {} });
    const { fn } = fakeFetch({}, 500);
    const failed = await extractScreeningResult(
      { questions: QUESTIONS, transcript: TRANSCRIPT, language: 'en' },
      { apiKey: 'k', fetchFn: fn, retryDelayMs: 0 },
    );
    expect(failed).toEqual({ summary: null, answers: {} });
  });

  it('retries a rate-limited request instead of losing the answers', async () => {
    let calls = 0;
    const fn = (async () => {
      calls += 1;
      const reply = { summary: 'Notice is thirty days.', answers: [{ id: 'notice_period', answer: '30 days' }] };
      return calls === 1
        ? new Response('{}', { status: 429 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
    }) as unknown as typeof fetch;
    const r = await extractScreeningResult(
      { questions: QUESTIONS, transcript: TRANSCRIPT, language: 'en' },
      { apiKey: 'k', fetchFn: fn, retryDelayMs: 0 },
    );
    expect(calls).toBe(2);
    expect(r.answers).toEqual({ notice_period: '30 days' });
  });
});
