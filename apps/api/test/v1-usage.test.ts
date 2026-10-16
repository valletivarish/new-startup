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

const ADMIN_EMAIL = `usage-admin-${Math.floor(Math.random() * 1e9)}@example.test`;
const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);

let api: ApiHarness;

beforeAll(async () => {
  api = await startApi(
    {
      ELEVENLABS_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'stub',
      ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
      PLATFORM_ADMIN_EMAILS: ADMIN_EMAIL,
    },
    createStubVoiceSessionAdapter(),
  );
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

async function mintKey(owner: TestActor, scopes: string[]): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: owner.cookie,
    payload: { name: 'ATS', mode: 'live', scopes },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { key: string }).key;
}

function v1(key: string, url: string) {
  return api.request({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });
}

/** A company with a published agent, a job (via /v1) and one candidate. */
async function setupOrg(label: string, orgName = `${label} Co`) {
  const owner = await registerUser(api, label);
  const orgId = await createOrganization(api, owner, orgName);
  const agentRes = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screen', purpose: 'Screen', description: 'usage test', agentType: 'hiring' },
  });
  const agent = JSON.parse(agentRes.body) as { id: string; versionId: string };
  await api.request({
    method: 'POST',
    url: `/agents/${agent.id}/versions/${agent.versionId}/publish`,
    cookie: owner.cookie,
    payload: {},
  });
  const key = await mintKey(owner, ['jobs', 'candidates', 'calls', 'results', 'usage']);
  const job = await api.request({
    method: 'POST',
    url: '/v1/jobs',
    headers: { authorization: `Bearer ${key}` },
    payload: { title: 'Cashier', mustAskQuestions: ['Notice period?'] },
  });
  expect(job.statusCode, job.body).toBe(201);
  const jobId = JSON.parse(job.body).id as string;
  const cand = await api.request({
    method: 'POST',
    url: `/v1/jobs/${jobId}/candidates`,
    headers: { authorization: `Bearer ${key}` },
    payload: { fullName: 'Asha', phone: `90000${Math.floor(10000 + Math.random() * 89999)}`, consent: true },
  });
  expect(cand.statusCode, cand.body).toBe(201);
  return { owner, orgId, agent, key, jobId, candidateId: JSON.parse(cand.body).id as string };
}

/** A phone voice session on the org's agent, shaped by `fields`; optionally with a ledger row. */
async function seedSession(
  org: Awaited<ReturnType<typeof setupOrg>>,
  o: { outcome: 'completed' | 'short'; isTest?: boolean; seconds: number; candidate?: boolean; recording?: boolean },
) {
  const start = await api.request({
    method: 'POST',
    url: `/agents/${org.agent.id}/voice-sessions`,
    cookie: org.owner.cookie,
    payload: {},
  });
  const vsId = (JSON.parse(start.body) as { voiceSessionId: string }).voiceSessionId;
  const transcript = JSON.stringify([
    { role: 'agent', message: 'Notice period?' },
    { role: 'user', message: 'Thirty days.' },
  ]);
  await superSql(sql`
    update agent_sessions set channel = 'phone'
    where id = (select session_id from voice_sessions where id = ${vsId})
  `);
  await superSql(sql`
    update voice_sessions set is_test = ${o.isTest ?? false}, duration_seconds = ${o.seconds},
      status = 'ended', transcript = ${transcript}::jsonb, summary = 'Candidate is available in 30 days. Strong hire.',
      structured_answers = '{"notice_period":"30 days"}'::jsonb,
      external_conversation_id = ${o.recording ? `conv-${Math.random().toString(36).slice(2)}` : null},
      job_id = ${o.candidate ? org.jobId : null}, candidate_id = ${o.candidate ? org.candidateId : null}
    where id = ${vsId}
  `);
  await superSql(sql`
    insert into call_cost_ledger (organization_id, voice_session_id, channel, outcome)
    values (${org.orgId}, ${vsId}, 'phone', ${o.outcome})
  `);
  return vsId;
}

let adminCookieValue: string | undefined;
async function adminCookie(): Promise<string> {
  if (adminCookieValue) return adminCookieValue;
  const res = await api.request({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email: ADMIN_EMAIL, password: 'correct-horse-battery-staple', name: 'Admin' },
  });
  const raw = res.headers['set-cookie'];
  adminCookieValue = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
  return adminCookieValue;
}

describe('/v1/usage', () => {
  it('counts completed screens, ignores test and short calls', async () => {
    const org = await setupOrg('usage-count');
    await seedSession(org, { outcome: 'completed', seconds: 61 });
    await seedSession(org, { outcome: 'completed', seconds: 90 });
    await seedSession(org, { outcome: 'short', seconds: 8 });
    await seedSession(org, { outcome: 'completed', seconds: 70, isTest: true });

    const res = await v1(org.key, `/v1/usage?month=${month}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      month,
      callsPlaced: 3,
      completedScreens: 2,
      pricePerScreenInr: null,
      amountInr: null,
    });
  });
});

describe('/v1 results', () => {
  it('omits transcript without results scope, and never exposes scores or hire advice', async () => {
    const org = await setupOrg('usage-results');
    await seedSession(org, { outcome: 'completed', seconds: 61, candidate: true });
    const path = `/v1/jobs/${org.jobId}/candidates/${org.candidateId}/results`;

    const full = JSON.parse((await v1(org.key, path)).body);
    expect(full.transcript).toHaveLength(2);
    expect(full.answers).toEqual([
      expect.objectContaining({ question: 'Notice period?', answer: '30 days' }),
    ]);

    const noResults = await mintKey(org.owner, ['jobs', 'candidates', 'calls']);
    const res = await v1(noResults, path);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transcript).toBeUndefined();
    expect(body.recordingUrl).toBeUndefined();
    expect(body.summary).toContain('available in 30 days');
    expect(res.body).not.toMatch(/fitPercent|hire/i);
  });
});

describe('/v1 recording', () => {
  it('serves with the results scope; 403 without calls.read_recording; 404 for another org', async () => {
    const org = await setupOrg('usage-rec');
    const other = await setupOrg('usage-rec-other');
    const vsId = await seedSession(org, { outcome: 'completed', seconds: 61, candidate: true, recording: true });
    const results = JSON.parse(
      (await v1(org.key, `/v1/jobs/${org.jobId}/candidates/${org.candidateId}/results`)).body,
    );
    expect(results.recordingUrl).toMatch(new RegExp(`/v1/calls/${vsId}/recording$`));
    const path = new URL(results.recordingUrl).pathname;

    const ok = await v1(org.key, path);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('audio/mpeg');

    const noScope = await mintKey(org.owner, ['jobs', 'candidates', 'calls']);
    expect((await v1(noScope, path)).statusCode).toBe(403);
    expect((await v1(other.key, path)).statusCode).toBe(404);

    const noRec = await seedSession(other, { outcome: 'completed', seconds: 61 });
    expect((await v1(other.key, `/v1/calls/${noRec}/recording`)).statusCode).toBe(404);
  });
});

describe('admin limits and invoice', () => {
  it('admin sets limits and price; non-admin gets 404', async () => {
    const org = await setupOrg('usage-admin');
    const url = `/admin/costs/orgs/${org.orgId}/limits`;
    const body = { callsPerDay: 7, maxConcurrent: 2, monthlyCap: 100, pricePerScreenInr: 12.5 };

    expect((await api.request({ method: 'GET', url, cookie: org.owner.cookie })).statusCode).toBe(404);
    expect(
      (await api.request({ method: 'PUT', url, cookie: org.owner.cookie, payload: body })).statusCode,
    ).toBe(404);

    const cookie = await adminCookie();
    const put = await api.request({ method: 'PUT', url, cookie, payload: body });
    expect(put.statusCode, put.body).toBe(200);
    const got = JSON.parse((await api.request({ method: 'GET', url, cookie })).body);
    expect(got.limits).toEqual(body);

    const missing = await api.request({
      method: 'PUT',
      url: '/admin/costs/orgs/00000000-0000-4000-8000-000000000001/limits',
      cookie,
      payload: body,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('invoice.csv has one row per org with amount = screens x price', async () => {
    const org = await setupOrg('usage-invoice', '=1+1');
    await seedSession(org, { outcome: 'completed', seconds: 61 });
    await seedSession(org, { outcome: 'completed', seconds: 80 });
    await seedSession(org, { outcome: 'completed', seconds: 80 });
    const cookie = await adminCookie();
    await api.request({
      method: 'PUT',
      url: `/admin/costs/orgs/${org.orgId}/limits`,
      cookie,
      payload: { callsPerDay: 50, maxConcurrent: 3, monthlyCap: null, pricePerScreenInr: 12.5 },
    });

    const denied = await api.request({ method: 'GET', url: '/admin/costs/invoice.csv', cookie: org.owner.cookie });
    expect(denied.statusCode).toBe(404);

    const res = await api.request({ method: 'GET', url: `/admin/costs/invoice.csv?month=${month}`, cookie });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('organization,month,completed_screens,price_per_screen_inr,amount_inr');
    // A formula-looking org name is neutralised with a leading '.
    expect(lines).toContain(`'=1+1,${month},3,12.50,37.50`);
  });
});
