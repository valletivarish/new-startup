import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/errors.js';
import { assistJobDescription, cleanJdText } from '../src/hiring/jd-assist.js';

const NOTES =
  'Own backend services, mentor juniors, and ship reliable APIs for India hiring.';

function geminiOk(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('cleanJdText', () => {
  it('strips markdown fences', () => {
    expect(cleanJdText('```markdown\nHello role\n```')).toBe('Hello role');
    expect(cleanJdText('```\nPlain\n```')).toBe('Plain');
  });

  it('trims plain text', () => {
    expect(cleanJdText('  Job title\n\n  ')).toBe('Job title');
  });
});

describe('assistJobDescription', () => {
  it('generates a JD via Gemini', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/models/gemini-3.5-flash-lite:generateContent');
      expect(init?.headers).toMatchObject({
        'x-goog-api-key': 'test-key',
      });
      const body = JSON.parse(String(init?.body)) as {
        contents: { parts: { text: string }[] }[];
      };
      const prompt = body.contents[0]?.parts[0]?.text ?? '';
      expect(prompt).toMatch(/Senior Engineer/);
      expect(prompt).toMatch(/do not recommend hiring/i);
      expect(prompt).toMatch(/English/);
      return geminiOk('## Senior Engineer\n\nBuild things.');
    });

    const out = await assistJobDescription(
      {
        mode: 'generate',
        title: 'Senior Engineer',
        notes: NOTES,
        language: 'en',
      },
      { apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(out.jdText).toContain('Senior Engineer');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('formats pasted text and asks for Hindi when language is hi', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: { parts: { text: string }[] }[];
      };
      const prompt = body.contents[0]?.parts[0]?.text ?? '';
      expect(prompt).toMatch(/Hindi/);
      expect(prompt).toMatch(/format/i);
      return geminiOk('```\nसाफ जॉब विवरण\n```');
    });

    const out = await assistJobDescription(
      {
        mode: 'format',
        title: 'Backend',
        notes: NOTES,
        language: 'hi',
      },
      { apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(out.jdText).toBe('साफ जॉब विवरण');
  });

  it('conflicts clearly when GEMINI_API_KEY is missing', async () => {
    await expect(
      assistJobDescription(
        {
          mode: 'generate',
          title: 'Role',
          notes: NOTES,
          language: 'en',
        },
        { apiKey: '' },
      ),
    ).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
      message: expect.stringMatching(/GEMINI_API_KEY|type or paste|admin/i),
    } satisfies Partial<ApiError>);
  });

  it('rejects notes that are too short', async () => {
    await expect(
      assistJobDescription(
        {
          mode: 'format',
          title: 'Role',
          notes: 'too short',
          language: 'en',
        },
        { apiKey: 'test-key' },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
  });

  it('suggests screening questions from a JD without auto-saving', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: { parts: { text: string }[] }[];
      };
      const prompt = body.contents[0]?.parts[0]?.text ?? '';
      expect(prompt).toMatch(/optional screening questions/i);
      expect(prompt).toMatch(/one question per line/i);
      return geminiOk(
        '1. How have you shipped Java APIs in production?\n2. Walk through a Spring Boot service you owned.\n- What is your notice period?',
      );
    });

    const out = await assistJobDescription(
      {
        mode: 'questions',
        title: 'Java Backend Developer',
        notes: NOTES,
        language: 'en',
      },
      { apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(out.questions).toEqual([
      'How have you shipped Java APIs in production?',
      'Walk through a Spring Boot service you owned.',
      'What is your notice period?',
    ]);
    expect(out.jdText).toContain('notice period');
  });
});
