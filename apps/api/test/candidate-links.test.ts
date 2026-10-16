import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withoutTenantContext } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';
import {
  createOrganization,
  registerUser,
  startApi,
  type ApiHarness,
} from './setup/api-harness.js';

let api: ApiHarness;
let orgId: string;
let key: string;
let jobId: string;

async function superSql<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    return await withoutTenantContext(db.db, (tx) => tx.execute<T>(query));
  } finally {
    await db.close();
  }
}

async function mintLink(payload: object = {}) {
  const res = await api.request({
    method: 'POST',
    url: `/v1/jobs/${jobId}/candidate-links`,
    headers: { authorization: `Bearer ${key}` },
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  const body = JSON.parse(res.body) as { url: string; expiresAt: string };
  return { ...body, token: body.url.split('/c/')[1]! };
}

// A fresh "IP" per call, so the 10/min limit only bites in its own test.
let ip = 0;
const nextIp = () => `10.1.${Math.floor(++ip / 250)}.${ip % 250}`;
const open = (token: string, remoteAddress = nextIp()) =>
  api.request({ method: 'GET', url: `/public/candidate-links/${token}`, remoteAddress });
const submit = (token: string, payload: object) =>
  api.request({ method: 'POST', url: `/public/candidate-links/${token}`, payload, remoteAddress: nextIp() });

const candidateOf = (phone: string) =>
  superSql<{ id: string; full_name: string; consent_at: string | null; consent_source: string | null }>(sql`
    select id, full_name, consent_at, consent_source from candidates
    where organization_id = ${orgId} and phone = ${phone}`);
const requestsFor = (candidateId: string) =>
  superSql(sql`select 1 from call_requests where candidate_id = ${candidateId}`);

const answer = { fullName: 'Asha Rao', phone: '9000011111', countryCode: '+91', consent: true };

beforeAll(async () => {
  api = await startApi();
  const owner = await registerUser(api, 'links-a');
  orgId = await createOrganization(api, owner, 'Links Co');
  const agent = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screener', purpose: 'Screen', description: 'links', agentType: 'hiring' },
  });
  const a = JSON.parse(agent.body) as { id: string; versionId: string };
  await api.request({
    method: 'POST',
    url: `/agents/${a.id}/versions/${a.versionId}/publish`,
    cookie: owner.cookie,
    payload: {},
  });
  const minted = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: owner.cookie,
    payload: { name: 'ATS', mode: 'live', scopes: ['jobs', 'candidates', 'calls'] },
  });
  key = (JSON.parse(minted.body) as { key: string }).key;
  const job = await api.request({
    method: 'POST',
    url: '/v1/jobs',
    headers: { authorization: `Bearer ${key}` },
    payload: { title: 'Field Sales Executive' },
  });
  expect(job.statusCode, job.body).toBe(201);
  jobId = (JSON.parse(job.body) as { id: string }).id;
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('ask-the-candidate link', () => {
  it('create, open, submit: candidate consent and a call request; then the link is spent', async () => {
    const link = await mintLink();
    expect(link.token).toMatch(/^[0-9A-Za-z]{32}$/);
    const days = (Date.parse(link.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    // Only the hash is stored.
    const stored = await superSql<{ token_hash: string }>(
      sql`select token_hash from candidate_links where organization_id = ${orgId}`,
    );
    expect(stored.some((r) => r.token_hash === link.token)).toBe(false);

    const shown = await open(link.token);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(JSON.parse(shown.body)).toMatchObject({
      companyName: 'Links Co',
      jobTitle: 'Field Sales Executive',
    });

    const done = await submit(link.token, { ...answer, when: 'now' });
    expect(done.statusCode, done.body).toBe(201);
    const rows = await superSql<{ consent_source: string; consent_at: string | null; status: string; source: string }>(sql`
      select c.consent_source, c.consent_at, r.status, r.source
      from candidates c join call_requests r on r.candidate_id = c.id
      where c.organization_id = ${orgId} and c.phone = ${answer.phone}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ consent_source: 'candidate', status: 'queued', source: 'link' });
    expect(rows[0]!.consent_at).not.toBeNull();

    const again = await submit(link.token, { ...answer, phone: '9000022222', when: 'now' });
    expect(again.statusCode).toBe(404);
    expect((await open(link.token)).statusCode).toBe(404);
  });

  it('a chosen time becomes not_before on a scheduled request', async () => {
    const link = await mintLink({ fullName: 'Prefill Name' });
    expect(JSON.parse((await open(link.token)).body).fullName).toBe('Prefill Name');
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const done = await submit(link.token, { ...answer, phone: '9000033333', when });
    expect(done.statusCode, done.body).toBe(201);
    const rows = await superSql<{ status: string; not_before: string }>(sql`
      select r.status, r.not_before from call_requests r
      join candidates c on c.id = r.candidate_id
      where c.organization_id = ${orgId} and c.phone = '9000033333'`);
    expect(rows[0]!.status).toBe('scheduled');
    expect(new Date(rows[0]!.not_before).toISOString()).toBe(when);
  });

  it('expired link is 404', async () => {
    const link = await mintLink();
    await superSql(sql`
      update candidate_links set expires_at = now() - interval '1 minute'
      where organization_id = ${orgId} and used_at is null`);
    expect((await open(link.token)).statusCode).toBe(404);
    expect((await submit(link.token, { ...answer, when: 'now' })).statusCode).toBe(404);
  });

  it('missing consent is 422 and leaves the link usable', async () => {
    const link = await mintLink();
    const res = await submit(link.token, { ...answer, phone: '9000044444', consent: false, when: 'now' });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('consent_required');
    const ok = await submit(link.token, { ...answer, phone: '9000044444', when: 'now' });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('unbound link: a phone already on the job is a 409 and nothing changes', async () => {
    const existing = await api.request({
      method: 'POST',
      url: `/v1/jobs/${jobId}/candidates`,
      headers: { authorization: `Bearer ${key}` },
      payload: { fullName: 'Existing Person', phone: '9000055555', consent: true },
    });
    expect(existing.statusCode, existing.body).toBe(201);
    const link = await mintLink();
    const res = await submit(link.token, { ...answer, fullName: 'Hijack', phone: '9000055555', when: 'now' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('link_phone_conflict');
    const [c] = await candidateOf('9000055555');
    expect(c!.full_name).toBe('Existing Person');
    expect(c!.consent_source).toBe('customer');
    expect(await requestsFor(c!.id)).toHaveLength(0);
    // The claim was released: the same link still works with another number.
    expect((await submit(link.token, { ...answer, phone: '9000055556', when: 'now' })).statusCode).toBe(201);
  });

  it('unbound link: a retry after a failed call request reuses the candidate it created', async () => {
    const link = await mintLink();
    const phone = '9000012345';
    // calls_per_day 0: the call request after candidate creation is refused.
    await superSql(sql`
      insert into org_call_limits (organization_id, calls_per_day) values (${orgId}, 0)
      on conflict (organization_id) do update set calls_per_day = 0`);
    try {
      const first = await submit(link.token, { ...answer, phone, when: 'now' });
      expect(first.statusCode, first.body).toBe(429);
    } finally {
      await superSql(sql`update org_call_limits set calls_per_day = 50 where organization_id = ${orgId}`);
    }
    const [created] = await candidateOf(phone);
    expect(created).toBeTruthy();

    const retry = await submit(link.token, { ...answer, phone, when: 'now' });
    expect(retry.statusCode, retry.body).toBe(201);
    const all = await candidateOf(phone);
    expect(all.map((c) => c.id)).toEqual([created!.id]);
    expect(await requestsFor(created!.id)).toHaveLength(1);
  });

  it('bound link: updates only its candidate (phone, consent; name only if empty)', async () => {
    const mk = async (fullName: string, phone: string) => {
      const r = await api.request({
        method: 'POST',
        url: `/v1/jobs/${jobId}/candidates`,
        headers: { authorization: `Bearer ${key}` },
        payload: { fullName, phone, consent: true },
      });
      return (JSON.parse(r.body) as { id: string }).id;
    };
    const mine = await mk('Kept Name', '9000066666');
    const other = await mk('Bystander', '9000066667');
    const link = await mintLink({ candidateId: mine });
    const res = await submit(link.token, { ...answer, fullName: 'Typed Name', phone: '9000066668', when: 'now' });
    expect(res.statusCode, res.body).toBe(201);
    const [c] = await candidateOf('9000066668');
    expect(c).toMatchObject({ id: mine, full_name: 'Kept Name', consent_source: 'candidate' });
    expect((await candidateOf('9000066667'))[0]).toMatchObject({ id: other, full_name: 'Bystander', consent_source: 'customer' });
    expect(await requestsFor(mine)).toHaveLength(1);
    // Typing the bystander's number on a bound link is refused too.
    const link2 = await mintLink({ candidateId: mine });
    const clash = await submit(link2.token, { ...answer, phone: '9000066667', when: 'now' });
    expect(clash.statusCode).toBe(409);
    expect(JSON.parse(clash.body).code).toBe('link_phone_conflict');
  });

  it('creator no longer an active member: same 404 as an invalid link', async () => {
    const link = await mintLink();
    await superSql(sql`
      update organization_memberships set status = 'suspended' where organization_id = ${orgId}`);
    try {
      expect((await open(link.token)).statusCode).toBe(404);
      expect((await submit(link.token, { ...answer, phone: '9000077777', when: 'now' })).statusCode).toBe(404);
    } finally {
      await superSql(sql`
        update organization_memberships set status = 'active' where organization_id = ${orgId}`);
    }
    expect(await candidateOf('9000077777')).toHaveLength(0);
  });

  it('a past or far-future time is 422', async () => {
    const link = await mintLink();
    const past = new Date(Date.now() - 60_000).toISOString();
    const far = new Date(Date.now() + 40 * 86_400_000).toISOString();
    expect((await submit(link.token, { ...answer, phone: '9000088888', when: past })).statusCode).toBe(422);
    expect((await submit(link.token, { ...answer, phone: '9000088888', when: far })).statusCode).toBe(422);
    expect((await submit(link.token, { ...answer, phone: '9000088888', when: 'now' })).statusCode).toBe(201);
  });

  it('two simultaneous submits: one succeeds, one is 404', async () => {
    const link = await mintLink();
    const codes = (
      await Promise.all([
        submit(link.token, { ...answer, phone: '9000099991', when: 'now' }),
        submit(link.token, { ...answer, phone: '9000099992', when: 'now' }),
      ])
    ).map((r) => r.statusCode);
    expect(codes.sort()).toEqual([201, 404]);
  });

  it('public routes allow 10 requests a minute per IP', async () => {
    const bogus = 'a'.repeat(32);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await open(bogus, '10.9.9.9')).statusCode);
    expect(codes).toContain(429);
  });
});
