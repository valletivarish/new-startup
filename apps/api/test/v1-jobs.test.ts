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

let api: ApiHarness;
let owner: TestActor;
let otherOwner: TestActor;
let liveKey: string;
let testKey: string;
let otherKey: string;
const bodies: string[] = [];

async function mintKey(actor: TestActor, mode: 'live' | 'test'): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: actor.cookie,
    payload: { name: 'ATS', mode, scopes: ['jobs', 'candidates'] },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { key: string }).key;
}

function v1(
  key: string,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return api
    .request({
      method,
      url,
      headers: { authorization: `Bearer ${key}`, ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    })
    .then((res) => {
      bodies.push(res.body);
      return res;
    });
}

async function publishHiringAgent(actor: TestActor, name: string) {
  const res = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: actor.cookie,
    payload: { name, purpose: 'Screen', description: 'v1 test', agentType: 'hiring' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const a = JSON.parse(res.body) as { id: string; versionId: string };
  const pub = await api.request({
    method: 'POST',
    url: `/agents/${a.id}/versions/${a.versionId}/publish`,
    cookie: actor.cookie,
    payload: {},
  });
  expect([200, 201]).toContain(pub.statusCode);
}

let jobId: string;

beforeAll(async () => {
  api = await startApi();
  owner = await registerUser(api, 'v1jobs-a');
  otherOwner = await registerUser(api, 'v1jobs-b');
  await createOrganization(api, owner, 'V1 Co A');
  await createOrganization(api, otherOwner, 'V1 Co B');
  liveKey = await mintKey(owner, 'live');
  testKey = await mintKey(owner, 'test');
  otherKey = await mintKey(otherOwner, 'live');
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('/v1 jobs and candidates', () => {
  it('needs an agent to create a job (409 agent_required), then round-trips', async () => {
    const none = await v1(liveKey, 'POST', '/v1/jobs', { title: 'Cashier' });
    expect(none.statusCode).toBe(409);
    expect(JSON.parse(none.body).code).toBe('agent_required');

    await publishHiringAgent(owner, 'V1 Screener');
    const created = await v1(liveKey, 'POST', '/v1/jobs', {
      title: 'Cashier',
      mustAskQuestions: ['Notice period?'],
    });
    expect(created.statusCode, created.body).toBe(201);
    jobId = JSON.parse(created.body).id;

    const list = await v1(liveKey, 'GET', '/v1/jobs');
    expect(JSON.parse(list.body).jobs.map((j: { id: string }) => j.id)).toContain(jobId);
    const got = await v1(liveKey, 'GET', `/v1/jobs/${jobId}`);
    expect(JSON.parse(got.body)).toMatchObject({ title: 'Cashier', questions: [{ text: 'Notice period?' }] });

    const patched = await v1(liveKey, 'PATCH', `/v1/jobs/${jobId}`, { title: 'Head Cashier' });
    expect(JSON.parse(patched.body).title).toBe('Head Cashier');
  });

  it('marks jobs and candidates from a test key as is_test', async () => {
    const res = await v1(testKey, 'POST', '/v1/jobs', { title: 'Sandbox job' });
    expect(res.statusCode, res.body).toBe(201);
    const testJobId = JSON.parse(res.body).id;
    const cand = await v1(testKey, 'POST', `/v1/jobs/${testJobId}/candidates`, {
      fullName: 'T',
      phone: '9000000300',
      consent: true,
    });
    expect(cand.statusCode, cand.body).toBe(201);

    const db = superDatabase();
    try {
      const rows = await withoutTenantContext(db.db, (tx) =>
        tx.execute<{ job_test: boolean; cand_test: boolean; source: string | null; consent: boolean }>(sql`
          select j.is_test as job_test, c.is_test as cand_test,
                 c.consent_source as source, c.consent_at is not null as consent
          from jobs j join candidates c on c.job_id = j.id where j.id = ${testJobId}
        `),
      );
      expect(rows[0]).toEqual({ job_test: true, cand_test: true, source: 'customer', consent: true });
    } finally {
      await db.close();
    }
  });

  it('rejects a candidate without consent', async () => {
    const res = await v1(liveKey, 'POST', `/v1/jobs/${jobId}/candidates`, {
      fullName: 'No Consent',
      phone: '9000000001',
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('consent_required');
  });

  it('upserts by externalId', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const first = await v1(liveKey, 'POST', path, {
      fullName: 'Asha',
      phone: '9000000002',
      externalId: 'ats-1',
      consent: true,
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(JSON.parse(first.body).created).toBe(true);
    const second = await v1(liveKey, 'POST', path, {
      fullName: 'Asha Rao',
      externalId: 'ats-1',
      consent: true,
    });
    expect(second.statusCode).toBe(200);
    const b = JSON.parse(second.body);
    expect(b).toMatchObject({ created: false, fullName: 'Asha Rao', id: JSON.parse(first.body).id });

    const one = await v1(liveKey, 'GET', `${path}/${b.id}`);
    expect(JSON.parse(one.body).externalId).toBe('ats-1');
  });

  it('creates a batch of 3 and pages the list', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const res = await v1(liveKey, 'POST', path, {
      candidates: [1, 2, 3].map((n) => ({
        fullName: `Batch ${n}`,
        phone: `900000010${n}`,
        consent: true,
      })),
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body).candidates as { created: boolean }[];
    expect(created.filter((c) => c.created)).toHaveLength(3);

    const p1 = JSON.parse((await v1(liveKey, 'GET', `${path}?limit=2`)).body);
    expect(p1.candidates).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = JSON.parse(
      (await v1(liveKey, 'GET', `${path}?limit=2&cursor=${p1.nextCursor}`)).body,
    );
    expect(p2.candidates.length).toBeGreaterThan(0);
  });

  it('replays the first response for a repeated Idempotency-Key', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const headers = { 'idempotency-key': 'idem-1' };
    const payload = { fullName: 'Idem', phone: '9000000200', consent: true };
    const a = await v1(liveKey, 'POST', path, payload, headers);
    const b = await v1(liveKey, 'POST', path, payload, headers);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(JSON.parse(b.body)).toEqual(JSON.parse(a.body));
    const all = JSON.parse((await v1(liveKey, 'GET', `${path}?limit=200`)).body).candidates;
    expect(all.filter((c: { fullName: string }) => c.fullName === 'Idem')).toHaveLength(1);
  });

  it("another company's key cannot see the job", async () => {
    const res = await v1(otherKey, 'GET', `/v1/jobs/${jobId}`);
    expect(res.statusCode).toBe(404);
    expect((await v1(otherKey, 'GET', `/v1/jobs/${jobId}/candidates`)).statusCode).toBe(404);
  });

  it('never exposes fitPercent', () => {
    expect(bodies.length).toBeGreaterThan(5);
    for (const b of bodies) expect(b).not.toMatch(/fitPercent|fit_percent/);
  });
});
