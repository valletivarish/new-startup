/**
 * Test keys on the fake line: a test call is placed through the own loop
 * without dialing Exotel, its session is is_test, it is free on the ledger
 * and it never shows up in usage.
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
} from './setup/api-harness.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';
import { createVoiceSessionService } from '../src/providers/elevenlabs/voice-session.service.js';
import { createOwnLoopService } from '../src/providers/own-loop/own-loop.service.js';
import { createCallRequestsService } from '../src/integrations/call-requests.service.js';
import { createUsageService } from '../src/integrations/usage.service.js';
import { AUDIT_SERVICE } from '../src/tokens.js';
import { COST_SERVICE, JOBS_SERVICE } from '../src/tokens.more.js';
import type { ExotelClient } from '../src/providers/exotel/exotel.js';

const ENV: Record<string, string> = {
  ELEVENLABS_ENABLED: 'true',
  ELEVENLABS_API_KEY: 'test-key',
  ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
  VOICE_INTERNAL_TOKEN: 'internal-voice-token-for-tests-0123456789',
  VOICE_SERVICE_URL: 'http://voice.test:8765',
};

let api: ApiHarness;

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

describe('test mode', () => {
  it('places a test-key call on the fake line, free and uncounted', async () => {
    const owner = await registerUser(api, 'testmode');
    const orgId = await createOrganization(api, owner, 'Test Mode Co');
    const minted = await api.request({
      method: 'POST',
      url: '/organization/api-keys',
      cookie: owner.cookie,
      payload: { name: 'ATS', mode: 'test', scopes: ['jobs', 'candidates', 'calls', 'results'] },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    const key = JSON.parse(minted.body).key as string;
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
    const v1 = (method: 'GET' | 'POST', url: string, payload?: object) =>
      api.request({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload ? { payload } : {}) });
    const job = await v1('POST', '/v1/jobs', { title: 'Picker' });
    expect(job.statusCode, job.body).toBe(201);
    const jobId = JSON.parse(job.body).id as string;
    const cand = await v1('POST', `/v1/jobs/${jobId}/candidates`, {
      fullName: 'Test Cand',
      phone: '9000000777',
      consent: true,
    });
    expect(cand.statusCode, cand.body).toBe(201);
    const candidateId = JSON.parse(cand.body).id as string;

    // Services wired like app.module, with a spy Exotel and a stubbed voice service.
    const app = api.built.app;
    const env = api.built.env;
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
      return new Response(null, { status: 202 });
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
      // Inside calling hours whatever the real clock says.
      now: () => new Date('2026-10-16T10:00:00+05:30'),
    });

    const req = await v1('POST', `/v1/jobs/${jobId}/candidates/${candidateId}/calls`);
    expect(req.statusCode, req.body).toBe(202);
    const callRequestId = JSON.parse(req.body).id as string;
    await calls.place({ organizationId: orgId, userId: owner.userId, callRequestId });

    const [cr] = await superSql<{ status: string; reason: string | null; voice_session_id: string }>(sql`
      select status, reason, voice_session_id from call_requests where id = ${callRequestId}
    `);
    expect(cr).toMatchObject({ status: 'placed', reason: null });
    expect(exotelCalls).toHaveLength(0);

    const [vs] = await superSql<{
      is_test: boolean;
      provider: string;
      engine: string;
      external_conversation_id: string;
    }>(sql`
      select is_test, provider, engine, external_conversation_id
      from voice_sessions where id = ${cr!.voice_session_id}
    `);
    expect(vs).toMatchObject({ is_test: true, provider: 'own_loop', engine: 'own_loop_sarvam_voice' });
    expect(vs!.external_conversation_id).toMatch(/^test-[0-9a-f-]{36}$/);
    const callId = vs!.external_conversation_id;

    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe('http://voice.test:8765/internal/test-call');
    expect(posted[0]!.headers['x-voice-token']).toBe(ENV['VOICE_INTERNAL_TOKEN']);
    expect(posted[0]!.body).toEqual({ callId, language: 'en' });

    // The fake line can fetch the plan, then posts a long, spoken result.
    const plan = await ownLoop.getCallPlan(callId);
    expect(plan.voiceSessionId).toBe(cr!.voice_session_id);
    await ownLoop.saveCallResult(callId, {
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
      from call_cost_ledger where voice_session_id = ${cr!.voice_session_id}
    `);
    for (const v of Object.values(ledger!)) expect(Number(v ?? 0)).toBe(0);

    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const usage = await createUsageService(api.built.database).month(orgId, month);
    expect(usage).toMatchObject({ callsPlaced: 0, completedScreens: 0 });
  });
});
