/**
 * Cost ledger + platform-admin cost dashboard.
 *
 *   - a webhook-ended baseline call writes one priced ledger row
 *   - only PLATFORM_ADMIN_EMAILS can reach /admin/costs (others: 404)
 *   - the admin sees calls across companies; a customer's own context never does
 *   - rates are editable by the admin; ratings land on the ledger row
 */

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@platform/db';
import { startApi, registerUser, createOrganization, type ApiHarness } from './setup/api-harness.js';
import { superDatabase } from './setup/fixtures.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';

const SECRET = 'test-webhook-secret-32-chars-xxxxx';
const ADMIN_EMAIL = `platform-admin-${Math.floor(Math.random() * 1e9)}@example.test`;

const STUB = {
  ...createStubVoiceSessionAdapter(),
  verifyWebhookSignature(payload: string, sig: string): boolean {
    const expected = createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex');
    return sig.replace(/^xi-signature-256=/i, '') === expected;
  },
} as ReturnType<typeof createStubVoiceSessionAdapter>;

let api: ApiHarness;

beforeAll(async () => {
  api = await startApi(
    {
      ELEVENLABS_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'stub',
      ELEVENLABS_WEBHOOK_SECRET: SECRET,
      PLATFORM_ADMIN_EMAILS: `someone-else@example.test, ${ADMIN_EMAIL.toUpperCase()}`,
    },
    STUB,
  );
});

afterAll(async () => {
  await api.close();
});

async function signUp(email: string): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Admin' },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [String(raw)];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** A customer company with one webhook-ended baseline call. */
async function companyWithEndedCall(label: string) {
  const owner = await registerUser(api, label);
  const orgId = await createOrganization(api, owner, `${label}-org-${Math.floor(Math.random() * 1e6)}`);
  const agentRes = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screen', purpose: 'Screen candidates', description: 'cost test' },
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
  const vsId = (JSON.parse(start.body) as { voiceSessionId: string }).voiceSessionId;
  const conversationId = `conv-cost-${Math.floor(Math.random() * 1e9)}`;
  const superDb = superDatabase();
  await superDb.db.execute(
    sql`update voice_sessions set external_conversation_id = ${conversationId} where id = ${vsId}`,
  );
  await superDb.close();

  const payload = JSON.stringify({
    type: 'post_call_transcription',
    data: {
      conversation_id: conversationId,
      transcript: [
        { role: 'agent', message: 'Notice period?' },
        { role: 'user', message: 'Thirty days.' },
      ],
      metadata: { call_duration_secs: 61, cost: 1000 },
    },
  });
  const hook = await api.request({
    method: 'POST',
    url: '/webhooks/elevenlabs',
    headers: {
      'xi-signature-256': createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex'),
      'content-type': 'application/json',
    },
    payload,
  });
  expect(hook.statusCode).toBe(201);
  return { owner, orgId, vsId };
}

describe('call cost ledger', () => {
  it('prices a webhook-ended baseline call: credits × rate + telephony per started minute', async () => {
    const { vsId } = await companyWithEndedCall('ledger');
    const superDb = superDatabase();
    const rows = await superDb.db.execute<{
      engine: string;
      outcome: string;
      agent_cost: string;
      telephony_cost: string;
      total_cost: string;
    }>(sql`
      select engine, outcome, agent_cost::text, telephony_cost::text, total_cost::text
      from call_cost_ledger where voice_session_id = ${vsId}
    `);
    await superDb.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.engine).toBe('elevenlabs_agent');
    expect(rows[0]!.outcome).toBe('completed');
    expect(Number(rows[0]!.agent_cost)).toBeCloseTo(18.5); // 1000 credits × 0.0185
    expect(Number(rows[0]!.telephony_cost)).toBeCloseTo(1.5); // 2 started minutes × 0.75
    expect(Number(rows[0]!.total_cost)).toBeCloseTo(20.0);
  });
});

describe('platform admin cost dashboard', () => {
  it('hides /admin/costs from non-admins with 404', async () => {
    const { owner } = await companyWithEndedCall('not-admin');
    const res = await api.request({ method: 'GET', url: '/admin/costs/summary', cookie: owner.cookie });
    expect(res.statusCode).toBe(404);
    const me = JSON.parse((await api.request({ method: 'GET', url: '/auth/me', cookie: owner.cookie })).body);
    expect(me.isPlatformAdmin).toBe(false);
  });

  it('shows the admin calls from every company, and edits rates', async () => {
    const a = await companyWithEndedCall('company-a');
    const b = await companyWithEndedCall('company-b');
    const cookie = await signUp(ADMIN_EMAIL);

    const me = JSON.parse((await api.request({ method: 'GET', url: '/auth/me', cookie })).body);
    expect(me.isPlatformAdmin).toBe(true);

    const calls = await api.request({ method: 'GET', url: '/admin/costs/calls', cookie });
    expect(calls.statusCode).toBe(200);
    const ids = (JSON.parse(calls.body).calls as { voiceSessionId: string }[]).map((c) => c.voiceSessionId);
    expect(ids).toEqual(expect.arrayContaining([a.vsId, b.vsId]));

    const summary = await api.request({ method: 'GET', url: '/admin/costs/summary', cookie });
    expect(summary.statusCode).toBe(200);
    const arms = JSON.parse(summary.body).summary.arms as { engine: string; calls: number; completedScreens: number }[];
    const baseline = arms.find((x) => x.engine === 'elevenlabs_agent')!;
    expect(baseline.calls).toBeGreaterThanOrEqual(2);
    expect(baseline.completedScreens).toBeGreaterThanOrEqual(2);

    const patch = await api.request({
      method: 'PATCH',
      url: '/admin/costs/services/exotel_minute',
      cookie,
      payload: { rateInr: 0.55, status: 'in_use' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).service.rateInr).toBeCloseTo(0.55);

    const rate = await api.request({
      method: 'POST',
      url: `/admin/costs/calls/${a.vsId}/rating`,
      cookie,
      payload: { rating: 4, note: 'Natural, one slow reply' },
    });
    expect(rate.statusCode).toBe(201);

    // restore the seed rate for other tests
    await api.request({
      method: 'PATCH',
      url: '/admin/costs/services/exotel_minute',
      cookie,
      payload: { rateInr: 0.75 },
    });
  });

  it("a customer's own tenant context still cannot read another company's ledger", async () => {
    const a = await companyWithEndedCall('iso-a');
    const b = await companyWithEndedCall('iso-b');
    void b;
    const res = await api.request({ method: 'GET', url: '/admin/costs/calls', cookie: a.owner.cookie });
    expect(res.statusCode).toBe(404);
  });
});
