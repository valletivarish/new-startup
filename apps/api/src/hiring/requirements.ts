/**
 * Job requirements and the fit sheet (docs/superpowers/specs/2026-10-21-recruiter-grade-screening-design.md).
 *
 *   JobRequirements          what HR says the role needs; all optional.
 *   requirementList          the requirements as checkable lines, in recruiter words.
 *   requirementsPromptBlock  the same lines for the call prompt.
 *   draftRequirements        Gemini reads the JD and proposes requirements (HR reviews; never saved here).
 *   evaluateFit              Gemini checks a call against the requirements: met | not_met | unclear
 *                            per line with the evidence. Never throws: falls back to all unclear.
 *   overallFit               the deterministic overall: meets_all | check | doesnt_meet.
 *
 * The AI never invents criteria and never judges a person: every verdict is about one of HR's lines.
 */

import { z } from 'zod';

import { ApiError } from '../errors.js';
import { GEMINI_BASE } from '../providers/gemini/endpoint.js';

export const WORK_MODES = ['on_site', 'hybrid', 'remote'] as const;

const Lakh = z.number().min(0).max(1000);

export const JobRequirements = z
  .object({
    salaryMinLakh: Lakh.nullable().default(null),
    salaryMaxLakh: Lakh.nullable().default(null),
    salaryFlexible: z.boolean().default(false),
    maxNoticeDays: z.number().int().min(0).max(365).nullable().default(null),
    workMode: z.enum(WORK_MODES).nullable().default(null),
    officeDaysPerWeek: z.number().int().min(1).max(7).nullable().default(null),
    city: z.string().trim().max(100).nullable().default(null).transform((v) => v || null),
    mustHaves: z
      .array(z.string().trim().min(1).max(200))
      .max(5)
      .default([]),
    nightShiftRequired: z.boolean().default(false),
    replyWithinWorkingDays: z.number().int().min(1).max(30).default(3),
  })
  .strict()
  .refine(
    (r) => r.salaryMinLakh === null || r.salaryMaxLakh === null || r.salaryMinLakh <= r.salaryMaxLakh,
    { message: 'Minimum salary must not be above the maximum.', path: ['salaryMinLakh'] },
  );

export type JobRequirements = z.output<typeof JobRequirements>;

export const EMPTY_REQUIREMENTS: JobRequirements = JobRequirements.parse({});

/** Stored jsonb → requirements; anything unreadable reads as none set. */
export function parseStoredRequirements(raw: unknown): JobRequirements | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = JobRequirements.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface RequirementLine {
  /** Stable key: salary | notice | work_mode | night_shift | must_have_1..5 */
  readonly requirement: string;
  readonly label: string;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** The requirements HR set, as lines a recruiter would check. Empty when none are set. */
export function requirementList(r: JobRequirements | null): RequirementLine[] {
  if (!r) return [];
  const out: RequirementLine[] = [];
  const { salaryMinLakh: min, salaryMaxLakh: max } = r;
  if (min !== null || max !== null) {
    const range =
      min !== null && max !== null
        ? min === max
          ? `around ${num(max)} lakh a year`
          : `within ${num(min)} to ${num(max)} lakh a year`
        : max !== null
          ? `up to ${num(max)} lakh a year`
          : `from ${num(min!)} lakh a year`;
    out.push({ requirement: 'salary', label: `Expected salary ${range}${r.salaryFlexible ? ' (budget is flexible)' : ''}` });
  }
  if (r.maxNoticeDays !== null) {
    out.push({
      requirement: 'notice',
      label: r.maxNoticeDays === 0 ? 'Can join immediately' : `Notice period of ${r.maxNoticeDays} days or less`,
    });
  }
  const where = r.city ? ` in ${r.city}` : '';
  if (r.workMode === 'on_site') out.push({ requirement: 'work_mode', label: `Can work on-site${where}` });
  else if (r.workMode === 'hybrid') {
    const days = r.officeDaysPerWeek ? `, ${r.officeDaysPerWeek} office day${r.officeDaysPerWeek === 1 ? '' : 's'} a week` : '';
    out.push({ requirement: 'work_mode', label: `Can work hybrid${days}${where}` });
  } else if (r.workMode === 'remote') out.push({ requirement: 'work_mode', label: 'Okay working remotely' });
  else if (r.city) out.push({ requirement: 'work_mode', label: `Can work from ${r.city}` });
  if (r.nightShiftRequired) out.push({ requirement: 'night_shift', label: 'Okay with night shifts' });
  r.mustHaves.forEach((m, i) => out.push({ requirement: `must_have_${i + 1}`, label: m }));
  return out;
}

/** The requirements as context for the call prompt; '' when none are set. */
export function requirementsPromptBlock(r: JobRequirements | null): string {
  const lines = requirementList(r);
  if (lines.length === 0) return '';
  return [
    'What the hiring team needs for this role (context for your follow-ups; do not read it out as a list, and do not tell the candidate whether they meet it):',
    ...lines.map((l) => `- ${l.label}`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Gemini

export interface GeminiDeps {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

/** One JSON generateContent call; returns the parsed object or throws. */
async function geminiJson(prompt: string, schema: unknown, deps: GeminiDeps): Promise<Record<string, unknown>> {
  const model = deps.model?.trim() || 'gemini-2.5-flash-lite';
  const url = `${deps.baseUrl || GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const res = await (deps.fetchFn ?? fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fill from description

const DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    salaryMinLakh: { type: 'NUMBER', nullable: true },
    salaryMaxLakh: { type: 'NUMBER', nullable: true },
    maxNoticeDays: { type: 'INTEGER', nullable: true },
    workMode: { type: 'STRING', enum: [...WORK_MODES], nullable: true },
    officeDaysPerWeek: { type: 'INTEGER', nullable: true },
    city: { type: 'STRING', nullable: true },
    mustHaves: { type: 'ARRAY', items: { type: 'STRING' } },
    nightShiftRequired: { type: 'BOOLEAN' },
  },
  required: ['mustHaves', 'nightShiftRequired'],
};

/** Keep each drafted field only when it is valid on its own; everything else stays unset. */
function coerceDraft(raw: Record<string, unknown>): JobRequirements {
  const pick = <K extends keyof JobRequirements>(key: K): Partial<JobRequirements> => {
    const one = JobRequirements.safeParse({ [key]: raw[key] });
    return one.success ? { [key]: one.data[key] } : {};
  };
  const mustHaves = Array.isArray(raw['mustHaves'])
    ? raw['mustHaves'].filter((m): m is string => typeof m === 'string').map((m) => m.trim().slice(0, 200)).filter(Boolean).slice(0, 5)
    : [];
  const draft = {
    ...EMPTY_REQUIREMENTS,
    ...pick('salaryMinLakh'),
    ...pick('salaryMaxLakh'),
    ...pick('maxNoticeDays'),
    ...pick('workMode'),
    ...pick('officeDaysPerWeek'),
    ...pick('city'),
    ...pick('nightShiftRequired'),
    mustHaves,
  };
  if (draft.workMode !== 'hybrid') draft.officeDaysPerWeek = null;
  if (draft.salaryMinLakh !== null && draft.salaryMaxLakh !== null && draft.salaryMinLakh > draft.salaryMaxLakh) {
    draft.salaryMinLakh = null;
  }
  return draft;
}

/** Proposes requirements from the job description. Never saves; HR reviews first. */
export async function draftRequirements(
  input: { title: string; description: string },
  deps: GeminiDeps,
): Promise<JobRequirements> {
  if (!deps.apiKey.trim()) {
    throw ApiError.conflict('Fill from description is not configured. Fill the requirements in yourself, or ask an admin to set GEMINI_API_KEY.');
  }
  const description = input.description.trim();
  if (description.length < 20) {
    throw ApiError.validation([{ field: 'description', message: 'Save a job description (at least 20 characters) before filling from it.' }]);
  }
  const prompt = [
    'You help HR in India fill in the requirements sheet for a job, reading only the job description below.',
    'Fill a field only when the description states it. Leave it null (or the list empty, or false) when it does not. Never guess.',
    'salaryMinLakh / salaryMaxLakh: the yearly pay range in lakh rupees (e.g. "6-8 LPA" = 6 and 8; "₹50,000 a month" = 6).',
    'maxNoticeDays: the longest notice period accepted, in days ("immediate joiners" = 0, "within a month" = 30).',
    'workMode: on_site, hybrid or remote. officeDaysPerWeek only for hybrid. city: where the office is.',
    'mustHaves: at most 5 short lines of must-have skills or experience, e.g. "3+ years Java". Only hard requirements, not nice-to-haves.',
    'nightShiftRequired: true only when the role needs night or rotational night shifts.',
    '',
    `Job title: ${input.title}`,
    'Job description:',
    description.slice(0, 40_000),
  ].join('\n');
  let raw: Record<string, unknown>;
  try {
    raw = await geminiJson(prompt, DRAFT_SCHEMA, deps);
  } catch {
    throw ApiError.conflict('Could not read requirements from the description. Try again, or fill them in yourself.');
  }
  return coerceDraft(raw);
}

// ---------------------------------------------------------------------------
// Fit

export const FIT_VERDICTS = ['met', 'not_met', 'unclear'] as const;
export const FIT_FLAG_KINDS = ['competing_offer', 'flexibility', 'contradiction', 'unanswered_question', 'other'] as const;
export type FitVerdict = (typeof FIT_VERDICTS)[number];
export type FitOverall = 'meets_all' | 'check' | 'doesnt_meet';

export interface FitItem {
  readonly requirement: string;
  readonly label: string;
  readonly verdict: FitVerdict;
  /** The candidate's words, one line. Null when nothing was said about it. */
  readonly evidence: string | null;
  /** Second in the call the evidence was said; null when unknown. */
  readonly atSeconds: number | null;
}

export interface FitFlag {
  readonly kind: (typeof FIT_FLAG_KINDS)[number];
  readonly text: string;
  readonly atSeconds: number | null;
  /** The requirement this flag is about (flexibility on a not-met line keeps it at "check"). */
  readonly requirement: string | null;
}

export interface CallFit {
  readonly overall: FitOverall;
  readonly items: readonly FitItem[];
  readonly flags: readonly FitFlag[];
}

/**
 * meets_all: every set requirement met. doesnt_meet: any not_met the candidate offered no
 * flexibility on. Otherwise check (something unclear, or not met but flexible).
 */
export function overallFit(items: readonly FitItem[], flags: readonly FitFlag[]): FitOverall {
  const flexibleOn = new Set(flags.filter((f) => f.kind === 'flexibility' && f.requirement).map((f) => f.requirement));
  if (items.some((i) => i.verdict === 'not_met' && !flexibleOn.has(i.requirement))) return 'doesnt_meet';
  if (items.length > 0 && items.every((i) => i.verdict === 'met')) return 'meets_all';
  return 'check';
}

export interface FitTurn {
  readonly role: string;
  readonly message: string;
  readonly timeInCallSecs?: number;
}

export interface FitInput {
  readonly requirements: JobRequirements;
  readonly transcript: readonly FitTurn[];
  /** Extracted must-ask answers, keyed by question label. */
  readonly answers: Readonly<Record<string, string>>;
}

const FIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          requirement: { type: 'STRING' },
          verdict: { type: 'STRING', enum: [...FIT_VERDICTS] },
          evidence: { type: 'STRING' },
          atSeconds: { type: 'NUMBER', nullable: true },
        },
        required: ['requirement', 'verdict', 'evidence'],
      },
    },
    flags: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: [...FIT_FLAG_KINDS] },
          text: { type: 'STRING' },
          atSeconds: { type: 'NUMBER', nullable: true },
          requirement: { type: 'STRING', nullable: true },
        },
        required: ['kind', 'text'],
      },
    },
  },
  required: ['items', 'flags'],
};

function fitPrompt(input: FitInput, lines: readonly RequirementLine[]): string {
  const transcript = input.transcript
    .filter((t) => t.message.trim())
    .map((t) => {
      const at = typeof t.timeInCallSecs === 'number' ? `[${Math.round(t.timeInCallSecs)}s] ` : '';
      return `${at}${t.role === 'user' ? 'Candidate' : 'Agent'}: ${t.message.trim()}`;
    })
    .join('\n');
  const answers = Object.entries(input.answers)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return [
    'You check a phone screening call against the requirements the hiring team wrote. You report facts; you never judge the person.',
    'For each requirement key, decide from what the candidate actually said:',
    '- met: the candidate clearly meets it.',
    '- not_met: the candidate clearly does not (for example expects more than the budget, a longer notice, will not work the stated mode or shifts, lacks the stated must-have).',
    '- unclear: it did not come up, the answer was vague, or it is borderline. Never guess; when in doubt say unclear.',
    'A flexible budget means an expectation a little above the maximum is unclear, not not_met.',
    'evidence: the candidate\'s own words in one short line (translated to English if needed); empty when nothing was said. atSeconds: the [Ns] marker of that line, or null.',
    'Then list flags HR should know, each one short: competing_offer (offers in hand or other interviews), flexibility (the candidate said they can be flexible on a requirement: set requirement to its key),',
    'contradiction (two answers that do not agree), unanswered_question (the candidate asked something the agent could not answer), other. No flags when there is nothing to note.',
    'Never mention age, religion, caste, marital status, family plans or health, even if the candidate did.',
    '',
    'Requirements:',
    ...lines.map((l) => `- ${l.requirement}: ${l.label}`),
    '',
    'Answers already extracted from the call:',
    answers || '(none)',
    '',
    'Transcript:',
    transcript.slice(0, 60_000),
  ].join('\n');
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const secs = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** Fit for one call; null when no requirements are set. Never throws (falls back to all unclear). */
export async function evaluateFit(input: FitInput, deps: GeminiDeps): Promise<CallFit | null> {
  const lines = requirementList(input.requirements);
  if (lines.length === 0) return null;
  const unclear = (l: RequirementLine): FitItem => ({ ...l, verdict: 'unclear', evidence: null, atSeconds: null });
  const fallback = (): CallFit => {
    const items = lines.map(unclear);
    return { overall: overallFit(items, []), items, flags: [] };
  };
  if (!deps.apiKey.trim() || !input.transcript.some((t) => t.role === 'user' && t.message.trim())) return fallback();

  try {
    const raw = await geminiJson(fitPrompt(input, lines), FIT_SCHEMA, deps);
    const byKey = new Map<string, Record<string, unknown>>();
    for (const it of Array.isArray(raw['items']) ? raw['items'] : []) {
      if (it && typeof it === 'object') byKey.set(str((it as Record<string, unknown>)['requirement']), it as Record<string, unknown>);
    }
    const items = lines.map((l): FitItem => {
      const it = byKey.get(l.requirement);
      const verdict = (FIT_VERDICTS as readonly string[]).includes(str(it?.['verdict'])) ? (str(it?.['verdict']) as FitVerdict) : 'unclear';
      return { ...l, verdict, evidence: str(it?.['evidence']) || null, atSeconds: secs(it?.['atSeconds']) };
    });
    const keys = new Set(lines.map((l) => l.requirement));
    const flags: FitFlag[] = (Array.isArray(raw['flags']) ? raw['flags'] : [])
      .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
      .map((f) => ({
        kind: (FIT_FLAG_KINDS as readonly string[]).includes(str(f['kind'])) ? (str(f['kind']) as FitFlag['kind']) : 'other',
        text: str(f['text']),
        atSeconds: secs(f['atSeconds']),
        requirement: keys.has(str(f['requirement'])) ? str(f['requirement']) : null,
      }))
      .filter((f) => f.text)
      .slice(0, 10);
    return { overall: overallFit(items, flags), items, flags };
  } catch {
    return fallback();
  }
}

/** Stored fit jsonb → CallFit, or null when missing/unreadable. */
export function parseStoredFit(raw: unknown): CallFit | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!['meets_all', 'check', 'doesnt_meet'].includes(String(r['overall'])) || !Array.isArray(r['items'])) return null;
  return {
    overall: r['overall'] as FitOverall,
    items: r['items'] as FitItem[],
    flags: Array.isArray(r['flags']) ? (r['flags'] as FitFlag[]) : [],
  };
}

/** Without transcript access the verdicts stay, the candidate's words go. */
export function redactFit(fit: CallFit | null, allowTranscript: boolean): CallFit | null {
  if (!fit || allowTranscript) return fit;
  return {
    overall: fit.overall,
    items: fit.items.map((i) => ({ ...i, evidence: null })),
    flags: fit.flags.map((f) => ({ ...f, text: '' })),
  };
}
