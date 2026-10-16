/**
 * Acme Hiring against a real HR Voice stack (started by `pnpm test:clients`):
 * API, worker, apps/voice test line, local Postgres. The checks run in order
 * and share one setup; every call is a test call on the fake line except
 * check 7, which is refused before anything could dial.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHrvoiceClient, type HrvoiceClient } from '../src/hrvoice.ts';
import { createAcme, type Acme, type AcmeApplicant, type AcmeJob } from '../src/server.ts';

const API = process.env['HRVOICE_API_URL'] ?? 'http://localhost:3001';
const ACME_PORT = Number(process.env['ACME_PORT'] ?? 4100);
const WEBHOOK_URL = `http://localhost:${ACME_PORT}/hrvoice/webhook`;
const ADMIN_EMAIL = process.env['CLIENTS_ADMIN_EMAIL'] ?? 'clients-admin@example.test';
const DB = process.env['CLIENTS_TEST_DB'] ?? 'platform_clients_test';
const PASSWORD = 'correct-horse-battery-staple';
const ALL_SCOPES = ['jobs', 'candidates', 'calls', 'results', 'webhooks', 'usage'];
const QUESTIONS = [
  'What is your notice period?',
  'What is your current and expected CTC?',
  'When can you join?',
];
const CALL_WAIT_MS = 180_000;

/** Read-only checks against the local test database (never anything remote). */
function psql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', 'platform-postgres', 'psql', '-U', 'postgres', '-d', DB, '-tAc', query],
    { encoding: 'utf8' },
  ).trim();
}

async function http(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: 'http://localhost:3000',
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => c.includes('session_token'))
    .join('; ');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie };
}

interface Org {
  cookie: string;
  orgId: string;
  mintKey(mode: 'test' | 'live', scopes?: string[]): Promise<{ id: string; key: string }>;
}

async function signUp(email: string): Promise<string> {
  const r = await http('POST', '/api/auth/sign-up/email', { body: { email, password: PASSWORD, name: 'Acme Admin' } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.cookie;
}

/** An org admin with a published hiring agent, through the dashboard routes. */
async function setupOrg(label: string): Promise<Org> {
  const cookie = await signUp(`${label}-${randomUUID().slice(0, 8)}@example.test`);
  const org = await http('POST', '/organizations', { cookie, body: { name: `${label} Hiring` } });
  expect([200, 201], JSON.stringify(org.body)).toContain(org.status);
  const agent = await http('POST', '/agents', {
    cookie,
    body: { name: `${label} Screener`, purpose: 'Screen applicants', agentType: 'hiring' },
  });
  expect(agent.status, JSON.stringify(agent.body)).toBe(201);
  const pub = await http('POST', `/agents/${agent.body.id}/versions/${agent.body.versionId}/publish`, { cookie, body: {} });
  expect([200, 201], JSON.stringify(pub.body)).toContain(pub.status);
  return {
    cookie,
    orgId: org.body.id,
    async mintKey(mode, scopes = ALL_SCOPES) {
      const k = await http('POST', '/organization/api-keys', { cookie, body: { name: `Acme ${mode}`, mode, scopes } });
      expect(k.status, JSON.stringify(k.body)).toBe(201);
      return { id: k.body.id, key: k.body.key };
    },
  };
}

async function until<T>(what: string, fn: () => T | undefined | Promise<T | undefined>, ms = CALL_WAIT_MS): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms / 1000}s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const SCORE_KEYS = /fitpercent|fit_percent|score|recommend/i;

/** Every key anywhere in a JSON value, recursively. */
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

let org: Org;
let testKey: string;
let hv: HrvoiceClient;
let acme: Acme;
let job: AcmeJob;
let first: AcmeApplicant;
let second: AcmeApplicant;

const completedFor = (callId: string) =>
  acme.events.find((e) => e.callId === callId && e.type === 'call.completed');

describe('Acme Hiring on HR Voice /v1', () => {
  beforeAll(async () => {
    // The platform admin sets limits in check 7; first sign-up wins the email.
    await signUp(ADMIN_EMAIL);
  });

  afterAll(async () => {
    await acme?.stop();
  });

  it('1. org admin, published hiring agent and an all-scopes test key', async () => {
    org = await setupOrg('acme');
    ({ key: testKey } = await org.mintKey('test'));
    expect(testKey).toMatch(/^hrv_test_[0-9A-Za-z]{32}$/);
    hv = createHrvoiceClient(API, testKey);
    expect((await hv.request('GET', '/v1/ping')).status).toBe(200);
  });

  it('2. Acme creates a job, registers its webhook and adds 2 consented applicants', async () => {
    acme = createAcme(hv);
    await acme.start(ACME_PORT);
    job = await acme.createJob('Warehouse Supervisor', QUESTIONS);
    await acme.registerWebhook(WEBHOOK_URL);
    first = await acme.addApplicant(job.id, 'Asha Rao', '9000000101');
    second = await acme.addApplicant(job.id, 'Vikram Shah', '9000000102');

    const list = await hv.request('GET', `/v1/jobs/${job.hrvoiceJobId}/candidates`);
    expect(list.status).toBe(200);
    expect(list.body.candidates.map((c: { externalId: string }) => c.externalId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    // Consent is required through /v1.
    const noConsent = await hv.request('POST', `/v1/jobs/${job.hrvoiceJobId}/candidates`, { fullName: 'X', phone: '9000000199' });
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.code).toBe('consent_required');
  });

  it('3. calls complete and arrive signed on Acme, with answers and no score', async () => {
    const calls = [await acme.screen(first.id), await acme.screen(second.id)];
    for (const c of calls) expect(c.status, JSON.stringify(c.body)).toBe(202);

    for (const a of [first, second]) {
      await until(`call.completed for ${a.name}`, () => a.resultEvent === 'call.completed' || undefined);
      const r = a.result as { answers: unknown[]; status: string };
      expect(r.status).toBe('ended');
      expect(r.answers.length).toBeGreaterThan(0);
    }
    // Acme stores only events whose HRVoice-Signature verified.
    expect(acme.rejected).toBe(0);
    for (const c of calls) expect(completedFor(c.body.id)?.isTest).toBe(true);

    const stored = JSON.stringify({ applicants: [...acme.applicants.values()], events: acme.events });
    expect(stored).not.toMatch(/fitPercent/i);
    expect(keysOf(JSON.parse(stored)).filter((k) => SCORE_KEYS.test(k))).toEqual([]);

    // A forged event is refused.
    const forged = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'hrvoice-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
      body: '{}',
    });
    expect(forged.status).toBe(400);

    // The pages render what Acme stored.
    const html = await (await fetch(`http://localhost:${ACME_PORT}/applicants/${first.id}`)).text();
    expect(html).toContain('call.completed');
  });

  it('4. /v1/usage shows 0 completed screens for test calls', async () => {
    const u = await hv.request('GET', '/v1/usage');
    expect(u.status).toBe(200);
    expect(u.body.completedScreens).toBe(0);
    expect(u.body.callsPlaced).toBe(0);
  });

  it('5. the same Idempotency-Key does not create a second call request', async () => {
    const third = await acme.addApplicant(job.id, 'Meera Iyer', '9000000103');
    const key = `acme-${randomUUID()}`;
    const a = await acme.screen(third.id, key);
    const b = await acme.screen(third.id, key);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.body.id).toBe(a.body.id);
    expect(psql(`select count(*) from call_requests where candidate_id = '${third.hrvoiceCandidateId}'`)).toBe('1');
    // Let it finish so it does not hold a test-line slot for the next checks.
    await until('the idempotent call to finish', () => completedFor(a.body.id) ?? acme.events.find((e) => e.callId === a.body.id));
  });

  it('6. a revoked key gets 401 on its next request', async () => {
    const k = await org.mintKey('test');
    const c = createHrvoiceClient(API, k.key);
    expect((await c.request('GET', `/v1/jobs/${job.hrvoiceJobId}`)).status).toBe(200);
    const del = await http('DELETE', `/organization/api-keys/${k.id}`, { cookie: org.cookie });
    expect(del.status).toBe(204);
    const after = await c.request('GET', `/v1/jobs/${job.hrvoiceJobId}`);
    expect(after.status).toBe(401);
  });

  it('7. a live key over calls_per_day=0 gets 429 call_limit_reached and nothing dials', async () => {
    const admin = await http('POST', '/api/auth/sign-in/email', { body: { email: ADMIN_EMAIL, password: PASSWORD } });
    const set = await http('PUT', `/admin/costs/orgs/${org.orgId}/limits`, {
      cookie: admin.cookie,
      body: { callsPerDay: 0, maxConcurrent: 3, monthlyCap: null, pricePerScreenInr: null },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const live = createHrvoiceClient(API, (await org.mintKey('live')).key);
    const j = await live.request('POST', '/v1/jobs', { title: 'Live role', mustAskQuestions: QUESTIONS });
    expect(j.status).toBe(201);
    const c = await live.request('POST', `/v1/jobs/${j.body.id}/candidates`, { fullName: 'Live Person', phone: '9000000201', consent: true });
    expect(c.status).toBe(201);
    const call = await live.request('POST', `/v1/jobs/${j.body.id}/candidates/${c.body.id}/calls`);
    expect(call.status, JSON.stringify(call.body)).toBe(429);
    expect(call.body.code).toBe('call_limit_reached');
    expect(Date.parse(call.body.details.resetsAt)).toBeGreaterThan(Date.now());
    // Refused at request time: no call request row and no live voice session was ever created.
    expect(psql(`select count(*) from call_requests where candidate_id = '${c.body.id}'`)).toBe('0');
    expect(psql(`select count(*) from voice_sessions where organization_id = '${org.orgId}' and not is_test`)).toBe('0');
  });

  it('8. a delivery missed while Acme is down is retried and arrives after restart', async () => {
    const fourth = await acme.addApplicant(job.id, 'Ravi Kumar', '9000000104');
    await acme.stop();
    const stoppedAt = Date.now();
    const call = await acme.screen(fourth.id);
    expect(call.status).toBe(202);

    // The first attempt fails against the stopped listener (attempts >= 1, still pending).
    const delivery = await until('a failed first delivery attempt', async () => {
      const d = await hv.request('GET', '/v1/webhook-deliveries?status=pending');
      return (d.body.deliveries as { id: string; attempts: number; lastError: string | null }[]).find(
        (x) => x.attempts >= 1 && x.lastError,
      );
    });
    expect(delivery.attempts).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, Math.max(0, 10_000 - (Date.now() - stoppedAt))));
    await acme.start(ACME_PORT);

    // The check is the retry, so either outcome event counts.
    const evt = await until('the retried call event', () => acme.events.find((e) => e.callId === call.body.id), 240_000);
    expect(evt.externalId).toBe(fourth.id);
    expect(fourth.resultEvent).toBe(evt.type);
    const delivered = await hv.request('GET', '/v1/webhook-deliveries?status=delivered');
    const d = (delivered.body.deliveries as { id: string; attempts: number }[]).find((x) => x.id === delivery.id);
    expect(d?.attempts).toBeGreaterThanOrEqual(2);
  }, 480_000);

  it("9. a second org's key gets 404 on the first org's job and call", async () => {
    const other = await setupOrg('globex');
    const c = createHrvoiceClient(API, (await other.mintKey('test')).key);
    expect((await c.request('GET', `/v1/jobs/${job.hrvoiceJobId}`)).status).toBe(404);
    expect((await c.request('GET', `/v1/calls/${first.callIds[0]}`)).status).toBe(404);
    expect((await c.request('GET', `/v1/jobs/${job.hrvoiceJobId}/candidates/${first.hrvoiceCandidateId}/results`)).status).toBe(404);
  });

  it('10. "ask the candidate" link: the public form queues a link call that completes', async () => {
    const url = await acme.askCandidateLink(job.id);
    const token = url.split('/c/')[1]!;
    const view = await http('GET', `/public/candidate-links/${token}`);
    expect(view.status).toBe(200);

    const before = acme.events.length;
    const submit = await http('POST', `/public/candidate-links/${token}`, {
      body: { fullName: 'Nisha Verma', phone: '9000000105', countryCode: '+91', when: 'now', consent: true },
    });
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);

    const evt = await until('call.completed for the link candidate', () =>
      acme.events.slice(before).find((e) => e.type === 'call.completed'),
    );
    expect(evt.externalId).toBeNull();
    expect(psql(`select source from call_requests where id = '${evt.callId}'`)).toBe('link');
    expect((evt.result as { answers: unknown[] }).answers.length).toBeGreaterThan(0);
  });
});
