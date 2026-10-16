import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withoutTenantContext } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';
import {
  acceptInvitation,
  inviteAndCaptureToken,
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

  it('scopes Idempotency-Key per API key: another key never gets the first key\'s body', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const headers = { 'idempotency-key': 'idem-shared' };
    const secondKey = await mintKey(owner, 'live');
    const a = await v1(liveKey, 'POST', path, { fullName: 'Key One', phone: '9000000210', consent: true }, headers);
    const b = await v1(secondKey, 'POST', path, { fullName: 'Key Two', phone: '9000000211', consent: true }, headers);
    expect(a.statusCode, a.body).toBe(201);
    expect(b.statusCode, b.body).toBe(201);
    expect(JSON.parse(b.body).fullName).toBe('Key Two');
    expect(JSON.parse(b.body).id).not.toBe(JSON.parse(a.body).id);
  });

  it('creates nothing when one batch item fails, and a corrected retry creates all', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const mk = (n: number, phone: string) => ({ fullName: `Atomic ${n}`, phone, consent: true });
    const bad = await v1(liveKey, 'POST', path, {
      candidates: [mk(1, '9000000401'), mk(2, '9000000402'), mk(3, '9000000200')],
    });
    expect(bad.statusCode).toBe(409);
    expect(JSON.parse(bad.body).message).toContain('candidates[2]');
    const count = async () =>
      (JSON.parse((await v1(liveKey, 'GET', `${path}?limit=200`)).body).candidates as { fullName: string }[])
        .filter((c) => c.fullName.startsWith('Atomic')).length;
    expect(await count()).toBe(0);

    const ok = await v1(liveKey, 'POST', path, {
      candidates: [mk(1, '9000000401'), mk(2, '9000000402'), mk(3, '9000000403')],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await count()).toBe(3);
  });

  it('never creates twice for concurrent requests with one Idempotency-Key', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const headers = { 'idempotency-key': 'idem-race' };
    const payload = { fullName: 'Race', phone: '9000000500', consent: true };
    const [a, b] = await Promise.all([
      v1(liveKey, 'POST', path, payload, headers),
      v1(liveKey, 'POST', path, payload, headers),
    ]);
    const ok = [a, b].filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of [a, b]) {
      if (r.statusCode !== 201) {
        expect(r.statusCode).toBe(409);
        expect(JSON.parse(r.body).code).toBe('idempotency_in_progress');
      }
    }
    if (ok.length === 2) expect(JSON.parse(a.body).id).toBe(JSON.parse(b.body).id);
    const all = JSON.parse((await v1(liveKey, 'GET', `${path}?limit=200`)).body).candidates;
    expect(all.filter((c: { fullName: string }) => c.fullName === 'Race')).toHaveLength(1);
  });

  it('lets a retry with the same key run again after the handler failed', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const headers = { 'idempotency-key': 'idem-fail' };
    const dup = await v1(liveKey, 'POST', path, { fullName: 'F', phone: '9000000200', consent: true }, headers);
    expect(dup.statusCode).toBe(409);
    const fixed = await v1(liveKey, 'POST', path, { fullName: 'F', phone: '9000000700', consent: true }, headers);
    expect(fixed.statusCode, fixed.body).toBe(201);
  });

  it('completes a 12-way burst of different keys', async () => {
    const path = `/v1/jobs/${jobId}/candidates`;
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        v1(liveKey, 'POST', path, { fullName: `Burst ${i}`, phone: `90000008${String(i).padStart(2, '0')}`, consent: true },
          { 'idempotency-key': `burst-${i}` }),
      ),
    );
    expect(rs.map((r) => r.statusCode)).toEqual(Array(12).fill(201));
  });

  it('hides phone, email and country code from a key whose creator lacks candidates.read_pii', async () => {
    const admin = await registerUser(api, 'v1jobs-admin');
    const token = await inviteAndCaptureToken(api, owner, admin.email, 'administrator');
    expect((await acceptInvitation(api, admin, token)).statusCode).toBe(201);
    const key = await mintKey(admin, 'live');
    const path = `/v1/jobs/${jobId}/candidates`;
    const before = await v1(key, 'POST', path, { fullName: 'Pii', phone: '9000000600', consent: true });
    expect(JSON.parse(before.body)).toMatchObject({ phone: '9000000600' });

    // Downgrade the creator to analyst (read-only, no contact details).
    const db = superDatabase();
    try {
      await withoutTenantContext(db.db, (tx) =>
        tx.execute(sql`
          update organization_memberships m set role_id = r.id
          from roles r, users u
          where u.email = ${admin.email} and m.user_id = u.id
            and r.organization_id is null and r.key = 'analyst'
        `),
      );
    } finally {
      await db.close();
    }
    const list = JSON.parse((await v1(key, 'GET', `${path}?limit=200`)).body);
    expect(list.candidates.length).toBeGreaterThan(0);
    for (const c of list.candidates) {
      expect([c.phone, c.email, c.countryCode]).toEqual([null, null, null]);
    }
    const one = JSON.parse((await v1(key, 'GET', `${path}/${list.candidates[0].id}`)).body);
    expect([one.phone, one.email, one.countryCode]).toEqual([null, null, null]);
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
