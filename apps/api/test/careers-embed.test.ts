/**
 * Careers-page embed: publishable keys restricted to one job, exact allowed origins, consent,
 * per-IP and per-key limits, revocation, the calling window and tenant isolation.
 * The API clock is fixed at 22:00 IST, so every live application is told "after 9 am".
 */

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

const SITE = 'https://careers.acme.test';
const NOW = '2026-10-20T22:00:00+05:30';
const NINE_AM = '2026-10-21T03:30:00.000Z';

let api: ApiHarness;
let owner: TestActor;
let orgId: string;
let secretKey: string;
let jobId: string;
let otherJobId: string;
let pub: string;
let pubId: string;

async function superSql<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    return await withoutTenantContext(db.db, (tx) => tx.execute<T>(query));
  } finally {
    await db.close();
  }
}

let ip = 0;
const nextIp = () => `10.9.${Math.floor(++ip / 250)}.${ip % 250}`;

const describeForm = (key: string, origin: string | null = SITE) =>
  api.request({
    method: 'GET',
    url: `/public/embed/${key}`,
    headers: origin ? { origin } : {},
    remoteAddress: nextIp(),
  });
const apply = (key: string, payload: object, opts: { origin?: string | null; ip?: string } = {}) =>
  api.request({
    method: 'POST',
    url: `/public/embed/${key}/applications`,
    headers: opts.origin === null ? {} : { origin: opts.origin ?? SITE },
    payload,
    remoteAddress: opts.ip ?? nextIp(),
  });
const preflight = (key: string, origin: string) =>
  api.request({
    method: 'OPTIONS',
    url: `/public/embed/${key}/applications`,
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    remoteAddress: nextIp(),
  });
const panel = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', job: string, cookie: string, payload?: object) =>
  api.request({ method, url: `/jobs/${job}/careers-page`, cookie, ...(payload ? { payload } : {}) });

const priya = { fullName: 'Priya Sharma', phone: '+91 90000 00101', email: 'priya@example.test', consent: true };

const candidatesOn = (job: string) =>
  superSql<{ id: string; phone: string; consent_source: string | null; consent_at: string | null }>(sql`
    select id, phone, consent_source, consent_at from candidates where job_id = ${job}`);
const requestsOn = (job: string) =>
  superSql<{ source: string; status: string; created_by_key_id: string | null }>(sql`
    select source, status, created_by_key_id from call_requests where job_id = ${job}`);

async function newJob(title: string, key = secretKey) {
  const res = await api.request({
    method: 'POST',
    url: '/v1/jobs',
    headers: { authorization: `Bearer ${key}` },
    payload: { title },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function makeKey(job: string, origins: string[] = [SITE]) {
  const res = await panel('POST', job, owner.cookie, { allowedOrigins: origins });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { key: { id: string; publicKey: string } }).key;
}

beforeAll(async () => {
  const previous = process.env['CALLING_HOURS_NOW'];
  process.env['CALLING_HOURS_NOW'] = NOW;
  try {
    api = await startApi();
  } finally {
    if (previous === undefined) delete process.env['CALLING_HOURS_NOW'];
    else process.env['CALLING_HOURS_NOW'] = previous;
  }
  owner = await registerUser(api, 'embed-a');
  orgId = await createOrganization(api, owner, 'Acme Embed Co');
  const agent = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screener', purpose: 'Screen', description: 'embed', agentType: 'hiring' },
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
  secretKey = (JSON.parse(minted.body) as { key: string }).key;
  jobId = await newJob('Delivery Associate');
  otherJobId = await newJob('Store Manager');
  await superSql(sql`
    insert into org_call_limits (organization_id, calls_per_day) values (${orgId}, 1000)
    on conflict (organization_id) do update set calls_per_day = 1000`);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('careers-page form: the key', () => {
  it('an admin makes a publishable key for one job; websites are normalised', async () => {
    const res = await panel('POST', jobId, owner.cookie, {
      allowedOrigins: ['careers.acme.test/jobs/', 'HTTPS://careers.acme.test', 'http://localhost:4100'],
    });
    expect(res.statusCode, res.body).toBe(201);
    const { key } = JSON.parse(res.body) as {
      key: { id: string; publicKey: string; mode: string; allowedOrigins: string[] };
    };
    expect(key.publicKey).toMatch(/^hrv_pub_[A-Za-z0-9]{32}$/);
    expect(key.mode).toBe('live');
    expect(key.allowedOrigins).toEqual([SITE, 'http://localhost:4100']);
    pub = key.publicKey;
    pubId = key.id;

    const got = JSON.parse((await panel('GET', jobId, owner.cookie)).body) as { key: { publicKey: string } };
    expect(got.key.publicKey).toBe(pub);
    // Not one of the company's secret API keys.
    const list = JSON.parse(
      (await api.request({ method: 'GET', url: '/organization/api-keys', cookie: owner.cookie })).body,
    ) as { keys: { id: string }[] };
    expect(list.keys.map((k) => k.id)).not.toContain(pubId);
  });

  it('a bad website address is refused with a plain message', async () => {
    const res = await panel('PATCH', jobId, owner.cookie, { allowedOrigins: ['not a website'] });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('isn’t a website address');
    expect((await panel('PATCH', jobId, owner.cookie, { allowedOrigins: [] })).statusCode).toBe(422);
  });

  it('the key works nowhere but the form routes', async () => {
    for (const url of ['/v1/ping', '/v1/jobs', `/v1/jobs/${otherJobId}/candidates`]) {
      const res = await api.request({ method: 'GET', url, headers: { authorization: `Bearer ${pub}` } });
      expect(res.statusCode, url).toBe(401);
    }
    const post = await api.request({
      method: 'POST',
      url: `/v1/jobs/${otherJobId}/candidates`,
      headers: { authorization: `Bearer ${pub}` },
      payload: { ...priya, phone: '9000000150' },
    });
    expect(post.statusCode).toBe(401);
    expect(await candidatesOn(otherJobId)).toHaveLength(0);
  });
});

describe('careers-page form: origins and CORS', () => {
  it('the allowed website gets the heading and a CORS header; nothing else', async () => {
    const res = await describeForm(pub);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(SITE);
    expect(JSON.parse(res.body)).toEqual({ companyName: 'Acme Embed Co', jobTitle: 'Delivery Associate', open: true });
  });

  it('another website, or no Origin at all, is refused without CORS', async () => {
    for (const origin of ['https://evil.test', 'https://careers.acme.test.evil.test', null]) {
      const res = await describeForm(pub, origin);
      expect(res.statusCode, String(origin)).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      const sent = await apply(pub, { ...priya, phone: '9000000151' }, { origin });
      expect(sent.statusCode).toBe(403);
    }
    expect(await candidatesOn(jobId)).toHaveLength(0);
  });

  it('preflight answers only the allowed website', async () => {
    const ok = await preflight(pub, SITE);
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(SITE);
    expect(ok.headers['access-control-allow-methods']).toBe('GET, POST');
    const no = await preflight(pub, 'https://evil.test');
    expect(no.statusCode).toBe(204);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('careers-page form: applying', () => {
  it('consent is required, and nothing is created without it', async () => {
    for (const consent of [false, undefined, 'yes']) {
      const res = await apply(pub, { ...priya, consent });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).code).toBe('consent_required');
      // Errors still carry CORS, so the form can show them.
      expect(res.headers['access-control-allow-origin']).toBe(SITE);
    }
    expect(await candidatesOn(jobId)).toHaveLength(0);
  });

  it('a wrong phone is a field error', async () => {
    const res = await apply(pub, { ...priya, phone: '12345' });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).errors).toEqual([{ field: 'phone', message: 'Enter a 10-digit Indian mobile number.' }]);
  });

  it('applying adds the candidate to this job with their consent and queues an embed call, held to 9 am', async () => {
    const res = await apply(pub, priya);
    expect(res.statusCode, res.body).toBe(201);
    // Only when the call comes: never a score, fit or result.
    expect(JSON.parse(res.body)).toEqual({ callAfter: NINE_AM });
    const [c] = await candidatesOn(jobId);
    expect(c).toMatchObject({ phone: '9000000101', consent_source: 'candidate' });
    expect(c!.consent_at).not.toBeNull();
    expect(await requestsOn(jobId)).toEqual([{ source: 'embed', status: 'queued', created_by_key_id: pubId }]);
    expect(await candidatesOn(otherJobId)).toHaveLength(0);
  });

  it('applying twice with the same number gets the same answer and no second call', async () => {
    const res = await apply(pub, { ...priya, phone: '9000000101' });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ callAfter: NINE_AM });
    expect(await candidatesOn(jobId)).toHaveLength(1);
    expect(await requestsOn(jobId)).toHaveLength(1);
  });

  it('a filled-in honeypot is thanked and ignored', async () => {
    const res = await apply(pub, { ...priya, phone: '9000000102', website: 'http://spam.test' });
    expect(res.statusCode).toBe(201);
    expect(await candidatesOn(jobId)).toHaveLength(1);
  });

  it('a closed job stops taking applications', async () => {
    const job = await newJob('Closed Role');
    const key = await makeKey(job);
    await superSql(sql`update jobs set status = 'closed' where id = ${job}`);
    expect(JSON.parse((await describeForm(key.publicKey)).body).open).toBe(false);
    expect((await apply(key.publicKey, { ...priya, phone: '9000000103' })).statusCode).toBe(404);
    expect(await candidatesOn(job)).toHaveLength(0);
  });

  it('the company’s call limit refuses the application before anyone is created', async () => {
    const job = await newJob('Limited Role');
    const key = await makeKey(job);
    await superSql(sql`update org_call_limits set calls_per_day = 0 where organization_id = ${orgId}`);
    try {
      const res = await apply(key.publicKey, { ...priya, phone: '9000000104' });
      expect(res.statusCode).toBe(429);
    } finally {
      await superSql(sql`update org_call_limits set calls_per_day = 1000 where organization_id = ${orgId}`);
    }
    expect(await candidatesOn(job)).toHaveLength(0);
  });
});

describe('careers-page form: limits and revocation', () => {
  it('per IP: the sixth application in a minute from one address is refused', async () => {
    const job = await newJob('IP Limited');
    const key = await makeKey(job);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await apply(key.publicKey, { ...priya, phone: `900000020${i}` }, { ip: '10.250.0.1' })).statusCode);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('per key: the 21st application in a minute is refused, whatever the address', async () => {
    const job = await newJob('Key Limited');
    const key = await makeKey(job);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      codes.push((await apply(key.publicKey, { ...priya, phone: `90000003${String(i).padStart(2, '0')}` })).statusCode);
    }
    expect(codes.slice(0, 20).every((c) => c === 201)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it('changing the websites takes effect at once', async () => {
    const res = await panel('PATCH', jobId, owner.cookie, { allowedOrigins: ['https://jobs.acme.test'] });
    expect(res.statusCode, res.body).toBe(200);
    expect((await describeForm(pub)).statusCode).toBe(403);
    expect((await describeForm(pub, 'https://jobs.acme.test')).statusCode).toBe(200);
    await panel('PATCH', jobId, owner.cookie, { allowedOrigins: [SITE] });
  });

  it('a new key replaces the old one; a revoked key is refused everywhere', async () => {
    const fresh = await makeKey(jobId);
    expect(fresh.publicKey).not.toBe(pub);
    expect((await describeForm(pub)).statusCode).toBe(404);
    expect((await preflight(pub, SITE)).headers['access-control-allow-origin']).toBeUndefined();

    expect((await panel('DELETE', jobId, owner.cookie)).statusCode).toBe(204);
    expect((await describeForm(fresh.publicKey)).statusCode).toBe(404);
    expect((await apply(fresh.publicKey, { ...priya, phone: '9000000105' })).statusCode).toBe(404);
    expect(JSON.parse((await panel('GET', jobId, owner.cookie)).body)).toEqual({ key: null });
    expect((await panel('DELETE', jobId, owner.cookie)).statusCode).toBe(404);
  });

  it('a creator who is no longer an active member ends the form', async () => {
    const job = await newJob('Creator Gone');
    const key = await makeKey(job);
    await superSql(sql`update organization_memberships set status = 'suspended' where organization_id = ${orgId}`);
    try {
      expect((await describeForm(key.publicKey)).statusCode).toBe(404);
    } finally {
      await superSql(sql`update organization_memberships set status = 'active' where organization_id = ${orgId}`);
    }
  });
});

describe('careers-page form: tenant isolation', () => {
  it('another company can’t read, make, change or revoke this job’s key', async () => {
    const key = await makeKey(jobId);
    const other = await registerUser(api, 'embed-b');
    await createOrganization(api, other, 'Other Co');
    expect(JSON.parse((await panel('GET', jobId, other.cookie)).body)).toEqual({ key: null });
    expect((await panel('POST', jobId, other.cookie, { allowedOrigins: ['https://other.test'] })).statusCode).toBe(404);
    expect((await panel('PATCH', jobId, other.cookie, { allowedOrigins: ['https://other.test'] })).statusCode).toBe(404);
    expect((await panel('DELETE', jobId, other.cookie)).statusCode).toBe(404);
    expect((await describeForm(key.publicKey)).statusCode).toBe(200);
  });

  it('a test job gets a test key, and its applications are test candidates with no hours hold', async () => {
    const minted = await api.request({
      method: 'POST',
      url: '/organization/api-keys',
      cookie: owner.cookie,
      payload: { name: 'Test', mode: 'test', scopes: ['jobs'] },
    });
    const testJob = await newJob('Test Role', (JSON.parse(minted.body) as { key: string }).key);
    const res = await panel('POST', testJob, owner.cookie, { allowedOrigins: [SITE] });
    const key = (JSON.parse(res.body) as { key: { publicKey: string; mode: string } }).key;
    expect(key.mode).toBe('test');
    const sent = await apply(key.publicKey, { ...priya, phone: '9000000106' });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(JSON.parse(sent.body)).toEqual({ callAfter: null });
    const rows = await superSql<{ is_test: boolean }>(sql`select is_test from candidates where job_id = ${testJob}`);
    expect(rows).toEqual([{ is_test: true }]);
  });
});
