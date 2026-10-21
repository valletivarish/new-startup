/**
 * Own voice loop — Nest side.
 *
 *   - internal routes need the shared secret; without it they don't exist (404)
 *   - a live own-loop call returns its frozen plan; stale/unknown/baseline ids are 404
 *   - posting a result ends the call, saves the transcript and writes a priced ledger row
 *   - the platform admin sets a job's engine; the job reports it back
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@platform/db';
import { startApi, registerUser, createOrganization, type ApiHarness } from './setup/api-harness.js';
import { superDatabase } from './setup/fixtures.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';

const TOKEN = 'internal-voice-token-for-tests-0123456789';
const ADMIN_EMAIL = `loop-admin-${Math.floor(Math.random() * 1e9)}@example.test`;
let api: ApiHarness;

beforeAll(async () => {
  api = await startApi(
    {
      ELEVENLABS_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'stub',
      ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
      VOICE_OWN_LOOP_ENABLED: 'true',
      VOICE_INTERNAL_TOKEN: TOKEN,
      PLATFORM_ADMIN_EMAILS: ADMIN_EMAIL,
    },
    createStubVoiceSessionAdapter(),
  );
});

afterAll(async () => {
  await api.close();
});

/** An org with a job and a live own-loop session carrying a frozen plan. */
async function ownLoopCall(opts: { ageMinutes?: number; provider?: string } = {}) {
  const owner = await registerUser(api, 'loop');
  const orgId = await createOrganization(api, owner, `loop-org-${Math.floor(Math.random() * 1e6)}`);
  const agentRes = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screen', purpose: 'Screen candidates', description: 'loop test' },
  });
  const { id: agentId, versionId } = JSON.parse(agentRes.body) as { id: string; versionId: string };
  await api.request({
    method: 'POST',
    url: `/agents/${agentId}/versions/${versionId}/publish`,
    cookie: owner.cookie,
    payload: {},
  });
  const start = await api.request({
    method: 'POST',
    url: `/agents/${agentId}/voice-sessions`,
    cookie: owner.cookie,
    payload: {},
  });
  expect(start.statusCode).toBe(201);
  const vsId = (JSON.parse(start.body) as { voiceSessionId?: string }).voiceSessionId;
  const callId = `exo${Math.floor(Math.random() * 1e12)}`;
  const snapshot = {
    screeningLanguage: 'hi',
    agentPrompt: 'You are Asha, screening for the Java role.',
    firstMessage: 'Namaste, main Asha bol rahi hoon.',
    voiceId: 'shubh',
    evaluationCriteria: [{ id: 'notice_period', label: 'What is your notice period?' }],
  };
  const superDb = superDatabase();
  if (vsId) {
    await superDb.db.execute(sql`
      update voice_sessions set
        provider = ${opts.provider ?? 'own_loop'},
        engine = 'own_loop_sarvam_voice',
        status = 'pending',
        external_conversation_id = ${callId},
        provision_snapshot = ${JSON.stringify(snapshot)}::jsonb,
        started_at = now() - make_interval(mins => ${opts.ageMinutes ?? 0})
      where id = ${vsId}
    `);
  }
  await superDb.close();
  return { owner, orgId, vsId: vsId!, callId };
}

describe('internal voice routes', () => {
  it('are 404 without the right token', async () => {
    const { callId } = await ownLoopCall();
    for (const headers of [{}, { 'x-voice-token': 'wrong' }]) {
      const res = await api.request({ method: 'GET', url: `/internal/voice/calls/${callId}`, headers });
      expect(res.statusCode).toBe(404);
    }
  });

  it("return a live call's frozen plan and mark it active", async () => {
    const { callId, vsId } = await ownLoopCall();
    const res = await api.request({
      method: 'GET',
      url: `/internal/voice/calls/${callId}`,
      headers: { 'x-voice-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const plan = JSON.parse(res.body);
    expect(plan).toMatchObject({
      voiceSessionId: vsId,
      engine: 'own_loop_sarvam_voice',
      language: 'hi',
      firstMessage: 'Namaste, main Asha bol rahi hoon.',
      voiceId: 'shubh',
      questions: [{ id: 'notice_period', label: 'What is your notice period?' }],
    });
    const superDb = superDatabase();
    const rows = await superDb.db.execute<{ status: string }>(sql`select status from voice_sessions where id = ${vsId}`);
    await superDb.close();
    expect(rows[0]!.status).toBe('active');
  });

  it('are 404 for unknown, stale, or baseline-provider call ids', async () => {
    const stale = await ownLoopCall({ ageMinutes: 30 });
    const baseline = await ownLoopCall({ provider: 'elevenlabs' });
    for (const id of ['exo-unknown-123', stale.callId, baseline.callId]) {
      const res = await api.request({
        method: 'GET',
        url: `/internal/voice/calls/${id}`,
        headers: { 'x-voice-token': TOKEN },
      });
      expect(res.statusCode, id).toBe(404);
    }
  });

  it('a posted result ends the call, saves the transcript and prices it from usage', async () => {
    const { callId, vsId } = await ownLoopCall();
    const res = await api.request({
      method: 'POST',
      url: `/internal/voice/calls/${callId}/result`,
      headers: { 'x-voice-token': TOKEN },
      payload: {
        transcript: [
          { role: 'agent', message: 'Aapka notice period kitna hai?' },
          { role: 'user', message: 'Thirty days.' },
          { role: 'user', message: '   ' },
        ],
        durationSeconds: 125,
        endedReason: 'completed',
        usage: {
          sttSeconds: 120,
          llmInputTokens: 100000,
          llmOutputTokens: 10000,
          ttsCharacters: 2000,
          responseP50Ms: 820,
          responseP90Ms: 1400,
          interruptions: 2,
        },
      },
    });
    expect(res.statusCode).toBe(201);

    const superDb = superDatabase();
    const vs = await superDb.db.execute<{ status: string; duration_seconds: number; transcript: unknown[] }>(
      sql`select status, duration_seconds, transcript from voice_sessions where id = ${vsId}`,
    );
    const ledger = await superDb.db.execute<{
      engine: string;
      outcome: string;
      telephony_cost: string;
      stt_cost: string;
      tts_cost: string;
      total_cost: string;
      response_p50_ms: number;
      interruptions: number;
    }>(sql`
      select engine, outcome, telephony_cost::text, stt_cost::text, tts_cost::text, total_cost::text,
             response_p50_ms, interruptions
      from call_cost_ledger where voice_session_id = ${vsId}
    `);
    await superDb.close();

    expect(vs[0]!.status).toBe('ended');
    expect(vs[0]!.duration_seconds).toBe(125);
    expect(vs[0]!.transcript).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ engine: 'own_loop_sarvam_voice', outcome: 'completed', response_p50_ms: 820, interruptions: 2 });
    expect(Number(ledger[0]!.telephony_cost)).toBeCloseTo(2.25); // 3 started minutes × 0.75
    expect(Number(ledger[0]!.stt_cost)).toBeCloseTo(1.36); // 2 min × 0.68
    expect(Number(ledger[0]!.tts_cost)).toBeCloseTo(3.0); // 2k chars × 1.50
  });

  it('an engine error marks the call failed with that reason', async () => {
    const { callId, vsId } = await ownLoopCall();
    const res = await api.request({
      method: 'POST',
      url: `/internal/voice/calls/${callId}/result`,
      headers: { 'x-voice-token': TOKEN },
      payload: { transcript: [], durationSeconds: 4, endedReason: 'engine_error', usage: {} },
    });
    expect(res.statusCode).toBe(201);
    const superDb = superDatabase();
    const rows = await superDb.db.execute<{ status: string; failure_reason: string }>(
      sql`select status, failure_reason from voice_sessions where id = ${vsId}`,
    );
    await superDb.close();
    expect(rows[0]).toEqual({ status: 'failed', failure_reason: 'engine_error' });
  });
});

describe('job voice engine', () => {
  it('the platform admin sets a job engine in their workspace; others get 404', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: ADMIN_EMAIL, password: 'correct-horse-battery-staple', name: 'Admin' },
    });
    const raw = res.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
    await createOrganization(api, { cookie } as Parameters<typeof createOrganization>[1], `admin-ws-${Math.floor(Math.random() * 1e6)}`);
    const job = await api.request({ method: 'POST', url: '/jobs', cookie, payload: { title: 'Java dev' } });
    expect(job.statusCode).toBe(201);
    const jobId = (JSON.parse(job.body) as { id: string }).id;
    // Migration 0033: new jobs run on our loop with the Kore Chirp 3 HD voice.
    expect(JSON.parse((await api.request({ method: 'GET', url: `/jobs/${jobId}`, cookie })).body)).toMatchObject({
      voiceEngine: 'own_loop_google_voice',
      voicePersona: 'kore',
      ttsModel: 'gemini_flash',
    });

    const voice = await api.request({
      method: 'POST',
      url: `/admin/costs/jobs/${jobId}/engine`,
      cookie,
      payload: { engine: 'own_loop_google_voice', persona: 'iapetus', ttsModel: 'chirp3_hd' },
    });
    expect(voice.statusCode).toBe(201);
    expect(JSON.parse((await api.request({ method: 'GET', url: `/jobs/${jobId}`, cookie })).body)).toMatchObject({
      voicePersona: 'iapetus',
      ttsModel: 'chirp3_hd',
    });
    const bad = await api.request({
      method: 'POST',
      url: `/admin/costs/jobs/${jobId}/engine`,
      cookie,
      payload: { engine: 'own_loop_google_voice', persona: 'charon' },
    });
    expect(bad.statusCode).toBe(422);

    const set = await api.request({
      method: 'POST',
      url: `/admin/costs/jobs/${jobId}/engine`,
      cookie,
      payload: { engine: 'own_loop_sarvam_voice' },
    });
    expect(set.statusCode).toBe(201);
    const read = JSON.parse((await api.request({ method: 'GET', url: `/jobs/${jobId}`, cookie })).body);
    expect(read.voiceEngine).toBe('own_loop_sarvam_voice');
    expect(read.voicePersona).toBe('iapetus'); // engine-only change keeps the persona

    const other = await registerUser(api, 'not-admin');
    const denied = await api.request({
      method: 'POST',
      url: `/admin/costs/jobs/${jobId}/engine`,
      cookie: other.cookie,
      payload: { engine: 'elevenlabs_agent' },
    });
    expect(denied.statusCode).toBe(404);
  });
});

describe('migration 0033: Google voice', () => {
  it('prices Google voices and turns ElevenLabs off', async () => {
    const superDb = superDatabase();
    const rows = await superDb.db.execute<{ key: string; rate_inr: string; status: string }>(sql`
      select key, rate_inr::text, status from cost_services
      where key in ('google_tts', 'gemini_flash_tts', 'elevenlabs_tts', 'elevenlabs_agent', 'elevenlabs_plan')
      order by key
    `);
    await superDb.close();
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(Number(byKey['google_tts']!.rate_inr)).toBeCloseTo(2.64);
    expect(byKey['google_tts']!.status).toBe('in_use');
    expect(Number(byKey['gemini_flash_tts']!.rate_inr)).toBeCloseTo(1.3);
    for (const k of ['elevenlabs_tts', 'elevenlabs_agent', 'elevenlabs_plan']) expect(byKey[k]!.status).toBe('off');
  });

  it('jobs take the 11 launch languages and reject others', async () => {
    const owner = await registerUser(api, 'langs');
    await createOrganization(api, owner, `langs-org-${Math.floor(Math.random() * 1e6)}`);
    const ok = await api.request({ method: 'POST', url: '/jobs', cookie: owner.cookie, payload: { title: 'Tamil role', screeningLanguage: 'ta' } });
    expect(ok.statusCode).toBe(201);
    const jobId = (JSON.parse(ok.body) as { id: string }).id;
    const read = JSON.parse((await api.request({ method: 'GET', url: `/jobs/${jobId}`, cookie: owner.cookie })).body);
    expect(read.screeningLanguage).toBe('ta');
    const bad = await api.request({ method: 'POST', url: '/jobs', cookie: owner.cookie, payload: { title: 'Odia role', screeningLanguage: 'or' } });
    expect(bad.statusCode).toBe(422);
  });
});
