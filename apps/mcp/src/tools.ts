/** The HRVoice MCP tools: thin wrappers over @hrvoice/sdk. No business logic lives here. */

import { HRVoiceError, LANGUAGES, type HRVoice } from '@hrvoice/sdk';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type Sdk = Pick<
  HRVoice,
  'createJob' | 'listJobs' | 'addCandidates' | 'startCall' | 'getCall' | 'getResults' | 'listCandidates' | 'getUsage'
>;

interface Tool<S extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: S;
  readOnly: boolean;
  run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}
const tool = <S extends z.ZodRawShape>(t: Tool<S>) => t;

const id = (what: string) => z.string().uuid().describe(what);

const Candidate = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().min(1).max(30).optional().describe('National number, e.g. 9876543210. Omit if unknown.'),
  countryCode: z.string().max(8).optional().describe('Default +91.'),
  email: z.string().email().optional(),
  externalId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("The candidate's id in the user's own system. Adding the same externalId again updates that candidate."),
  resumeText: z.string().max(100_000).optional(),
});

export function tools(hv: Sdk) {
  return {
    create_job: tool({
      title: 'Create job',
      description:
        'Create a hiring job in HRVoice. The phone screen asks the must-ask questions on every call for this job ' +
        '(e.g. notice period, expected salary, joining date). Returns the job with its id.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Job title, e.g. "Java Developer".'),
        description: z.string().max(20_000).optional().describe('Job description the screener can draw on.'),
        mustAskQuestions: z.array(z.string().min(1).max(500)).max(20).optional(),
        language: z.enum(LANGUAGES).optional().describe('Screening language code. Default en.'),
      },
      readOnly: false,
      run: (a) => hv.createJob(a),
    }),

    list_jobs: tool({
      title: 'List jobs',
      description: "List this company's HRVoice jobs (id, title, status, language, questions).",
      inputSchema: {},
      readOnly: true,
      run: () => hv.listJobs(),
    }),

    add_candidates: tool({
      title: 'Add candidates',
      description:
        'Add 1-100 candidates to a job. Only call this after the user has confirmed every candidate agreed to be ' +
        'called (set consent: true); HRVoice refuses candidates without consent. A candidate with an externalId ' +
        'already on the job is updated, not duplicated. Returns each candidate with its id and whether it was created.',
      inputSchema: {
        jobId: id('The job id from create_job or list_jobs.'),
        candidates: z.array(Candidate).min(1).max(100),
        consent: z.literal(true).describe('The user confirms each candidate consented to a screening call.'),
      },
      readOnly: false,
      run: (a) => hv.addCandidates(a.jobId, a.candidates.map((c) => ({ ...c, consent: true as const }))),
    }),

    start_call: tool({
      title: 'Start screening call',
      description:
        'Queue a phone screening call to one candidate (who needs a phone number). The call runs in the background ' +
        'and takes a few minutes; poll get_call or get_results. Outside 09:00-20:00 India time live calls are ' +
        "scheduled for the next window. With a test key the call goes to HRVoice's fake line and is free.",
      inputSchema: { jobId: id('The job id.'), candidateId: id('The candidate id from add_candidates.') },
      readOnly: false,
      run: (a) => hv.startCall(a.jobId, a.candidateId),
    }),

    get_call: tool({
      title: 'Get call',
      description:
        'A call from start_call: status queued, scheduled (waiting for calling hours), placing, placed (dialled), ' +
        'skipped (reason given, e.g. dnd) or failed, plus result once the conversation has ended ' +
        '(result.status "ended" means the screen finished).',
      inputSchema: { callId: id('The call id returned by start_call.') },
      readOnly: true,
      run: (a) => hv.getCall(a.callId),
    }),

    get_results: tool({
      title: 'Get screening results',
      description:
        "The candidate's latest screen: status, the answer to each question and a neutral summary. These are facts " +
        'for a person to judge; HRVoice gives no score or hire/reject advice, and you should not invent one.',
      inputSchema: {
        jobId: id('The job id.'),
        candidateId: id('The candidate id.'),
        includeTranscript: z.boolean().optional().describe('Also return the full transcript. Default false.'),
      },
      readOnly: true,
      run: async (a) => {
        const r = await hv.getResults(a.jobId, a.candidateId);
        if (a.includeTranscript) return r;
        const { transcript: _t, ...rest } = r;
        return rest;
      },
    }),

    list_candidates: tool({
      title: 'List candidates',
      description: "One page of a job's candidates (id, name, phone, status, externalId). Pass nextCursor back as cursor for more.",
      inputSchema: {
        jobId: id('The job id.'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
        cursor: z.string().optional(),
      },
      readOnly: true,
      run: (a) => hv.listCandidates(a.jobId, { ...(a.limit ? { limit: a.limit } : {}), ...(a.cursor ? { cursor: a.cursor } : {}) }),
    }),

    get_usage: tool({
      title: 'Get usage',
      description: 'Calls placed and completed (billable) screens for a month. Test-key calls are not counted.',
      inputSchema: {
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('YYYY-MM. Default this month (India time).'),
      },
      readOnly: true,
      run: (a) => hv.getUsage(a.month ? { month: a.month } : {}),
    }),
  };
}

const SCORE_KEY = /fit_?percent|score|recommend/i;

/** Belt and braces: /v1 never sends scores, and nothing score-like reaches the model if it ever did. */
export function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SCORE_KEY.test(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

/** Runs a tool and shapes the MCP result; API errors become tool errors the model can read. */
export async function call<S extends z.ZodRawShape>(t: Tool<S>, args: z.infer<z.ZodObject<S>>) {
  try {
    const out = scrub(await t.run(args));
    return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    const text =
      e instanceof HRVoiceError
        ? `HRVoice ${e.status} ${e.code}: ${e.message}` +
          (e.fields.length ? ` (${e.fields.map((f) => `${f.field}: ${f.message}`).join('; ')})` : '') +
          (e.resetsAt ? ` Resets at ${e.resetsAt.toISOString()}.` : '')
        : `HRVoice request failed: ${(e as Error).message}`;
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}

export function register(server: McpServer, hv: Sdk): void {
  for (const [name, t] of Object.entries(tools(hv))) {
    const def = t as Tool<z.ZodRawShape>;
    server.registerTool(
      name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: { readOnlyHint: def.readOnly, destructiveHint: false, openWorldHint: !def.readOnly },
      },
      (args: z.infer<z.ZodObject<z.ZodRawShape>>) => call(def, args),
    );
  }
}
