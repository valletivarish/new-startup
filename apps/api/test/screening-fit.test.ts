/**
 * Recruiter-grade screening (spec 2026-10-21): job requirements, the fit sheet after a call,
 * auto-advance, and the recruiter rules in the call prompt.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Database } from '@platform/db';

import {
  JobRequirements,
  draftRequirements,
  evaluateFit,
  overallFit,
  redactFit,
  requirementList,
  type FitItem,
} from '../src/hiring/requirements.js';
import { recordCallFit } from '../src/hiring/call-fit.js';
import { createJobsService } from '../src/hiring/jobs.service.js';
import { createAuditService } from '../src/audit/audit.service.js';
import { buildVoiceProvisionConfig } from '../src/providers/elevenlabs/provision-config.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';
import {
  acceptInvitation,
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { appDatabase, superDatabase } from './setup/fixtures.js';

const REQ = JobRequirements.parse({
  salaryMinLakh: 4,
  salaryMaxLakh: 6,
  maxNoticeDays: 30,
  workMode: 'hybrid',
  officeDaysPerWeek: 3,
  city: 'Pune',
  mustHaves: ['3+ years Java'],
});

/** A fetch that answers every generateContent call with `body` as the model's JSON text. */
function geminiReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof body === 'string' ? body : JSON.stringify(body) }] } }] }),
      { status },
    )) as typeof fetch;
}

const TRANSCRIPT = [
  { role: 'agent', message: 'What is your expected CTC?' },
  { role: 'user', message: 'Five lakh, and I can join in two weeks.', timeInCallSecs: 41 },
];

describe('requirements', () => {
  it('turn into recruiter lines, only for what HR set', () => {
    expect(requirementList(REQ).map((l) => [l.requirement, l.label])).toEqual([
      ['salary', 'Expected salary within 4 to 6 lakh a year'],
      ['notice', 'Notice period of 30 days or less'],
      ['work_mode', 'Can work hybrid, 3 office days a week in Pune'],
      ['must_have_1', '3+ years Java'],
    ]);
    expect(requirementList(JobRequirements.parse({}))).toEqual([]);
    expect(requirementList(null)).toEqual([]);
  });

  it('refuse a minimum above the maximum and more than five must-haves', () => {
    expect(JobRequirements.safeParse({ salaryMinLakh: 9, salaryMaxLakh: 5 }).success).toBe(false);
    expect(JobRequirements.safeParse({ mustHaves: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    expect(JobRequirements.parse({}).replyWithinWorkingDays).toBe(3);
  });
});

describe('overall fit rule', () => {
  const item = (requirement: string, verdict: FitItem['verdict']): FitItem => ({ requirement, label: requirement, verdict, evidence: null, atSeconds: null });

  it('meets_all only when every set requirement is met', () => {
    expect(overallFit([item('salary', 'met'), item('notice', 'met')], [])).toBe('meets_all');
    expect(overallFit([item('salary', 'met'), item('notice', 'unclear')], [])).toBe('check');
  });

  it('doesnt_meet on a not_met with no flexibility on it; flexibility keeps it at check', () => {
    expect(overallFit([item('salary', 'not_met'), item('notice', 'met')], [])).toBe('doesnt_meet');
    const flex = { kind: 'flexibility' as const, text: 'Can come down a little', atSeconds: 50, requirement: 'salary' };
    expect(overallFit([item('salary', 'not_met'), item('notice', 'met')], [flex])).toBe('check');
    expect(overallFit([item('salary', 'not_met')], [{ ...flex, requirement: 'notice' }])).toBe('doesnt_meet');
  });
});

describe('evaluateFit', () => {
  it('reads the model verdicts, keeps HR labels, and ignores invented requirements', async () => {
    const fit = await evaluateFit(
      { requirements: REQ, transcript: TRANSCRIPT, answers: { 'What is your notice period?': 'Two weeks' } },
      {
        apiKey: 'k',
        fetchFn: geminiReturning({
          items: [
            { requirement: 'salary', verdict: 'met', evidence: 'Five lakh', atSeconds: 41 },
            { requirement: 'notice', verdict: 'met', evidence: 'join in two weeks', atSeconds: 41.4 },
            { requirement: 'work_mode', verdict: 'maybe', evidence: '' },
            { requirement: 'looks_confident', verdict: 'not_met', evidence: 'x' },
          ],
          flags: [{ kind: 'competing_offer', text: 'Has an offer from Infosys', atSeconds: 60 }, { kind: 'weird', text: 'x' }],
        }),
      },
    );
    expect(fit).not.toBeNull();
    expect(fit!.items.map((i) => [i.requirement, i.verdict, i.atSeconds])).toEqual([
      ['salary', 'met', 41],
      ['notice', 'met', 41],
      ['work_mode', 'unclear', null],
      ['must_have_1', 'unclear', null],
    ]);
    expect(fit!.items[0]!.label).toBe('Expected salary within 4 to 6 lakh a year');
    expect(fit!.flags).toEqual([
      { kind: 'competing_offer', text: 'Has an offer from Infosys', atSeconds: 60, requirement: null },
      { kind: 'other', text: 'x', atSeconds: null, requirement: null },
    ]);
    expect(fit!.overall).toBe('check');
  });

  it('never throws: errors, bad JSON and no key fall back to all unclear', async () => {
    const input = { requirements: REQ, transcript: TRANSCRIPT, answers: {} };
    for (const deps of [
      { apiKey: 'k', fetchFn: geminiReturning({}, 500) },
      { apiKey: 'k', fetchFn: geminiReturning('not json') },
      { apiKey: 'k', fetchFn: (async () => { throw new Error('network'); }) as typeof fetch },
      { apiKey: '' },
    ]) {
      const fit = await evaluateFit(input, deps);
      expect(fit!.overall).toBe('check');
      expect(fit!.items.every((i) => i.verdict === 'unclear')).toBe(true);
    }
  });

  it('is null when no requirements are set', async () => {
    expect(await evaluateFit({ requirements: JobRequirements.parse({}), transcript: TRANSCRIPT, answers: {} }, { apiKey: 'k' })).toBeNull();
  });

  it('redaction keeps verdicts and drops the candidate words', async () => {
    const fit = await evaluateFit({ requirements: REQ, transcript: TRANSCRIPT, answers: {} }, {
      apiKey: 'k',
      fetchFn: geminiReturning({ items: [{ requirement: 'salary', verdict: 'met', evidence: 'Five lakh' }], flags: [{ kind: 'other', text: 'secret' }] }),
    });
    const red = redactFit(fit, false)!;
    expect(red.items[0]).toMatchObject({ verdict: 'met', evidence: null });
    expect(red.flags[0]!.text).toBe('');
  });
});

describe('draftRequirements', () => {
  const jd = { title: 'Java developer', description: 'Java developer in Pune, hybrid 3 days. 6-8 LPA. Immediate joiners. 3+ years Java.' };

  it('keeps valid fields only and never invents', async () => {
    const draft = await draftRequirements(jd, {
      apiKey: 'k',
      fetchFn: geminiReturning({
        salaryMinLakh: 6, salaryMaxLakh: 8, maxNoticeDays: 0, workMode: 'hybrid', officeDaysPerWeek: 3,
        city: 'Pune', mustHaves: ['3+ years Java', '', 'a', 'b', 'c', 'd', 'e'], nightShiftRequired: false,
      }),
    });
    expect(draft).toMatchObject({ salaryMinLakh: 6, salaryMaxLakh: 8, maxNoticeDays: 0, workMode: 'hybrid', officeDaysPerWeek: 3, city: 'Pune', replyWithinWorkingDays: 3 });
    expect(draft.mustHaves).toHaveLength(5);

    const bad = await draftRequirements(jd, { apiKey: 'k', fetchFn: geminiReturning({ salaryMinLakh: 9, salaryMaxLakh: 5, workMode: 'office', officeDaysPerWeek: 3, maxNoticeDays: -4 }) });
    expect(bad).toMatchObject({ salaryMinLakh: null, salaryMaxLakh: 5, workMode: null, officeDaysPerWeek: null, maxNoticeDays: null });
  });

  it('needs a key and a description', async () => {
    await expect(draftRequirements(jd, { apiKey: '' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(draftRequirements({ title: 'x', description: 'short' }, { apiKey: 'k' })).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('call prompt (baseline and own loop share it)', () => {
  const prompt = (requirements?: JobRequirements | null) =>
    buildVoiceProvisionConfig({
      agentPurpose: 'Screen Java candidates.',
      agentType: 'hiring',
      criteria: [{ id: 'q1', label: 'Do you have a laptop?' }],
      requirements,
    }).agentPrompt;

  it('carries the requirements as context and the closing days', () => {
    const p = prompt({ ...REQ, replyWithinWorkingDays: 5 });
    expect(p).toContain('- Expected salary within 4 to 6 lakh a year');
    expect(p).toContain('- Can work hybrid, 3 office days a week in Pune');
    expect(p).toContain('do not read it out as a list');
    expect(p).toContain('get back to them within 5 working days');
    expect(prompt(null)).toContain('within 3 working days');
    expect(prompt(null)).not.toContain('What the hiring team needs');
  });

  it('has the standard screen set and the follow-up rules', () => {
    const p = prompt(REQ);
    for (const topic of ['why they are looking for a change', 'notice period and whether it is negotiable', 'current and expected CTC', 'offers in hand or other interviews', 'work mode and location']) {
      expect(p).toContain(topic);
    }
    expect(p).toContain('at most one follow-up per topic');
    expect(p).toMatch(/more than about 30% above the current CTC, or above the budget/);
    expect(p).toContain('state the requirement gently and ask about flexibility');
    expect(p).toContain('ask once more in other words');
    expect(p).toContain("they don't know, accept it and move on");
  });

  it('never asks off-limits topics and never tells the candidate they are rejected', () => {
    const p = prompt(REQ);
    expect(p).toContain('Never ask about age, religion, caste, marital status, family plans, health');
    expect(p).toContain('steer back to the role');
    expect(p).toContain('Never tell the candidate they are rejected, not selected');
    expect(p).toContain('Do not recommend hire or reject');
  });
});

// ---------------------------------------------------------------------------
// Against the database: endpoints, the stored fit and auto-advance.

const VOICE_TOKEN = 'internal-voice-token-for-fit-tests-012345';
let api: ApiHarness;
let db: Database;
let owner: TestActor;

beforeAll(async () => {
  api = await startApi(
    {
      ELEVENLABS_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'stub',
      ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
      VOICE_OWN_LOOP_ENABLED: 'true',
      VOICE_INTERNAL_TOKEN: VOICE_TOKEN,
    },
    createStubVoiceSessionAdapter(),
  );
  db = appDatabase();
  owner = await registerUser(api, 'fit');
  await createOrganization(api, owner, `Fit Org ${Math.floor(Math.random() * 1e6)}`);
}, 120_000);

afterAll(async () => {
  await db?.close();
  await api?.close();
});

async function json<T>(method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown, cookie = owner.cookie) {
  const res = await api.request({ method, url, cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
}

let agentId: string | null = null;

/** A job with requirements, a candidate, and an ended phone call on them. */
async function screenedCandidate(requirements: unknown = REQ) {
  const job = await json<{ id: string }>('POST', '/jobs', { title: 'Java developer', description: 'Java role in Pune.' });
  const jobId = job.body.id;
  if (requirements) expect((await json('PUT', `/jobs/${jobId}/requirements`, { requirements })).status).toBe(200);
  const cand = await json<{ id: string }>('POST', '/candidates', { jobId, fullName: 'Ravi Kumar', phone: `98${Math.floor(1e7 + Math.random() * 9e7)}`, countryCode: '+91' });
  if (!agentId) {
    // One agent per company on this plan: create it once.
    const agent = await json<{ id: string; versionId: string }>('POST', '/agents', { name: 'Screen', purpose: 'Screen candidates', description: 'fit test' });
    await json('POST', `/agents/${agent.body.id}/versions/${agent.body.versionId}/publish`, {});
    agentId = agent.body.id;
  }
  const start = await json<{ voiceSessionId: string }>('POST', `/agents/${agentId}/voice-sessions`, {});
  const vsId = start.body.voiceSessionId;
  if (!vsId) throw new Error(`voice session: ${start.status} ${JSON.stringify(start.body)}`);
  const superDb = superDatabase();
  await superDb.db.execute(sql`
    update voice_sessions set job_id = ${jobId}, candidate_id = ${cand.body.id}, status = 'ended',
      transcript = ${JSON.stringify(TRANSCRIPT)}::jsonb,
      provision_snapshot = ${JSON.stringify({ evaluationCriteria: [], requirements: requirements ? JobRequirements.parse(requirements) : null })}::jsonb
    where id = ${vsId}
  `);
  await superDb.db.execute(sql`
    update agent_sessions set channel = 'phone' where id = (select session_id from voice_sessions where id = ${vsId})
  `);
  await superDb.close();
  const orgId = (await json<{ id: string }>('GET', '/organization')).body.id;
  return { jobId, candidateId: cand.body.id, vsId, orgId };
}

const ALL_MET = {
  items: ['salary', 'notice', 'work_mode', 'must_have_1'].map((requirement) => ({ requirement, verdict: 'met', evidence: 'Five lakh', atSeconds: 41 })),
  flags: [],
};

function fitDeps(model: unknown) {
  return {
    database: db,
    gemini: { apiKey: 'k', fetchFn: geminiReturning(model) },
    jobs: createJobsService(db),
    audit: createAuditService(db, { info() {}, error() {}, warn() {} } as never),
  };
}

describe('requirements endpoints', () => {
  it('GET / PUT round-trip, validate, and clear', async () => {
    const job = await json<{ id: string }>('POST', '/jobs', { title: 'Sales' });
    expect((await json<{ requirements: unknown }>('GET', `/jobs/${job.body.id}/requirements`)).body.requirements).toBeNull();
    const put = await json<{ requirements: JobRequirements }>('PUT', `/jobs/${job.body.id}/requirements`, { requirements: { maxNoticeDays: 15, mustHaves: ['Hindi'] } });
    expect(put.status).toBe(200);
    expect(put.body.requirements).toMatchObject({ maxNoticeDays: 15, mustHaves: ['Hindi'], replyWithinWorkingDays: 3, salaryMaxLakh: null });
    expect((await json<{ requirements: unknown }>('GET', `/jobs/${job.body.id}/requirements`)).body.requirements).toEqual(put.body.requirements);
    expect((await json<{ requirements: unknown }>('GET', `/jobs/${job.body.id}`)).body.requirements).toEqual(put.body.requirements);
    expect((await json('PUT', `/jobs/${job.body.id}/requirements`, { requirements: { salaryMinLakh: 9, salaryMaxLakh: 2 } })).status).toBe(422);
    expect((await json('PUT', `/jobs/${job.body.id}/requirements`, { requirements: { surprise: true } })).status).toBe(422);
    expect((await json<{ requirements: unknown }>('PUT', `/jobs/${job.body.id}/requirements`, { requirements: null })).body.requirements).toBeNull();
  });

  it('Fill from description says plainly when Gemini is not configured', async () => {
    const job = await json<{ id: string }>('POST', '/jobs', { title: 'Sales', description: 'Field sales in Mumbai, 3 LPA, immediate joiners.' });
    expect((await json('POST', `/jobs/${job.body.id}/requirements/draft`)).status).toBe(409);
  });
});

describe('workspace settings', () => {
  it('auto-advance is off by default; admins switch it, recruiters cannot', async () => {
    expect((await json('GET', '/organization/settings')).body).toEqual({ autoAdvanceMeetsAll: false });
    expect((await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: true })).body).toEqual({ autoAdvanceMeetsAll: true });
    expect((await json('GET', '/organization/settings')).body).toEqual({ autoAdvanceMeetsAll: true });
    expect((await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: 'yes' })).status).toBe(422);

    const recruiter = await registerUser(api, 'fit-recruiter');
    const token = await inviteAndCaptureToken(api, owner, recruiter.email, 'recruiter');
    expect((await acceptInvitation(api, recruiter, token)).statusCode).toBeLessThan(300);
    expect((await json('GET', '/organization/settings', undefined, recruiter.cookie)).status).toBe(200);
    expect((await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: false }, recruiter.cookie)).status).toBe(403);
    await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: false });
  });
});

describe('fit after a call', () => {
  it('is stored once, shows on the board with lane counts, and leaves the stage alone when auto-advance is off', async () => {
    const { jobId, candidateId, vsId, orgId } = await screenedCandidate();
    const fit = await recordCallFit(fitDeps(ALL_MET), orgId, vsId);
    expect(fit?.overall).toBe('meets_all');
    // A second end event (webhook + reconcile) does not score again.
    expect(await recordCallFit(fitDeps({ items: [], flags: [] }), orgId, vsId)).toBeNull();

    const list = await json<{ candidates: { candidateId: string; status: string; fit: { overall: string; items: { evidence: string }[] } }[]; fitTotals: Record<string, number> }>(
      'GET', `/jobs/${jobId}/candidates`,
    );
    const row = list.body.candidates.find((c) => c.candidateId === candidateId)!;
    expect(row.status).toBe('new');
    expect(row.fit.overall).toBe('meets_all');
    expect(row.fit.items[0]!.evidence).toBe('Five lakh');
    expect(list.body.fitTotals).toEqual({ meets_all: 1, check: 0, doesnt_meet: 0, not_screened: 0 });
    const lane = await json<{ candidates: unknown[] }>('GET', `/jobs/${jobId}/candidates?fit=not_screened`);
    expect(lane.body.candidates).toHaveLength(0);

    const results = await json<{ results: { fit: { overall: string } } }>('GET', `/jobs/${jobId}/candidates/${candidateId}/results`);
    expect(results.body.results.fit.overall).toBe('meets_all');
  });

  it('auto-advance moves a Meets-all candidate forward, audited as automatic with the fit', async () => {
    await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: true });
    try {
      const { jobId, candidateId, vsId, orgId } = await screenedCandidate();
      await recordCallFit(fitDeps(ALL_MET), orgId, vsId);
      const one = await json<{ status: string }>('GET', `/jobs/${jobId}/candidates/${candidateId}`);
      expect(one.body.status).toBe('reviewed');
      const history = await json<{ events: { status: string; automatic: boolean; reason: string; actorUserId: string | null }[] }>(
        'GET', `/jobs/${jobId}/candidates/${candidateId}/stage-history`,
      );
      expect(history.body.events[0]).toMatchObject({
        status: 'reviewed',
        automatic: true,
        actorUserId: null,
        reason: 'Moved forward automatically: met all 4 requirements',
      });
      const superDb = superDatabase();
      const audit = await superDb.db.execute<{ metadata: Record<string, string> }>(sql`
        select metadata from audit_events where resource_id = ${candidateId} and event_type = 'hiring.candidate_status_changed'
      `);
      await superDb.close();
      expect(JSON.parse(audit[0]!.metadata['fit']!)).toMatchObject({ overall: 'meets_all' });
    } finally {
      await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: false });
    }
  });

  it('auto-advance never moves Check or Doesn\'t meet', async () => {
    await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: true });
    try {
      for (const verdict of ['unclear', 'not_met']) {
        const { jobId, candidateId, vsId, orgId } = await screenedCandidate();
        const model = { items: ALL_MET.items.map((i, n) => (n === 0 ? { ...i, verdict } : i)), flags: [] };
        const fit = await recordCallFit(fitDeps(model), orgId, vsId);
        expect(fit?.overall).toBe(verdict === 'unclear' ? 'check' : 'doesnt_meet');
        expect((await json<{ status: string }>('GET', `/jobs/${jobId}/candidates/${candidateId}`)).body.status).toBe('new');
      }
    } finally {
      await json('PUT', '/organization/settings', { autoAdvanceMeetsAll: false });
    }
  });

  it('no requirements set: no fit, the candidate stays Not screened', async () => {
    const { jobId, vsId, orgId } = await screenedCandidate(null);
    expect(await recordCallFit(fitDeps(ALL_MET), orgId, vsId)).toBeNull();
    const list = await json<{ candidates: { fit: unknown }[]; fitTotals: Record<string, number> }>('GET', `/jobs/${jobId}/candidates`);
    expect(list.body.candidates[0]!.fit).toBeNull();
    expect(list.body.fitTotals.not_screened).toBe(1);
  });

  it('the own-loop end path scores the call (all unclear here: no Gemini key in tests)', async () => {
    const { jobId, candidateId, vsId } = await screenedCandidate();
    const callId = `exo${Math.floor(Math.random() * 1e12)}`;
    const superDb = superDatabase();
    await superDb.db.execute(sql`
      update voice_sessions set provider = 'own_loop', status = 'active', external_conversation_id = ${callId}, transcript = null
      where id = ${vsId}
    `);
    await superDb.close();
    const res = await api.request({
      method: 'POST',
      url: `/internal/voice/calls/${callId}/result`,
      headers: { 'x-voice-token': VOICE_TOKEN },
      payload: { transcript: TRANSCRIPT, durationSeconds: 60, endedReason: 'completed', usage: {} },
    });
    expect(res.statusCode).toBeLessThan(300);
    const one = await json<{ fit: { overall: string; items: { verdict: string }[] } }>('GET', `/jobs/${jobId}/candidates/${candidateId}`);
    expect(one.body.fit.overall).toBe('check');
    expect(one.body.fit.items.every((i) => i.verdict === 'unclear')).toBe(true);
  });
});
