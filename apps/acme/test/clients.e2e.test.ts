/**
 * Acme Hiring against a real HR Voice stack (started by `pnpm test:clients`):
 * API, worker, apps/voice test line, local Postgres. Acme talks to HR Voice
 * only through @hrvoice/sdk; check 11 drives apps/mcp over stdio and check 12
 * runs the Zapier app (integrations/zapier) through Zapier's own local app tester. The checks
 * run in order and share one setup; every call is a test call on the fake line
 * except check 7, which is refused before anything could dial.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { HRVoice, HRVoiceError } from '@hrvoice/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
let hv: HRVoice;
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
    hv = new HRVoice({ apiKey: testKey, baseUrl: API });
    expect((await hv.ping()).apiKey?.mode).toBe('test');
  });

  it('2. Acme creates a job, registers its webhook and adds 2 consented applicants', async () => {
    acme = createAcme(hv);
    await acme.start(ACME_PORT);
    job = await acme.createJob('Warehouse Supervisor', QUESTIONS);
    await acme.registerWebhook(WEBHOOK_URL);
    first = await acme.addApplicant(job.id, 'Asha Rao', '9000000101');
    second = await acme.addApplicant(job.id, 'Vikram Shah', '9000000102');

    const list = await hv.listCandidates(job.hrvoiceJobId);
    expect(list.candidates.map((c) => c.externalId).sort()).toEqual([first.id, second.id].sort());
    // Consent is required through /v1.
    const noConsent = { fullName: 'X', phone: '9000000199' } as unknown as Parameters<HRVoice['addCandidate']>[1];
    await expect(hv.addCandidate(job.hrvoiceJobId, noConsent)).rejects.toMatchObject({
      status: 422,
      code: 'consent_required',
    });
  });

  it('3. calls complete and arrive signed on Acme, with answers and no score', async () => {
    const calls = [await acme.screen(first.id), await acme.screen(second.id)];

    for (const a of [first, second]) {
      await until(`call.completed for ${a.name}`, () => a.resultEvent === 'call.completed' || undefined);
      const r = a.result as { answers: unknown[]; status: string };
      expect(r.status).toBe('ended');
      expect(r.answers.length).toBeGreaterThan(0);
    }
    // Acme stores only events whose HRVoice-Signature verified.
    expect(acme.rejected).toBe(0);
    for (const c of calls) expect(completedFor(c.id)?.isTest).toBe(true);

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
    const u = await hv.getUsage();
    expect(u.completedScreens).toBe(0);
    expect(u.callsPlaced).toBe(0);
  });

  it('5. the same Idempotency-Key does not create a second call request', async () => {
    const third = await acme.addApplicant(job.id, 'Meera Iyer', '9000000103');
    const key = `acme-${randomUUID()}`;
    const a = await acme.screen(third.id, key);
    const b = await acme.screen(third.id, key);
    expect(b.id).toBe(a.id);
    expect(psql(`select count(*) from call_requests where candidate_id = '${third.hrvoiceCandidateId}'`)).toBe('1');
    // Let it finish so it does not hold a test-line slot for the next checks.
    await until('the idempotent call to finish', () => completedFor(a.id) ?? acme.events.find((e) => e.callId === a.id));
  });

  it('6. a revoked key gets 401 on its next request', async () => {
    const k = await org.mintKey('test');
    const c = new HRVoice({ apiKey: k.key, baseUrl: API });
    expect((await c.getJob(job.hrvoiceJobId)).id).toBe(job.hrvoiceJobId);
    const del = await http('DELETE', `/organization/api-keys/${k.id}`, { cookie: org.cookie });
    expect(del.status).toBe(204);
    await expect(c.getJob(job.hrvoiceJobId)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('7. a live key over calls_per_day=0 gets 429 call_limit_reached and nothing dials', async () => {
    const admin = await http('POST', '/api/auth/sign-in/email', { body: { email: ADMIN_EMAIL, password: PASSWORD } });
    const set = await http('PUT', `/admin/costs/orgs/${org.orgId}/limits`, {
      cookie: admin.cookie,
      body: { callsPerDay: 0, maxConcurrent: 3, monthlyCap: null, pricePerScreenInr: null },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const live = new HRVoice({ apiKey: (await org.mintKey('live')).key, baseUrl: API });
    const j = await live.createJob({ title: 'Live role', mustAskQuestions: QUESTIONS });
    const c = await live.addCandidate(j.id, { fullName: 'Live Person', phone: '9000000201', consent: true });
    expect(c.created).toBe(true);
    // The SDK does not sit out a limit that resets hours from now: it throws at once.
    const err = (await live.startCall(j.id, c.id).catch((e: unknown) => e)) as HRVoiceError;
    expect(err).toBeInstanceOf(HRVoiceError);
    expect(err).toMatchObject({ status: 429, code: 'call_limit_reached' });
    expect(err.resetsAt!.getTime()).toBeGreaterThan(Date.now());
    // Refused at request time: no call request row and no live voice session was ever created.
    expect(psql(`select count(*) from call_requests where candidate_id = '${c.id}'`)).toBe('0');
    expect(psql(`select count(*) from voice_sessions where organization_id = '${org.orgId}' and not is_test`)).toBe('0');
  });

  it('8. a delivery missed while Acme is down is retried and arrives after restart', async () => {
    const fourth = await acme.addApplicant(job.id, 'Ravi Kumar', '9000000104');
    await acme.stop();
    const stoppedAt = Date.now();
    const call = await acme.screen(fourth.id);

    // The first attempt fails against the stopped listener (attempts >= 1, still pending).
    const delivery = await until('a failed first delivery attempt', async () => {
      const pending = await hv.listWebhookDeliveries({ status: 'pending' });
      return pending.find((x) => x.attempts >= 1 && x.lastError);
    });
    expect(delivery.attempts).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, Math.max(0, 10_000 - (Date.now() - stoppedAt))));
    await acme.start(ACME_PORT);

    // The check is the retry, so either outcome event counts.
    const evt = await until('the retried call event', () => acme.events.find((e) => e.callId === call.id), 240_000);
    expect(evt.externalId).toBe(fourth.id);
    expect(fourth.resultEvent).toBe(evt.type);
    const delivered = await hv.listWebhookDeliveries({ status: 'delivered' });
    const d = delivered.find((x) => x.id === delivery.id);
    expect(d?.attempts).toBeGreaterThanOrEqual(2);
  }, 480_000);

  it("9. a second org's key gets 404 on the first org's job and call", async () => {
    const other = await setupOrg('globex');
    const c = new HRVoice({ apiKey: (await other.mintKey('test')).key, baseUrl: API });
    const notFound = { status: 404, code: 'not_found' };
    await expect(c.getJob(job.hrvoiceJobId)).rejects.toMatchObject(notFound);
    await expect(c.getCall(first.callIds[0]!)).rejects.toMatchObject(notFound);
    await expect(c.getResults(job.hrvoiceJobId, first.hrvoiceCandidateId)).rejects.toMatchObject(notFound);
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

  it('11. an AI assistant screens a candidate through the MCP server (stdio)', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(import.meta.dirname, '../../mcp/src/index.ts')],
      env: { PATH: process.env['PATH'] ?? '', HRVOICE_API_KEY: testKey, HRVOICE_API_URL: API },
      stderr: 'inherit',
    });
    const mcp = new Client({ name: 'acme-assistant', version: '1.0.0' });
    await mcp.connect(transport);
    try {
      const tool = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
        const r = await mcp.callTool({ name, arguments: args });
        const text = (r.content as { type: string; text: string }[])[0]!.text;
        expect(r.isError, `${name}: ${text}`).toBeFalsy();
        expect(text).not.toMatch(/fitPercent|score|recommend/i);
        return JSON.parse(text) as T;
      };
      const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(
        ['add_candidates', 'create_job', 'get_call', 'get_results', 'get_usage', 'list_candidates', 'list_jobs', 'start_call'],
      );

      const j = await tool<{ id: string }>('create_job', { title: 'Java Developer (MCP)', mustAskQuestions: QUESTIONS });
      const [cand] = await tool<{ id: string; created: boolean }[]>('add_candidates', {
        jobId: j.id,
        consent: true,
        candidates: [{ fullName: 'Priya Nair', phone: '9000000106', externalId: `mcp-${randomUUID()}` }],
      });
      expect(cand!.created).toBe(true);
      const call = await tool<{ id: string }>('start_call', { jobId: j.id, candidateId: cand!.id });

      const result = await until('the MCP call to end', async () => {
        const c = await tool<{ status: string; result: { status: string } | null }>('get_call', { callId: call.id });
        if (c.status === 'failed' || c.status === 'skipped') throw new Error(`call ${c.status}`);
        if (c.result?.status !== 'ended') return undefined;
        return tool<{ status: string; answers: unknown[]; summary: string | null; transcript?: unknown }>(
          'get_results', { jobId: j.id, candidateId: cand!.id },
        );
      });
      expect(result.status).toBe('ended');
      expect(result.answers.length).toBeGreaterThan(0);
      expect(result).not.toHaveProperty('transcript');

      // A refused request comes back as a readable tool error, not a crash.
      const bad = await mcp.callTool({ name: 'get_call', arguments: { callId: randomUUID() } });
      expect(bad.isError).toBe(true);
      expect((bad.content as { text: string }[])[0]!.text).toContain('not_found');
    } finally {
      await mcp.close();
    }
  });
  it('12. the Zapier app: job, consented candidate, search, signed call hook, sample data and a ticket', async () => {
    const zapRequire = createRequire(resolve(import.meta.dirname, '../../../integrations/zapier/index.js'));
    process.env['HRVOICE_API_URL'] = API;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const App: any = zapRequire('./index.js');
    const appTester = zapRequire('zapier-platform-core').createAppTester(App) as (
      fn: unknown, bundle: Record<string, unknown>) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { key } = await org.mintKey('test', [...ALL_SCOPES, 'support']);
    const authData = { apiKey: key };
    const zap = (fn: unknown, bundle: Record<string, unknown> = {}) => appTester(fn, { authData, ...bundle });

    // What Zapier's hook URL would receive: the raw signed request.
    const raw: { headers: Record<string, string>; content: string }[] = [];
    const hooks = createServer((req, res) => {
      let content = '';
      req.on('data', (c: Buffer) => (content += c.toString()));
      req.on('end', () => {
        raw.push({ headers: { 'Http-Hrvoice-Signature': String(req.headers['hrvoice-signature']) }, content });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => hooks.listen(0, '127.0.0.1', r));
    const targetUrl = `http://localhost:${(hooks.address() as AddressInfo).port}/hook`;
    const subs: Record<string, { id: string; secret: string }> = {};
    try {
      expect((await zap(App.authentication.test)).apiKey.mode).toBe('test');
      const j = await zap(App.creates.create_job.operation.perform, { inputData: { title: 'Picker (Zapier)', mustAskQuestions: QUESTIONS } });
      await expect(zap(App.creates.add_candidate.operation.perform, {
        inputData: { jobId: j.id, fullName: 'No Consent', phone: '9000000198', consent: 'false' },
      })).rejects.toThrow(/agree/);
      const externalId = `zap-${randomUUID()}`;
      const cand = await zap(App.creates.add_candidate.operation.perform, {
        inputData: { jobId: j.id, fullName: 'Kavya Menon', phone: '9000000107', externalId, consent: 'true' },
      });
      expect(cand.created).toBe(true);
      const found = await zap(App.searches.find_candidate.operation.perform, { inputData: { jobId: j.id, externalId } });
      expect(found.map((c: { id: string }) => c.id)).toEqual([cand.id]);
      const jobs = await zap(App.triggers.job.operation.perform);
      expect(jobs.map((x: { id: string }) => x.id)).toContain(j.id);

      for (const t of ['call_completed', 'call_failed']) {
        subs[t] = await zap(App.triggers[t].operation.performSubscribe, { targetUrl });
      }
      const call = await zap(App.creates.start_call.operation.perform, { inputData: { jobId: j.id, candidateId: cand.id } });
      expect(call.status).toMatch(/queued|placed|placing/);

      const hit = await until('the signed call event at the Zapier hook', () =>
        raw.find((r) => JSON.parse(r.content).data?.callId === call.id));
      const type = JSON.parse(hit.content).type as string;
      const trigger = type === 'call.completed' ? 'call_completed' : 'call_failed';
      const [event] = await zap(App.triggers[trigger].operation.perform, { subscribeData: subs[trigger], rawRequest: hit });
      expect(event.data).toMatchObject({ callId: call.id, candidateId: cand.id, externalId, isTest: true });
      // A request not signed by HRVoice is dropped.
      expect(await zap(App.triggers[trigger].operation.perform, {
        subscribeData: subs[trigger], rawRequest: { ...hit, content: hit.content.replace(call.id, randomUUID()) },
      })).toEqual([]);
      // Sample data for the Zap editor comes from /v1/events, in the same shape.
      const samples = await zap(App.triggers[trigger].operation.performList);
      expect(samples.map((e: { data: { callId: string } }) => e.data.callId)).toContain(call.id);

      for (const out of [event, samples, cand, found]) {
        expect(JSON.stringify(out)).not.toMatch(/fitPercent/i);
        expect(keysOf(out).filter((k) => SCORE_KEYS.test(k))).toEqual([]);
      }

      const ticket = await zap(App.creates.raise_ticket.operation.perform, {
        inputData: { subject: 'Zapier check', body: `Call ${call.id} from the Zapier app.`, jobId: j.id },
      });
      expect(ticket.ref).toBeTruthy();
      expect(psql(`select channel from support_tickets where id = '${ticket.id}'`)).toBe('api');
    } finally {
      for (const [t, sub] of Object.entries(subs)) {
        await zap(App.triggers[t].operation.performUnsubscribe, { subscribeData: sub });
      }
      await new Promise((r) => hooks.close(r));
    }
    const left = await hv.listWebhookEndpoints();
    expect(left.map((e) => e.url)).not.toContain(targetUrl);
  });
});
