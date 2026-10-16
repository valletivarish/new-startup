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
  type CallRequestsDeps,
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
let phoneSeq = 400;
let clock: Date;
const enqueued: { job: CallJob; startAfter?: Date }[] = [];
const dndNumbers = new Set<string>();

const todayAtIst = (h: number) => new Date(istMidnight(new Date()).getTime() + h * 3_600_000);

interface Org {
  owner: TestActor;
  orgId: string;
  key: string;
  jobId: string;
}

function makeService(overrides: Partial<CallRequestsDeps> = {}): CallRequestsService {
  const app = api.built.app;
  return createCallRequestsService({
    database: api.built.database,
    voice: app.get(VOICE_SESSION_SERVICE),
    jobs: app.get(JOBS_SERVICE),
    queue: {
      enqueueCall: async (job, startAfter) =>
        void enqueued.push({ job, ...(startAfter ? { startAfter } : {}) }),
    },
    dnd: { check: async (e164) => (dndNumbers.has(e164) ? 'dnd' : 'ok') },
    now: () => clock,
    ...overrides,
  });
}

function v1(org: Org, method: 'GET' | 'POST', url: string, payload?: object) {
  return api.request({
    method,
    url,
    headers: { authorization: `Bearer ${org.key}` },
    ...(payload ? { payload } : {}),
  });
}

/** A fresh company with a live key, a published agent and one job. */
async function setupOrg(label: string): Promise<Org> {
  const owner = await registerUser(api, label);
  const orgId = await createOrganization(api, owner, `${label} Co`);
  const minted = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: owner.cookie,
    payload: { name: 'ATS', mode: 'live', scopes: ['jobs', 'candidates', 'calls', 'results'] },
  });
  expect(minted.statusCode, minted.body).toBe(201);
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
  const org = { owner, orgId, key: JSON.parse(minted.body).key as string, jobId: '' };
  const job = await v1(org, 'POST', '/v1/jobs', { title: 'Picker' });
  expect(job.statusCode, job.body).toBe(201);
  org.jobId = JSON.parse(job.body).id;
  return org;
}

async function candidate(org: Org, phone = `9000000${++phoneSeq}`): Promise<string> {
  const res = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates`, {
    fullName: `Cand ${phone}`,
    phone,
    consent: true,
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).id;
}

/** Queue through the real route, then place with this test's clock and DND stub. */
async function requestAndPlace(org: Org, candidateId: string, service = makeService()) {
  const res = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates/${candidateId}/calls`);
  expect(res.statusCode, res.body).toBe(202);
  const id = JSON.parse(res.body).id as string;
  await service.place({ organizationId: org.orgId, userId: org.owner.userId, callRequestId: id });
  const got = await v1(org, 'GET', `/v1/calls/${id}`);
  expect(got.statusCode, got.body).toBe(200);
  return JSON.parse(got.body);
}

async function superSql<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    return await withoutTenantContext(db.db, (tx) => tx.execute<T>(query));
  } finally {
    await db.close();
  }
}

function setLimits(orgId: string, l: { perDay?: number; concurrent?: number; monthly?: number }) {
  return superSql(sql`
    insert into org_call_limits (organization_id, calls_per_day, max_concurrent, monthly_cap)
    values (${orgId}, ${l.perDay ?? 50}, ${l.concurrent ?? 3}, ${l.monthly ?? null})
    on conflict (organization_id) do update
      set calls_per_day = excluded.calls_per_day, max_concurrent = excluded.max_concurrent,
          monthly_cap = excluded.monthly_cap
  `);
}

async function expectLimited(org: Org, resetsAt: string | RegExp) {
  const res = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates/${await candidate(org)}/calls`);
  expect(res.statusCode, res.body).toBe(429);
  const body = JSON.parse(res.body);
  expect(body.code).toBe('call_limit_reached');
  if (typeof resetsAt === 'string') expect(body.details.resetsAt).toBe(resetsAt);
  else expect(body.details.resetsAt).toMatch(resetsAt);
}

let shared: Org;

beforeAll(async () => {
  api = await startApi(VOICE_ENV, createStubVoiceSessionAdapter());
  shared = await setupOrg('calls-shared');
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('/v1 call requests', () => {
  it('places an in-hours request', async () => {
    clock = todayAtIst(10);
    const call = await requestAndPlace(shared, await candidate(shared));
    expect(call).toMatchObject({ status: 'placed', reason: null });
    expect(call.result).toMatchObject({ status: 'active' });
    expect(call.result).not.toHaveProperty('fitPercent');
  });

  it('schedules an out-of-hours request for 09:00 IST', async () => {
    clock = todayAtIst(21);
    const call = await requestAndPlace(shared, await candidate(shared));
    const nine = todayAtIst(33).toISOString();
    expect(call).toMatchObject({ status: 'scheduled', notBefore: nine });
    expect(enqueued.at(-1)?.startAfter?.toISOString()).toBe(nine);
    expect(enqueued.at(-1)?.job.callRequestId).toBe(call.id);
  });

  it('does not re-enqueue when a fixed clock puts the next 09:00 in the real past', async () => {
    clock = new Date('2020-01-01T21:00:00+05:30');
    const before = enqueued.length;
    const call = await requestAndPlace(shared, await candidate(shared));
    expect(call).toMatchObject({
      status: 'scheduled',
      notBefore: new Date('2020-01-02T09:00:00+05:30').toISOString(),
    });
    // request() ran on the app's service (null queue); place() must not enqueue a past 09:00.
    expect(enqueued.length).toBe(before);
  });

  it('skips a candidate without consent', async () => {
    clock = todayAtIst(10);
    const id = await candidate(shared);
    await superSql(sql`update candidates set consent_at = null where id = ${id}`);
    expect(await requestAndPlace(shared, id)).toMatchObject({ status: 'skipped', reason: 'no_consent' });
  });

  it('skips a DND number', async () => {
    clock = todayAtIst(10);
    dndNumbers.add('+919000000999');
    expect(await requestAndPlace(shared, await candidate(shared, '9000000999'))).toMatchObject({
      status: 'skipped',
      reason: 'dnd',
    });
  });

  it('fails the row and returns 503 when the call cannot be queued', async () => {
    clock = todayAtIst(10);
    const service = makeService({
      queue: { enqueueCall: async () => { throw new Error('queue down'); } },
    });
    const candidateId = await candidate(shared);
    const err = await service
      .request(
        { organizationId: shared.orgId, userId: shared.owner.userId, apiKeyId: null, isTest: false },
        { jobId: shared.jobId, candidateId, source: 'api' },
      )
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'service_unavailable', status: 503 });
    const rows = await superSql<{ status: string; reason: string }>(sql`
      select status, reason from call_requests where candidate_id = ${candidateId}
    `);
    expect(rows).toEqual([{ status: 'failed', reason: 'enqueue_failed' }]);
  });

  it('fails a queued call whose requester left the company (creator_inactive)', async () => {
    clock = todayAtIst(10);
    const org = await setupOrg('calls-left');
    const cand = await candidate(org);
    const res = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates/${cand}/calls`);
    const id = JSON.parse(res.body).id as string;
    await superSql(sql`
      update organization_memberships set status = 'suspended' where organization_id = ${org.orgId}`);
    await makeService().place({ organizationId: org.orgId, userId: org.owner.userId, callRequestId: id });
    const [row] = await superSql<{ status: string; reason: string }>(
      sql`select status, reason from call_requests where id = ${id}`,
    );
    expect(row).toEqual({ status: 'failed', reason: 'creator_inactive' });
  });

  it('sweeps rows stuck in placing for over 10 minutes', async () => {
    const [stale, fresh] = [await candidate(shared), await candidate(shared)];
    const ins = await superSql<{ id: string }>(sql`
      insert into call_requests (organization_id, job_id, candidate_id, source, status, updated_at)
      values (${shared.orgId}, ${shared.jobId}, ${stale}, 'api', 'placing', now() - interval '11 minutes'),
             (${shared.orgId}, ${shared.jobId}, ${fresh}, 'api', 'placing', now())
      returning id
    `);
    expect(await makeService().sweepStuckPlacing(new Date())).toBeGreaterThanOrEqual(1);
    const rows = await superSql<{ candidate_id: string; status: string; reason: string | null }>(sql`
      select candidate_id, status, reason from call_requests
      where id in (${ins[0]!.id}, ${ins[1]!.id})
    `);
    expect(rows.find((r) => r.candidate_id === stale)).toMatchObject({ status: 'failed', reason: 'internal_error' });
    expect(rows.find((r) => r.candidate_id === fresh)).toMatchObject({ status: 'placing', reason: null });
  });
});

describe('call limits', () => {
  it('calls_per_day: 429 with resetsAt at next IST midnight, on /v1 and the dashboard', async () => {
    clock = todayAtIst(10);
    const org = await setupOrg('calls-daily');
    await setLimits(org.orgId, { perDay: 1 });
    expect(await requestAndPlace(org, await candidate(org))).toMatchObject({ status: 'placed' });

    await expectLimited(org, new Date(istMidnight(new Date()).getTime() + 86_400_000).toISOString());
    const dash = await api.request({
      method: 'POST',
      url: `/jobs/${org.jobId}/candidates/${await candidate(org)}/outbound-call`,
      cookie: org.owner.cookie,
      payload: {},
    });
    expect(dash.statusCode, dash.body).toBe(429);
    expect(JSON.parse(dash.body).code).toBe('call_limit_reached');
  });

  it('max_concurrent: 429 while a call is live', async () => {
    clock = todayAtIst(10);
    const org = await setupOrg('calls-concurrent');
    await setLimits(org.orgId, { concurrent: 1 });
    expect(await requestAndPlace(org, await candidate(org))).toMatchObject({ status: 'placed' });
    await expectLimited(org, /^\d{4}-\d\d-\d\dT/);
  });

  it('a limit hit at place time holds the call (scheduled at resetsAt), never fails it', async () => {
    clock = todayAtIst(10);
    const org = await setupOrg('calls-throttle');
    await setLimits(org.orgId, { concurrent: 1 });
    const ids: string[] = [];
    // All three pass the request-time check: nothing is live yet.
    for (let i = 0; i < 3; i++) {
      const res = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates/${await candidate(org)}/calls`);
      expect(res.statusCode, res.body).toBe(202);
      ids.push(JSON.parse(res.body).id);
    }
    const service = makeService();
    const before = enqueued.length;
    for (const id of ids) {
      await service.place({ organizationId: org.orgId, userId: org.owner.userId, callRequestId: id });
    }
    const rows = await superSql<{ id: string; status: string; not_before: string | null }>(sql`
      select id, status, not_before from call_requests where job_id = ${org.jobId}`);
    expect(rows.filter((r) => r.status === 'placed')).toHaveLength(1);
    const held = rows.filter((r) => r.status === 'scheduled');
    expect(held).toHaveLength(2);
    // Concurrency resets a minute after the place-time clock.
    for (const r of held) expect(new Date(r.not_before!).getTime()).toBe(clock.getTime() + 60_000);
    const requeued = enqueued.slice(before);
    expect(requeued.map((e) => e.job.callRequestId).sort()).toEqual(held.map((r) => r.id).sort());
    for (const e of requeued) expect(e.startAfter!.getTime()).toBeGreaterThan(Date.now());
  });

  it('monthly_cap: 429 with resetsAt at the 1st of next IST month', async () => {
    clock = todayAtIst(10);
    const org = await setupOrg('calls-monthly');
    await setLimits(org.orgId, { monthly: 1 });
    expect(await requestAndPlace(org, await candidate(org))).toMatchObject({ status: 'placed' });
    const ist = new Date(clock.getTime() + 330 * 60_000);
    const nextMonth = new Date(
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - 330 * 60_000,
    ).toISOString();
    await expectLimited(org, nextMonth);
  });
});
