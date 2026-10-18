/**
 * Post-call extraction for own-loop screens: the job's must-ask answers and a
 * short summary, read from the transcript by the LLM. Same output shape the
 * review screen already reads for provider-hosted calls.
 *
 * Never throws: a call's transcript is saved regardless; missing answers just
 * show as missing.
 */

import { GEMINI_BASE } from '../providers/gemini/endpoint.js';
import { scrubHireAdvice } from './review-chat.js';

export interface ExtractDeps {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export interface ExtractInput {
  questions: readonly { id: string; label: string }[];
  transcript: readonly { role: string; message: string }[];
  language: 'en' | 'hi' | string;
}

export interface ExtractResult {
  summary: string | null;
  answers: Record<string, string>;
}

const EMPTY: ExtractResult = { summary: null, answers: {} };

function buildPrompt(input: ExtractInput): string {
  const lines = input.transcript
    .filter((t) => t.message.trim())
    .map((t) => `${t.role === 'user' ? 'Candidate' : 'Agent'}: ${t.message.trim()}`)
    .join('\n');
  const questions = input.questions.map((q) => `- ${q.id}: ${q.label}`).join('\n');
  return [
    'You read a phone screening transcript and report only what the candidate actually said.',
    'For each question id, give the candidate\'s answer in a short phrase, in English.',
    'Leave the answer empty when the candidate did not answer it. Never guess.',
    'Then write a 2-3 sentence neutral summary of what was collected.',
    'Never recommend hiring or rejecting, and never rate or rank the candidate.',
    '',
    'Questions:',
    questions || '(none)',
    '',
    'Transcript:',
    lines.slice(0, 60_000),
  ].join('\n');
}

export async function extractScreeningResult(
  input: ExtractInput,
  deps: ExtractDeps,
): Promise<ExtractResult> {
  if (!deps.apiKey.trim() || input.transcript.length === 0) return EMPTY;
  const fetchFn = deps.fetchFn ?? fetch;
  const model = deps.model?.trim() || 'gemini-2.5-flash-lite';
  const url = `${deps.baseUrl || GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              summary: { type: 'STRING' },
              answers: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: { id: { type: 'STRING' }, answer: { type: 'STRING' } },
                  required: ['id', 'answer'],
                },
              },
            },
            required: ['summary', 'answers'],
          },
        },
      }),
    });
    if (!res.ok) return EMPTY;
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text) as { summary?: unknown; answers?: unknown };

    const allowed = new Set(input.questions.map((q) => q.id));
    const answers: Record<string, string> = {};
    if (Array.isArray(parsed.answers)) {
      for (const a of parsed.answers) {
        if (!a || typeof a !== 'object') continue;
        const id = String((a as Record<string, unknown>)['id'] ?? '');
        const answer = String((a as Record<string, unknown>)['answer'] ?? '').trim();
        if (allowed.has(id) && answer) answers[id] = answer;
      }
    }
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? scrubHireAdvice(parsed.summary) || null
        : null;
    return { summary, answers };
  } catch {
    return EMPTY;
  }
}
