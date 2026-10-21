/**
 * Test keys on the fake line: a test call is placed through the own loop
 * without dialing Exotel, its session is is_test, it is free on the ledger,
 * it never shows up in usage, it has its own caps and skips calling hours.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withoutTenantContext } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';
import {
  createOrganization,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';
import { createVoiceSessionService } from '../src/providers/elevenlabs/voice-session.service.js';
import { createOwnLoopService } from '../src/providers/own-loop/own-loop.service.js';
import { createCallRequestsService } from '../src/integrations/call-requests.service.js';
import { createUsageService } from '../src/integrations/usage.service.js';
import { AUDIT_SERVICE } from '../src/tokens.js';
import { COST_SERVICE, JOBS_SERVICE, VOICE_SESSION_SERVICE } from '../src/tokens.more.js';
import type { ExotelClient } from '../src/providers/exotel/exotel.js';

const ENV: Record<string, string> = {
  ELEVENLABS_ENABLED: 'true',
  ELEVENLABS_API_KEY: 'test-key',
  ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
  // One live phone screen at a time: test calls must not use up this slot.
  ELEVENLABS_MAX_CONCURRENT_PHONE: '1',
  VOICE_INTERNAL_TOKEN: 'internal-voice-token-for-tests-0123456789',
  VOICE_SERVICE_URL: 'http://voice.test:8765',
};
const IN_HOURS = new Date('2026-10-16T10:00:00+05:30');
const OUT_OF_HOURS = new Date('2026-10-16T22:00:00+05:30');

let api: ApiHarness;
let phoneSeq = 700;

beforeAll(async () => {
  api = await startApi(ENV, createStubVoiceSessionAdapter());
}, 120_000);

afterAll(async () => {
  await api?.close();
});

async function superSql<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    return await withoutTenantContext(db.db, (tx) => tx.execute<T>(query));
  } finally {
    await db.close();
  }
}

interface Org {
  owner: TestActor;
  orgId: string;
  key: (mode: 'test' | 'live') => Promise<string>;
}

async function setupOrg(label: string): Promise<Org> {
  const owner = await registerUser(api, label);
  const orgId = await createOrganization(api, owner, `${label} Co`);
  const agent = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screener', purpose: 'Screen', description: 'calls', agentType: 'hiring' },
  });
  const a = JSON.parse(agent.body) as { id: string; versionId: string };
  await api.request({
    method: 'POST',
    url: `/agents/${a.id}/versions/${a.versionId}/publish`,
    cookie: owner.cookie,
    payload: {},
  });
  const key = async (mode: 'test' | 'live') => {
    const minted = await api.request({
      method: 'POST',
      url: '/organization/api-keys',
      cookie: owner.cookie,
      payload: { name: `ATS ${mode}`, mode, scopes: ['jobs', 'candidates', 'calls', 'results'] },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    return JSON.parse(minted.body).key as string;
  };
  return { owner, orgId, key };
}

function v1(key: string, method: 'GET' | 'POST', url: string, payload?: object) {
  return api.request({
    method,
    url,
    headers: { authorization: `Bearer ${key}` },
    ...(payload ? { payload } : {}),
  });
}

async function jobWithCandidates(key: string, n: number, language?: string) {
  const job = await v1(key, 'POST', '/v1/jobs', {
    title: 'Picker',
    // A job's language applies once the job has its own screening content.
    ...(language ? { language, mustAskQuestions: ['What is your notice period?'] } : {}),
  });
  expect(job.statusCode, job.body).toBe(201);
  const jobId = JSON.parse(job.body).id as string;
  const candidateIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const phone = `9000000${++phoneSeq}`;
    const cand = await v1(key, 'POST', `/v1/jobs/${jobId}/candidates`, {
      fullName: `Cand ${phone}`,
      phone,
      consent: true,
    });
    expect(cand.statusCode, cand.body).toBe(201);
    candidateIds.push(JSON.parse(cand.body).id);
  }
  return { jobId, candidateIds };
}

/** Services wired like app.module, with a spy Exotel and a stubbed voice service. */
function testLine(opts: { voiceStatus?: number; now?: Date } = {}) {
  const app = api.built.app;
  // Test calls need the own loop, not ElevenLabs.
  const env = { ...api.built.env, ELEVENLABS_ENABLED: false, VOICE_OWN_LOOP_ENABLED: true };
  const exotelCalls: unknown[] = [];
  const exotel: ExotelClient = {
    isConfigured: () => true,
    connectCall: async (input) => {
      exotelCalls.push(input);
      throw new Error('must not dial');
    },
    getCall: async () => {
      throw new Error('must not dial');
    },
  };
  const costs = app.get(COST_SERVICE);
  const voice = createVoiceSessionService(
    api.built.database,
    env,
    app.get(AUDIT_SERVICE),
    createStubVoiceSessionAdapter(),
    costs,
    exotel,
  );
  const posted: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    posted.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return new Response(null, { status: opts.voiceStatus ?? 202 });
  }) as typeof fetch;
  const ownLoop = createOwnLoopService(api.built.database, env, costs, null, async () => {}, {
    voice,
    fetch: fakeFetch,
  });
  const calls = createCallRequestsService({
    database: api.built.database,
    voice,
    jobs: app.get(JOBS_SERVICE),
    queue: null,
    placeTest: ownLoop.placeTestCall,
    now: () => opts.now ?? IN_HOURS,
  });
  return { ownLoop, calls, exotelCalls, posted };
}

async function requestAndPlace(
  org: Org,
  key: string,
  jobId: string,
  candidateId: string,
  calls: ReturnType<typeof createCallRequestsService>,
) {
  const req = await v1(key, 'POST', `/v1/jobs/${jobId}/candidates/${candidateId}/calls`);
  expect(req.statusCode, req.body).toBe(202);
  const callRequestId = JSON.parse(req.body).id as string;
  await calls.place({ organizationId: org.orgId, userId: org.owner.userId, callRequestId });
  const [cr] = await superSql<{ status: string; reason: string | null; voice_session_id: string | null }>(sql`
    select status, reason, voice_session_id from call_requests where id = ${callRequestId}
  `);
  return cr!;
}

describe('test mode', () => {
  it('places a test-key call on the fake line, free and uncounted', async () => {
    const org = await setupOrg('testmode');
    const key = await org.key('test');
    const { jobId, candidateIds } = await jobWithCandidates(key, 1, 'hi');
    const line = testLine();

    const cr = await requestAndPlace(org, key, jobId, candidateIds[0]!, line.calls);
    expect(cr).toMatchObject({ status: 'placed', reason: null });
    expect(line.exotelCalls).toHaveLength(0);

    const [vs] = await superSql<{
      is_test: boolean;
      provider: string;
      engine: string;
      external_conversation_id: string;
    }>(sql`
      select is_test, provider, engine, external_conversation_id
      from voice_sessions where id = ${cr.voice_session_id}
    `);
    expect(vs).toMatchObject({ is_test: true, provider: 'own_loop', engine: 'own_loop_google_voice' });
    expect(vs!.external_conversation_id).toMatch(/^test-[0-9a-f-]{36}$/);
    const callId = vs!.external_conversation_id;

    expect(line.posted).toHaveLength(1);
    expect(line.posted[0]!.url).toBe('http://voice.test:8765/internal/test-call');
    expect(line.posted[0]!.headers['x-voice-token']).toBe(ENV['VOICE_INTERNAL_TOKEN']);
    // The language comes from the job's frozen snapshot.
    expect(line.posted[0]!.body).toEqual({ callId, language: 'hi' });

    // The fake line can fetch the plan, then posts a long, spoken result.
    const plan = await line.ownLoop.getCallPlan(callId);
    expect(plan.voiceSessionId).toBe(cr.voice_session_id);
    expect(plan).toMatchObject({ engine: 'own_loop_google_voice', voiceId: 'hi-IN-Chirp3-HD-Kore', ttsModel: 'chirp3_hd' });
    await line.ownLoop.saveCallResult(callId, {
      transcript: [
        { role: 'agent', message: 'What is your notice period?' },
        { role: 'user', message: 'Thirty days.' },
      ],
      durationSeconds: 90,
      endedReason: 'completed',
      usage: { sttSeconds: 60, llmInputTokens: 5000, llmOutputTokens: 400, ttsCharacters: 900 },
    });

    const [ledger] = await superSql<Record<string, string | null>>(sql`
      select total_cost::text, telephony_cost::text, stt_cost::text, llm_cost::text, tts_cost::text
      from call_cost_ledger where voice_session_id = ${cr.voice_session_id}
    `);
    for (const v of Object.values(ledger!)) expect(Number(v ?? 0)).toBe(0);

    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const usage = await createUsageService(api.built.database).month(org.orgId, month);
    expect(usage).toMatchObject({ callsPlaced: 0, completedScreens: 0 });
  });

  it("speaks the job's language with its persona and model; keeps a job's own-loop engine", async () => {
    const org = await setupOrg('testmode-voice');
    const key = await org.key('test');
    const ta = await jobWithCandidates(key, 1, 'ta');
    await superSql(sql`update jobs set voice_persona = 'iapetus', tts_model = 'gemini_flash' where id = ${ta.jobId}`);
    const sarvam = await jobWithCandidates(key, 1);
    await superSql(sql`update jobs set voice_engine = 'own_loop_sarvam_voice' where id = ${sarvam.jobId}`);
    const line = testLine();

    const taCall = await requestAndPlace(org, key, ta.jobId, ta.candidateIds[0]!, line.calls);
    const [taVs] = await superSql<{ external_conversation_id: string }>(sql`
      select external_conversation_id from voice_sessions where id = ${taCall.voice_session_id}
    `);
    expect(line.posted[0]!.body).toMatchObject({ language: 'ta' });
    expect(await line.ownLoop.getCallPlan(taVs!.external_conversation_id)).toMatchObject({
      engine: 'own_loop_google_voice',
      language: 'ta',
      voiceId: 'ta-IN-Chirp3-HD-Iapetus',
      ttsModel: 'gemini_flash',
    });

    const sarvamCall = await requestAndPlace(org, key, sarvam.jobId, sarvam.candidateIds[0]!, line.calls);
    const [sVs] = await superSql<{ engine: string }>(sql`
      select engine from voice_sessions where id = ${sarvamCall.voice_session_id}
    `);
    expect(sVs!.engine).toBe('own_loop_sarvam_voice');
  });

  it('skips the calling-hours hold', async () => {
    const org = await setupOrg('testmode-hours');
    const key = await org.key('test');
    const { jobId, candidateIds } = await jobWithCandidates(key, 1);
    const line = testLine({ now: OUT_OF_HOURS });
    expect(await requestAndPlace(org, key, jobId, candidateIds[0]!, line.calls)).toMatchObject({
      status: 'placed',
    });
  });

  it('caps test calls at 3 live per company, without using the live-call slots', async () => {
    const org = await setupOrg('testmode-caps');
    const key = await org.key('test');
    const { jobId, candidateIds } = await jobWithCandidates(key, 4);
    const line = testLine();
    for (const id of candidateIds.slice(0, 3)) {
      expect(await requestAndPlace(org, key, jobId, id, line.calls)).toMatchObject({ status: 'placed' });
    }

    // ELEVENLABS_MAX_CONCURRENT_PHONE is 1 and three test calls are live: a real call still goes.
    const live = await org.key('live');
    const real = await jobWithCandidates(live, 1);
    const appCalls = createCallRequestsService({
      database: api.built.database,
      voice: api.built.app.get(VOICE_SESSION_SERVICE),
      jobs: api.built.app.get(JOBS_SERVICE),
      queue: null,
      now: () => IN_HOURS,
    });
    expect(await requestAndPlace(org, live, real.jobId, real.candidateIds[0]!, appCalls)).toMatchObject({
      status: 'placed',
    });

    // ...and the live call does not take a test slot either: the 4th test call is held by the test cap.
    expect(await requestAndPlace(org, key, jobId, candidateIds[3]!, line.calls)).toMatchObject({
      status: 'scheduled',
      reason: null,
    });
  });

  it('fails the session and the request when the fake line does not start', async () => {
    const org = await setupOrg('testmode-down');
    const key = await org.key('test');
    const { jobId, candidateIds } = await jobWithCandidates(key, 2);

    const down = await requestAndPlace(org, key, jobId, candidateIds[0]!, testLine({ voiceStatus: 500 }).calls);
    expect(down).toMatchObject({ status: 'failed', reason: 'service_unavailable', voice_session_id: null });
    const busy = await requestAndPlace(org, key, jobId, candidateIds[1]!, testLine({ voiceStatus: 429 }).calls);
    expect(busy).toMatchObject({ status: 'failed', reason: 'test_call_limit_reached' });

    const sessions = await superSql<{ status: string; failure_reason: string | null }>(sql`
      select status, failure_reason from voice_sessions where organization_id = ${org.orgId}
    `);
    expect(sessions).toHaveLength(2);
    for (const s of sessions) expect(s).toMatchObject({ status: 'failed', failure_reason: 'engine_error' });
  });
});

describe('test/live isolation', () => {
  it('a key writes and calls only within its own mode; reads stay open', async () => {
    const org = await setupOrg('testmode-isolation');
    const [test, live] = [await org.key('test'), await org.key('live')];
    const testJob = await jobWithCandidates(test, 1);
    const liveJob = await jobWithCandidates(live, 1);

    for (const [key, other] of [
      [test, liveJob],
      [live, testJob],
    ] as const) {
      const add = await v1(key, 'POST', `/v1/jobs/${other.jobId}/candidates`, {
        fullName: 'Cross',
        phone: `9000000${++phoneSeq}`,
        consent: true,
      });
      expect(add.statusCode, add.body).toBe(404);
      const batch = await v1(key, 'POST', `/v1/jobs/${other.jobId}/candidates`, {
        candidates: [{ fullName: 'Cross', phone: `9000000${++phoneSeq}`, consent: true }],
      });
      expect(batch.statusCode, batch.body).toBe(404);
      const link = await v1(key, 'POST', `/v1/jobs/${other.jobId}/candidate-links`, {});
      expect(link.statusCode, link.body).toBe(404);
      const call = await v1(key, 'POST', `/v1/jobs/${other.jobId}/candidates/${other.candidateIds[0]}/calls`);
      expect(call.statusCode, call.body).toBe(404);
      expect((await v1(key, 'GET', `/v1/jobs/${other.jobId}`)).statusCode).toBe(200);
    }
  });

  it('a test key cannot upsert onto a live candidate by externalId', async () => {
    const org = await setupOrg('testmode-upsert');
    const [test, live] = [await org.key('test'), await org.key('live')];
    const job = await v1(live, 'POST', '/v1/jobs', { title: 'Live job' });
    const jobId = JSON.parse(job.body).id as string;
    const created = await v1(live, 'POST', `/v1/jobs/${jobId}/candidates`, {
      fullName: 'Real Person',
      phone: `9000000${++phoneSeq}`,
      externalId: 'ats-live-1',
      consent: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const upsert = await v1(test, 'POST', `/v1/jobs/${jobId}/candidates`, {
      fullName: 'Overwritten',
      phone: `9000000${++phoneSeq}`,
      externalId: 'ats-live-1',
      consent: true,
    });
    expect(upsert.statusCode, upsert.body).toBe(404);
    const [row] = await superSql<{ full_name: string; is_test: boolean }>(sql`
      select full_name, is_test from candidates where id = ${JSON.parse(created.body).id}`);
    expect(row).toEqual({ full_name: 'Real Person', is_test: false });
  });
});
