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
import {
  createCallRequestsService,
  type CallRequestsService,
} from '../src/integrations/call-requests.service.js';
import { istMidnight } from '../src/integrations/calling-hours.js';
import type { CallJob } from '../src/jobs/queue.js';
import { JOBS_SERVICE, VOICE_SESSION_SERVICE } from '../src/tokens.more.js';

const VOICE_ENV: Record<string, string> = {
  ELEVENLABS_ENABLED: 'true',
  ELEVENLABS_API_KEY: 'test-key',
  ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
};

let api: ApiHarness;
let owner: TestActor;
let orgId: string;
let key: string;
let jobId: string;
let clock: Date;
const enqueued: { job: CallJob; startAfter?: Date }[] = [];
const dndNumbers = new Set<string>();
let service: CallRequestsService;

const todayAtIst = (h: number) => new Date(istMidnight(new Date()).getTime() + h * 3_600_000);

function v1(method: 'GET' | 'POST', url: string, payload?: object) {
  return api.request({
    method,
    url,
    headers: { authorization: `Bearer ${key}` },
    ...(payload ? { payload } : {}),
  });
}

async function candidate(phone: string): Promise<string> {
  const res = await v1('POST', `/v1/jobs/${jobId}/candidates`, {
    fullName: `Cand ${phone}`,
    phone,
    consent: true,
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id;
}

/** Queue through the real route, then place with this test's clock and DND stub. */
async function requestAndPlace(candidateId: string) {
  const res = await v1('POST', `/v1/jobs/${jobId}/candidates/${candidateId}/calls`);
  expect(res.statusCode, res.body).toBe(202);
  const id = JSON.parse(res.body).id as string;
  await service.place({ organizationId: orgId, userId: owner.userId, callRequestId: id });
  const got = await v1('GET', `/v1/calls/${id}`);
  expect(got.statusCode, got.body).toBe(200);
  return JSON.parse(got.body);
}

async function superSql(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    await withoutTenantContext(db.db, (tx) => tx.execute(query));
  } finally {
    await db.close();
  }
}

beforeAll(async () => {
  api = await startApi(VOICE_ENV, createStubVoiceSessionAdapter());
  owner = await registerUser(api, 'calls-a');
  orgId = await createOrganization(api, owner, 'Calls Co');
  const minted = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: owner.cookie,
    payload: { name: 'ATS', mode: 'live', scopes: ['jobs', 'candidates', 'calls', 'results'] },
  });
  expect(minted.statusCode, minted.body).toBe(201);
  key = JSON.parse(minted.body).key;

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
  const job = await v1('POST', '/v1/jobs', { title: 'Picker' });
  expect(job.statusCode, job.body).toBe(201);
  jobId = JSON.parse(job.body).id;

  const app = api.built.app;
  service = createCallRequestsService({
    database: api.built.database,
    voice: app.get(VOICE_SESSION_SERVICE),
    jobs: app.get(JOBS_SERVICE),
    queue: { enqueueCall: async (job, startAfter) => void enqueued.push({ job, ...(startAfter ? { startAfter } : {}) }) },
    dnd: { check: async (e164) => (dndNumbers.has(e164) ? 'dnd' : 'ok') },
    now: () => clock,
  });
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('/v1 call requests', () => {
  it('places an in-hours request', async () => {
    clock = todayAtIst(10);
    const call = await requestAndPlace(await candidate('9000000401'));
    expect(call).toMatchObject({ status: 'placed', reason: null });
    expect(call.result).toMatchObject({ status: 'active' });
    expect(call.result).not.toHaveProperty('fitPercent');
  });

  it('schedules an out-of-hours request for 09:00 IST', async () => {
    clock = todayAtIst(21);
    const call = await requestAndPlace(await candidate('9000000402'));
    const nine = todayAtIst(33).toISOString();
    expect(call).toMatchObject({ status: 'scheduled', notBefore: nine });
    expect(enqueued.at(-1)?.startAfter?.toISOString()).toBe(nine);
    expect(enqueued.at(-1)?.job.callRequestId).toBe(call.id);
  });

  it('skips a candidate without consent', async () => {
    clock = todayAtIst(10);
    const id = await candidate('9000000403');
    await superSql(sql`update candidates set consent_at = null where id = ${id}`);
    expect(await requestAndPlace(id)).toMatchObject({ status: 'skipped', reason: 'no_consent' });
  });

  it('skips a DND number', async () => {
    clock = todayAtIst(10);
    dndNumbers.add('+919000000404');
    expect(await requestAndPlace(await candidate('9000000404'))).toMatchObject({
      status: 'skipped',
      reason: 'dnd',
    });
  });

  it('returns 429 call_limit_reached past calls_per_day, on /v1 and the dashboard', async () => {
    clock = todayAtIst(10);
    await superSql(sql`
      insert into org_call_limits (organization_id, calls_per_day) values (${orgId}, 1)
      on conflict (organization_id) do update set calls_per_day = 1
    `);
    const candidateId = await candidate('9000000405');
    const resetsAt = new Date(istMidnight(new Date()).getTime() + 86_400_000).toISOString();

    const res = await v1('POST', `/v1/jobs/${jobId}/candidates/${candidateId}/calls`);
    expect(res.statusCode, res.body).toBe(429);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'call_limit_reached', details: { resetsAt } });

    const dash = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${candidateId}/outbound-call`,
      cookie: owner.cookie,
      payload: {},
    });
    expect(dash.statusCode, dash.body).toBe(429);
    expect(JSON.parse(dash.body).code).toBe('call_limit_reached');
  });
});
