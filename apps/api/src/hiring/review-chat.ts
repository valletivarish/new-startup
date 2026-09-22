/**
 * Grounded answers about a screening call — facts only, never hire advice.
 */

export interface ReviewChatSession {
  readonly voiceSessionId: string | null;
  readonly summary: string | null;
  readonly structuredAnswers: Readonly<Record<string, unknown>> | null;
  readonly transcript: ReadonlyArray<{ role?: string; message?: string }> | null;
  readonly fitPercent: number | null;
  readonly status: string | null;
  readonly startedAt: string | null;
}

const HIRE_ADVICE =
  /\b(hire|reject|should we|recommend|good fit|bad fit|select|shortlist|pass on)\b/i;

/**
 * Drop sentences that recommend hire/reject so provider summaries cannot leak
 * advice into review chat or the desk UI.
 */
export function scrubHireAdvice(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(/(?<=[.!?])\s+/).filter((p) => p.trim().length > 0);
  const kept = parts.filter((p) => !HIRE_ADVICE.test(p));
  if (kept.length === parts.length) return trimmed;
  if (kept.length === 0) {
    return 'Call notes are in the transcript and collected answers. Hire or reject decisions stay with you.';
  }
  return kept.join(' ');
}

function formatAnswers(answers: Readonly<Record<string, unknown>> | null): string {
  if (!answers || Object.keys(answers).length === 0) return '';
  return Object.entries(answers)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

function transcriptText(
  transcript: ReviewChatSession['transcript'],
): string {
  if (!transcript?.length) return '';
  return transcript
    .map((t) => {
      const who =
        t.role === 'agent' ? 'Agent' : t.role === 'user' ? 'Candidate' : t.role ?? 'Speaker';
      return `${who}: ${t.message ?? ''}`;
    })
    .join('\n');
}

function findAnswerByKeyword(
  answers: Readonly<Record<string, unknown>> | null,
  question: string,
): string | null {
  if (!answers) return null;
  const q = question.toLowerCase();
  for (const [key, value] of Object.entries(answers)) {
    const label = key.replace(/_/g, ' ').toLowerCase();
    const words = label.split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => q.includes(w)) || q.includes(label.slice(0, 12))) {
      const text = typeof value === 'string' ? value.trim() : JSON.stringify(value);
      if (text) return `From the collected answers — ${label}: ${text}`;
    }
  }
  return null;
}

function findInTranscript(
  transcript: ReviewChatSession['transcript'],
  question: string,
): string | null {
  if (!transcript?.length) return null;
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['what', 'when', 'where', 'they', 'said', 'about', 'tell', 'this', 'call', 'screen'].includes(w));
  if (tokens.length === 0) return null;

  const hits: string[] = [];
  for (const turn of transcript) {
    const msg = (turn.message ?? '').toLowerCase();
    if (tokens.some((t) => msg.includes(t))) {
      const who =
        turn.role === 'agent' ? 'Agent' : turn.role === 'user' ? 'Candidate' : 'Speaker';
      hits.push(`${who}: ${turn.message ?? ''}`);
    }
  }
  if (hits.length === 0) return null;
  return `From what was said on the call:\n${hits.slice(0, 6).join('\n')}`;
}

/**
 * Answer an HR question using only the selected screen's stored facts.
 */
export function answerReviewQuestion(
  sessions: readonly ReviewChatSession[],
  question: string,
  voiceSessionId?: string | null,
): { reply: string; voiceSessionId: string | null } {
  const q = question.trim();
  if (!q) {
    return { reply: 'Ask a question about this screen’s summary, answers, or what was said.', voiceSessionId: null };
  }

  if (HIRE_ADVICE.test(q)) {
    return {
      reply:
        'I only report what was collected on the call. I do not recommend hire or reject — that decision stays with you.',
      voiceSessionId: sessions[0]?.voiceSessionId ?? null,
    };
  }

  const session =
    (voiceSessionId
      ? sessions.find((s) => s.voiceSessionId === voiceSessionId)
      : undefined) ?? sessions[0];

  if (!session?.voiceSessionId) {
    return {
      reply: 'There is no screening call for this candidate yet.',
      voiceSessionId: null,
    };
  }

  const lower = q.toLowerCase();

  if (/\b(summary|summarize|overview)\b/.test(lower) && session.summary) {
    return {
      reply: scrubHireAdvice(session.summary),
      voiceSessionId: session.voiceSessionId,
    };
  }

  if (/\b(fit|score|percent|questions answered)\b/.test(lower)) {
    if (session.fitPercent == null) {
      return {
        reply:
          'Must-ask coverage is not set for this agent — add must-ask questions when creating the agent to see a score.',
        voiceSessionId: session.voiceSessionId,
      };
    }
    return {
      reply: `Must-ask coverage on this screen: ${session.fitPercent}% (share of clear answers collected — not a hire recommendation).`,
      voiceSessionId: session.voiceSessionId,
    };
  }

  const fromAnswers = findAnswerByKeyword(session.structuredAnswers, q);
  if (fromAnswers) {
    return { reply: fromAnswers, voiceSessionId: session.voiceSessionId };
  }

  const fromTranscript = findInTranscript(session.transcript, q);
  if (fromTranscript) {
    return {
      reply: scrubHireAdvice(fromTranscript),
      voiceSessionId: session.voiceSessionId,
    };
  }

  if (/\b(answer|answers|collected)\b/.test(lower)) {
    const block = formatAnswers(session.structuredAnswers);
    if (block) {
      return {
        reply: `Collected answers:\n${block}`,
        voiceSessionId: session.voiceSessionId,
      };
    }
  }

  // Fallback: compact fact pack so HR still gets something useful.
  const parts: string[] = [];
  if (session.summary) parts.push(`Summary: ${scrubHireAdvice(session.summary)}`);
  const answers = formatAnswers(session.structuredAnswers);
  if (answers) parts.push(`Answers:\n${answers}`);
  const said = transcriptText(session.transcript);
  if (said && parts.length < 2) {
    parts.push(`What was said:\n${scrubHireAdvice(said).slice(0, 1200)}`);
  }
  if (session.fitPercent != null) {
    parts.push(`Must-ask coverage: ${session.fitPercent}%`);
  }

  if (parts.length === 0) {
    return {
      reply:
        'This screen has no summary, answers, or transcript yet. Refresh results after the call ends, or ask again once results land.',
      voiceSessionId: session.voiceSessionId,
    };
  }

  return {
    reply: `I could not match that to a specific line. Here is what this screen has:\n\n${parts.join('\n\n')}`,
    voiceSessionId: session.voiceSessionId,
  };
}

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type ReviewChatLlmDeps = {
  apiKey: string;
  model?: string;
  fetchFn?: typeof fetch;
};

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

function pickSession(
  sessions: readonly ReviewChatSession[],
  voiceSessionId?: string | null,
): ReviewChatSession | undefined {
  return (
    (voiceSessionId
      ? sessions.find((s) => s.voiceSessionId === voiceSessionId)
      : undefined) ?? sessions[0]
  );
}

/** Build the grounded prompt for Gemini (exported for tests via call inspection). */
export function buildReviewChatPrompt(
  session: ReviewChatSession,
  question: string,
): string {
  const answers = formatAnswers(session.structuredAnswers);
  const said = transcriptText(session.transcript);
  return [
    'You help an HR recruiter review one completed phone/browser screening call.',
    'Answer only from the call facts below. If something was not said, say it was not covered.',
    'Do not recommend hiring or rejecting any candidate.',
    'Be concise and practical. Plain language a recruiter would say.',
    'If they ask for a summary, summarize only what was collected.',
    'If they ask for callback / follow-up questions, list 3–6 concrete questions targeting gaps or unclear answers from this call. One question per line. No hire advice.',
    '',
    `Call status: ${session.status ?? 'unknown'}`,
    session.startedAt ? `Started: ${session.startedAt}` : '',
    session.fitPercent != null
      ? `Must-ask coverage: ${session.fitPercent}% (not a hire score)`
      : 'Must-ask coverage: not set',
    '',
    'Summary:',
    scrubHireAdvice(session.summary ?? '') || '(none)',
    '',
    'Collected answers:',
    answers || '(none)',
    '',
    'Transcript:',
    scrubHireAdvice(said) || '(none)',
    '',
    `Recruiter question: ${question}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Gemini-backed review chat grounded on one screen's facts.
 * Falls back to deterministic lookup when GEMINI_API_KEY is empty.
 */
export async function answerReviewQuestionWithLlm(
  sessions: readonly ReviewChatSession[],
  question: string,
  voiceSessionId: string | null | undefined,
  deps: ReviewChatLlmDeps,
): Promise<{ reply: string; voiceSessionId: string | null }> {
  const q = question.trim();
  if (!q) {
    return {
      reply:
        'Ask a question about this screen’s summary, answers, or what was said.',
      voiceSessionId: null,
    };
  }

  if (HIRE_ADVICE.test(q)) {
    return {
      reply:
        'I only report what was collected on the call. I do not recommend hire or reject — that decision stays with you.',
      voiceSessionId: sessions[0]?.voiceSessionId ?? null,
    };
  }

  const apiKey = deps.apiKey.trim();
  if (!apiKey) {
    return answerReviewQuestion(sessions, q, voiceSessionId);
  }

  const session = pickSession(sessions, voiceSessionId);
  if (!session?.voiceSessionId) {
    return {
      reply: 'There is no screening call for this candidate yet.',
      voiceSessionId: null,
    };
  }

  const hasFacts =
    Boolean(session.summary?.trim()) ||
    Boolean(session.transcript?.length) ||
    Boolean(
      session.structuredAnswers &&
        Object.keys(session.structuredAnswers).length > 0,
    );
  if (!hasFacts) {
    return {
      reply:
        'This screen has no summary, answers, or transcript yet. Refresh results after the call ends, or ask again once results land.',
      voiceSessionId: session.voiceSessionId,
    };
  }

  const model = deps.model?.trim() || DEFAULT_MODEL;
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
          parts: [{ text: buildReviewChatPrompt(session, q) }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
  });

  const bodyText = await response.text();
  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(bodyText) as GeminiResponse;
  } catch {
    return answerReviewQuestion(sessions, q, voiceSessionId);
  }

  if (!response.ok || parsed.promptFeedback?.blockReason) {
    return answerReviewQuestion(sessions, q, voiceSessionId);
  }

  const raw = (parsed.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!raw) {
    return answerReviewQuestion(sessions, q, voiceSessionId);
  }

  return {
    reply: scrubHireAdvice(raw),
    voiceSessionId: session.voiceSessionId,
  };
}

export type ReviewChatStreamEvent =
  | { type: 'meta'; voiceSessionId: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      reply: string;
      voiceSessionId: string | null;
    };

/**
 * Streams Gemini tokens for review chat. Emits meta → delta* → done.
 * Falls back to a single done event when the API key is missing or streaming fails.
 */
export async function* streamReviewQuestionWithLlm(
  sessions: readonly ReviewChatSession[],
  question: string,
  voiceSessionId: string | null | undefined,
  deps: ReviewChatLlmDeps,
): AsyncGenerator<ReviewChatStreamEvent> {
  const q = question.trim();
  if (!q) {
    yield {
      type: 'done',
      reply:
        'Ask a question about this screen’s summary, answers, or what was said.',
      voiceSessionId: null,
    };
    return;
  }

  if (HIRE_ADVICE.test(q)) {
    yield {
      type: 'done',
      reply:
        'I only report what was collected on the call. I do not recommend hire or reject — that decision stays with you.',
      voiceSessionId: sessions[0]?.voiceSessionId ?? null,
    };
    return;
  }

  const apiKey = deps.apiKey.trim();
  if (!apiKey) {
    const fallback = answerReviewQuestion(sessions, q, voiceSessionId);
    yield {
      type: 'done',
      reply: fallback.reply,
      voiceSessionId: fallback.voiceSessionId,
    };
    return;
  }

  const session = pickSession(sessions, voiceSessionId);
  if (!session?.voiceSessionId) {
    yield {
      type: 'done',
      reply: 'There is no screening call for this candidate yet.',
      voiceSessionId: null,
    };
    return;
  }

  const hasFacts =
    Boolean(session.summary?.trim()) ||
    Boolean(session.transcript?.length) ||
    Boolean(
      session.structuredAnswers &&
        Object.keys(session.structuredAnswers).length > 0,
    );
  if (!hasFacts) {
    yield {
      type: 'done',
      reply:
        'This screen has no summary, answers, or transcript yet. Refresh results after the call ends, or ask again once results land.',
      voiceSessionId: session.voiceSessionId,
    };
    return;
  }

  yield { type: 'meta', voiceSessionId: session.voiceSessionId };

  const model = deps.model?.trim() || DEFAULT_MODEL;
  const fetchFn = deps.fetchFn ?? fetch;
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildReviewChatPrompt(session, q) }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      }),
    });
  } catch {
    const fallback = answerReviewQuestion(sessions, q, voiceSessionId);
    yield {
      type: 'done',
      reply: fallback.reply,
      voiceSessionId: fallback.voiceSessionId,
    };
    return;
  }

  if (!response.ok || !response.body) {
    const fallback = answerReviewQuestion(sessions, q, voiceSessionId);
    yield {
      type: 'done',
      reply: fallback.reply,
      voiceSessionId: fallback.voiceSessionId,
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let blocked = false;

  const takeFrames = (chunk: string, flush: boolean): string[] => {
    buffer += chunk.replace(/\r\n|\r/g, '\n');
    const frames: string[] = [];
    for (;;) {
      const split = buffer.indexOf('\n\n');
      if (split === -1) break;
      frames.push(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
    }
    if (flush && buffer.trim()) {
      frames.push(buffer);
      buffer = '';
    }
    return frames;
  };

  const parseFrame = (frame: string): string => {
    const payload = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
      .join('\n');
    if (!payload.trim() || payload.trim() === '[DONE]') return '';
    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(payload) as GeminiResponse;
    } catch {
      return '';
    }
    if (parsed.promptFeedback?.blockReason) {
      blocked = true;
      return '';
    }
    return (parsed.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = done
        ? ''
        : decoder.decode(value, { stream: true });
      for (const frame of takeFrames(text, done)) {
        const delta = parseFrame(frame);
        if (!delta) continue;
        accumulated += delta;
        yield { type: 'delta', text: delta };
      }
      if (done) break;
    }
  } catch {
    // Fall through to deterministic reply if stream breaks mid-way.
  } finally {
    reader.releaseLock();
  }

  if (blocked || !accumulated.trim()) {
    const fallback = answerReviewQuestion(sessions, q, voiceSessionId);
    yield {
      type: 'done',
      reply: fallback.reply,
      voiceSessionId: fallback.voiceSessionId,
    };
    return;
  }

  yield {
    type: 'done',
    reply: scrubHireAdvice(accumulated),
    voiceSessionId: session.voiceSessionId,
  };
}
