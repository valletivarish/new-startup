import { describe, expect, it, vi } from 'vitest';
import {
  answerReviewQuestion,
  answerReviewQuestionWithLlm,
  type ReviewChatSession,
} from '../src/hiring/review-chat.js';

const session = (over: Partial<ReviewChatSession> = {}): ReviewChatSession => ({
  voiceSessionId: '11111111-1111-1111-1111-111111111111',
  summary: 'Candidate confirmed Hyderabad and a 30-day notice.',
  structuredAnswers: {
    notice_period: '30 days',
    current_location: 'Hyderabad',
  },
  transcript: [
    { role: 'agent', message: 'What is your notice period?' },
    { role: 'user', message: 'I can join in 30 days.' },
    { role: 'agent', message: 'Where are you based?' },
    { role: 'user', message: 'Hyderabad.' },
  ],
  fitPercent: 100,
  status: 'ended',
  startedAt: '2026-09-16T10:00:00.000Z',
  ...over,
});

describe('answerReviewQuestion', () => {
  it('refuses hire / reject advice', () => {
    const out = answerReviewQuestion([session()], 'Should we hire this person?');
    expect(out.reply).toMatch(/do not recommend hire or reject/i);
  });

  it('returns the stored summary', () => {
    const out = answerReviewQuestion([session()], 'Give me a summary');
    expect(out.reply).toContain('Hyderabad');
    expect(out.reply).toContain('30-day notice');
  });

  it('scrubs hire advice out of stored summaries', () => {
    const out = answerReviewQuestion(
      [
        session({
          summary:
            'Candidate confirmed Hyderabad. We should hire them immediately.',
        }),
      ],
      'Give me a summary',
    );
    expect(out.reply).toContain('Hyderabad');
    expect(out.reply.toLowerCase()).not.toMatch(/should hire/);
  });

  it('answers from structured fields by keyword', () => {
    const out = answerReviewQuestion([session()], 'What about their notice period?');
    expect(out.reply.toLowerCase()).toContain('30 days');
  });

  it('answers from transcript when answers miss', () => {
    const out = answerReviewQuestion(
      [session({ structuredAnswers: {} })],
      'What did they say about joining?',
    );
    expect(out.reply).toMatch(/30 days/i);
  });

  it('explains missing fit % without inventing a score', () => {
    const out = answerReviewQuestion(
      [session({ fitPercent: null })],
      'What is the fit score?',
    );
    expect(out.reply).toMatch(/not set/i);
    expect(out.reply).not.toMatch(/\d+%/);
  });

  it('reports real fit % when present', () => {
    const out = answerReviewQuestion([session()], 'What is the fit percent?');
    expect(out.reply).toContain('100%');
    expect(out.reply).toMatch(/not a hire recommendation/i);
  });

  it('handles empty sessions', () => {
    const out = answerReviewQuestion([], 'What happened?');
    expect(out.reply).toMatch(/no screening call/i);
    expect(out.voiceSessionId).toBeNull();
  });
});

describe('answerReviewQuestionWithLlm', () => {
  it('refuses hire advice without calling Gemini', async () => {
    const fetchFn = vi.fn();
    const out = await answerReviewQuestionWithLlm(
      [session()],
      'Should we hire them?',
      null,
      { apiKey: 'test-key', fetchFn },
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(out.reply).toMatch(/do not recommend hire or reject/i);
  });

  it('grounds Gemini on call facts and scrubs hire advice from the reply', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'They said 30 days notice. I recommend we hire them.',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const out = await answerReviewQuestionWithLlm(
      [session()],
      'What is their notice period?',
      null,
      { apiKey: 'test-key', fetchFn },
    );

    expect(fetchFn).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (fetchFn.mock.calls[0]![1] as { body: string }).body,
    ) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const prompt = body.contents[0]!.parts[0]!.text;
    expect(prompt).toContain('30 days');
    expect(prompt).toContain('Hyderabad');
    expect(prompt).toMatch(/do not recommend hiring or rejecting/i);
    expect(out.reply).toContain('30 days');
    expect(out.reply.toLowerCase()).not.toMatch(/recommend we hire/);
    expect(out.voiceSessionId).toBe(session().voiceSessionId);
  });

  it('falls back to fact lookup when API key is missing', async () => {
    const out = await answerReviewQuestionWithLlm(
      [session()],
      'Give me a summary',
      null,
      { apiKey: '', fetchFn: vi.fn() },
    );
    expect(out.reply).toContain('Hyderabad');
  });

  it('drafts callback questions from call gaps when asked', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: [
                        'What databases have you used in production?',
                        'How do you handle transactions and consistency?',
                      ].join('\n'),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const out = await answerReviewQuestionWithLlm(
      [
        session({
          structuredAnswers: {
            how_do_you_handle_database_transactions_and_consistency: '',
          },
        }),
      ],
      'Draft questions for a callback about gaps from this screen',
      null,
      { apiKey: 'test-key', fetchFn },
    );

    expect(out.reply.toLowerCase()).toMatch(/database|transaction/);
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

describe('streamReviewQuestionWithLlm', () => {
  it('streams deltas then a scrubbed done event', async () => {
    const { streamReviewQuestionWithLlm } = await import(
      '../src/hiring/review-chat.js'
    );
    type StreamEvent = Awaited<
      ReturnType<typeof streamReviewQuestionWithLlm> extends AsyncGenerator<
        infer E
      >
        ? E
        : never
    >;
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"They said "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"30 days. Hire them."}]}}]}\n\n';
    const fetchFn = vi.fn(
      async () =>
        new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );

    const events: StreamEvent[] = [];
    for await (const event of streamReviewQuestionWithLlm(
      [session()],
      'What is their notice period?',
      null,
      { apiKey: 'test-key', fetchFn },
    )) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      type: 'meta',
      voiceSessionId: '11111111-1111-1111-1111-111111111111',
    });
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reply).toMatch(/30 days/i);
      expect(done.reply).not.toMatch(/hire them/i);
    }
  });
});
