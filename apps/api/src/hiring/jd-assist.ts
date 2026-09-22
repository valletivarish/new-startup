/**
 * Job description assist — generate from role notes or format pasted text.
 * Uses Gemini generateContent. Never recommends hire/reject.
 */

import { ApiError } from '../errors.js';

const MIN_NOTES = 20;
const MAX_NOTES = 40_000;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type JdAssistMode = 'generate' | 'format' | 'questions';
export type JdAssistLanguage = 'en' | 'hi';

export type AssistJobDescriptionInput = {
  mode: JdAssistMode;
  title: string;
  notes: string;
  language: JdAssistLanguage;
};

export type AssistJobDescriptionDeps = {
  apiKey: string;
  model?: string;
  fetchFn?: typeof fetch;
};

export type AssistJobDescriptionResult = {
  /** JD text for generate/format. For questions mode, one question per line. */
  jdText: string;
  /** Parsed lines when mode is questions (same content as jdText). */
  questions?: string[];
};

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** Strip markdown fences Gemini sometimes wraps around the JD. */
export function cleanJdText(raw: string): string {
  let text = raw.trim();
  const fenced = /^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```$/;
  const match = fenced.exec(text);
  if (match?.[1]) {
    text = match[1].trim();
  }
  return text.replace(/\r\n/g, '\n').trim();
}

function buildPrompt(input: AssistJobDescriptionInput): string {
  const lang =
    input.language === 'hi'
      ? 'Write in Hindi (Devanagari).'
      : 'Write in clear English.';

  if (input.mode === 'questions') {
    return [
      'You help HR draft optional screening questions for an India hiring phone screen.',
      lang,
      'Output only the questions, one question per line. No numbering, no bullets, no preamble, no markdown.',
      'Suggest 4 to 8 practical questions grounded in the job description. Do not invent salary bands or company secrets.',
      'Do not recommend hiring or rejecting any candidate.',
      `Job title: ${input.title}`,
      'Job description:',
      input.notes,
    ].join('\n\n');
  }

  const sharedRules = [
    'You help HR write a job description for India hiring screens.',
    input.language === 'hi'
      ? 'Write the entire job description in Hindi (Devanagari).'
      : 'Write the entire job description in clear English.',
    'Output only the job description text. No preamble, no markdown fences, no commentary.',
    'Do not recommend hiring or rejecting any candidate.',
    'Do not invent salary, company secrets, or legal claims not present in the notes.',
  ].join(' ');

  if (input.mode === 'generate') {
    return [
      sharedRules,
      `Job title: ${input.title}`,
      'Turn the following roles and responsibilities notes into a clear, structured job description (summary, responsibilities, requirements).',
      'Notes:',
      input.notes,
    ].join('\n\n');
  }

  return [
    sharedRules,
    `Job title: ${input.title}`,
    'Clean up and format the following pasted job description. Fix structure and clarity; keep the meaning.',
    'Pasted text:',
    input.notes,
  ].join('\n\n');
}

/** Turn model output into clean question lines (optional screening list). */
export function parseSuggestedQuestions(raw: string): string[] {
  return cleanJdText(raw)
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')
        .trim(),
    )
    .filter((line) => line.length >= 8)
    .slice(0, 12);
}

export async function assistJobDescription(
  input: AssistJobDescriptionInput,
  deps: AssistJobDescriptionDeps,
): Promise<AssistJobDescriptionResult> {
  const apiKey = deps.apiKey.trim();
  if (!apiKey) {
    throw ApiError.conflict(
      input.mode === 'questions'
        ? 'Question suggestions are not configured. Type your own questions, leave them blank, or ask an admin to set GEMINI_API_KEY.'
        : 'Job description assist is not configured. You can type or paste a JD and save it, or ask an admin to set GEMINI_API_KEY.',
    );
  }

  const notes = input.notes.trim();
  if (notes.length < MIN_NOTES) {
    throw ApiError.validation([
      {
        field: 'notes',
        message:
          input.mode === 'questions'
            ? `Add or save a job description (at least ${MIN_NOTES} characters) before suggesting questions.`
            : `Add at least ${MIN_NOTES} characters of notes or pasted text.`,
      },
    ]);
  }
  if (notes.length > MAX_NOTES) {
    throw ApiError.validation([
      {
        field: 'notes',
        message: `Notes must be at most ${MAX_NOTES.toLocaleString()} characters.`,
      },
    ]);
  }

  const title = input.title.trim() || 'Open role';
  const model = (deps.model?.trim() || DEFAULT_MODEL);
  const fetchFn = deps.fetchFn ?? fetch;
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: buildPrompt({ ...input, title, notes }) }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    }),
  });

  const bodyText = await response.text();
  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(bodyText) as GeminiResponse;
  } catch {
    throw ApiError.conflict(
      input.mode === 'questions'
        ? 'Question suggestions returned an unreadable response. Try again, or type your own questions.'
        : 'Job description assist returned an unreadable response. Try again, or type and save the JD yourself.',
    );
  }

  if (!response.ok) {
    const detail = parsed.error?.message?.trim();
    throw ApiError.conflict(
      detail
        ? `Assist failed: ${detail}`
        : input.mode === 'questions'
          ? 'Could not suggest questions. Try again, or type your own.'
          : 'Job description assist failed. Try again, or type and save the JD yourself.',
    );
  }

  if (parsed.promptFeedback?.blockReason) {
    throw ApiError.conflict(
      input.mode === 'questions'
        ? 'Question suggestions were blocked. Edit the JD and try again, or type your own questions.'
        : 'Job description assist blocked this request. Edit the notes and try again, or type and save the JD yourself.',
    );
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const raw = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!raw) {
    throw ApiError.conflict(
      input.mode === 'questions'
        ? 'No questions came back. Try again, or type your own.'
        : 'Job description assist returned empty text. Try again, or type and save the JD yourself.',
    );
  }

  if (input.mode === 'questions') {
    const questions = parseSuggestedQuestions(raw);
    if (questions.length === 0) {
      throw ApiError.conflict(
        'No usable questions came back. Try again, or type your own.',
      );
    }
    return { jdText: questions.join('\n'), questions };
  }

  return { jdText: cleanJdText(raw) };
}
