/**
 * The Zoho Recruit connector end to end, against the fake Zoho on :4200 (the
 * API was started by `pnpm test:clients` pointing at it): an admin connects
 * (OAuth with PKCE), links a Zoho job to a test HRVoice job with automatic
 * calls on, the sync brings in the applicant and skips the rejected one, the
 * test call on the fake line completes, and the note lands on the Zoho
 * candidate with the answers and no score. Then: a person rejected in Zoho
 * can't be called, and disconnect revokes the token.
 */

import { randomUUID } from 'node:crypto';
import { HRVoice } from '@hrvoice/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startFakeZoho, zohoIst, type FakeApplication, type FakeZoho } from '../src/fake-zoho.ts';

const API = process.env['HRVOICE_API_URL'] ?? 'http://localhost:3001';
const ZOHO_PORT = Number(process.env['FAKE_ZOHO_PORT'] ?? 4200);
const PASSWORD = 'correct-horse-battery-staple';
const QUESTIONS = ['What is your notice period?', 'When can you join?'];
const SCORE_KEYS = /fitpercent|fit_percent|score|recommend/i;

async function http(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
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
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as any, cookie, location: res.headers.get('location') }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function until<T>(what: string, fn: () => T | undefined | Promise<T | undefined>, ms = 240_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms / 1000}s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

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

let fake: FakeZoho;
let cookie: string;
let hv: HRVoice;
let hrJobId: string;
let zohoJobId: string;
let kavya: FakeApplication;

describe('Zoho Recruit connector on HR Voice', () => {
  beforeAll(async () => {
    fake = await startFakeZoho(ZOHO_PORT);
  });
  afterAll(async () => {
    await fake?.close();
  });

  it('Z1. an admin with a published agent and a test job connects Zoho Recruit (PKCE, one-time state)', async () => {
    const email = `zoho-${randomUUID().slice(0, 8)}@example.test`;
    const signUp = await http('POST', '/api/auth/sign-up/email', { body: { email, password: PASSWORD, name: 'Zoho Admin' } });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);
    cookie = signUp.cookie;
    const org = await http('POST', '/organizations', { cookie, body: { name: 'Zoho Co Hiring' } });
    expect([200, 201]).toContain(org.status);
    const agent = await http('POST', '/agents', { cookie, body: { name: 'Zoho Screener', purpose: 'Screen applicants', agentType: 'hiring' } });
    await http('POST', `/agents/${agent.body.id}/versions/${agent.body.versionId}/publish`, { cookie, body: {} });
    const key = await http('POST', '/organization/api-keys', {
      cookie,
      body: { name: 'Zoho test', mode: 'test', scopes: ['jobs', 'candidates', 'calls', 'results'] },
    });
    hv = new HRVoice({ apiKey: key.body.key, baseUrl: API });
    hrJobId = (await hv.createJob({ title: 'Warehouse Supervisor', mustAskQuestions: QUESTIONS })).id;

    const status = await http('GET', '/integrations/zoho', { cookie });
    expect(status.body).toEqual({ available: true, connection: null });

    const start = await http('POST', '/integrations/zoho/connect', { cookie, body: { consent: true } });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    const authUrl = new URL(start.body.url);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    expect(authUrl.searchParams.get('prompt')).toBe('consent');

    // Zoho sends the browser to the web app's /backend proxy; here we call the API directly.
    const signIn = await fetch(authUrl, { redirect: 'manual' });
    const back = new URL(signIn.headers.get('location')!);
    expect(back.pathname).toBe('/backend/integrations/zoho/callback');
    const cb = await http('GET', `/integrations/zoho/callback${back.search}`, { cookie });
    expect(cb.status).toBe(302);
    expect(cb.location).toBe('/settings/sources?zoho=connected');
    const replay = await http('GET', `/integrations/zoho/callback${back.search}`, { cookie });
    expect(replay.location).toContain('zoho=expired');
  });

  it('Z2. linking a Zoho job brings in the applicant, skips the rejected one, and the auto call completes', async () => {
    zohoJobId = fake.addJob('Warehouse Supervisor');
    kavya = fake.addApplication({ jobId: zohoJobId, name: 'Kavya Menon', mobile: '9000000301', email: 'kavya@example.test', status: 'New' });
    fake.addApplication({ jobId: zohoJobId, name: 'Rohit Rejected', mobile: '9000000302', status: 'Rejected' });

    const openings = await http('GET', '/integrations/zoho/job-openings', { cookie });
    expect(openings.body.jobOpenings.map((j: { id: string }) => j.id)).toContain(zohoJobId);
    const put = await http('PUT', '/integrations/zoho/links', {
      cookie,
      body: { links: [{ zohoJobId, zohoJobTitle: 'Warehouse Supervisor', jobId: hrJobId, autoCall: true }] },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const status = await until('the applicant to come in', async () => {
      const s = (await http('GET', '/integrations/zoho', { cookie })).body;
      return s.connection?.links[0]?.imported === 1 && s.connection.skipped.length === 1 ? s : undefined;
    }, 60_000);
    expect(status.connection.skipped).toEqual([{ reason: 'closed_in_zoho', count: 1, names: ['Rohit Rejected'] }]);
    const list = await hv.listCandidates(hrJobId);
    expect(list.candidates.map((c) => c.fullName)).toEqual(['Kavya Menon']);
    expect(list.candidates[0]!.externalId).toBe(`zoho:${kavya.id}`);

    // The automatic call ran on the fake line (test job), and its note reached the Zoho candidate.
    const note = await until('the note on the Zoho candidate', () => fake.notes.find((n) => n.parentId === kavya.candidateId));
    expect(note.module).toBe('Candidates');
    expect(note.content).toContain('HRVoice screening call · Warehouse Supervisor');
    expect(note.content).toContain('What is your notice period?:');
    expect(note.content).toContain('HRVoice does not score or recommend.');
    expect(note.content).not.toMatch(/fitPercent|\d+\s*%|score:|recommendation:/i);
    expect(keysOf(note.raw).filter((k) => SCORE_KEYS.test(k))).toEqual([]);

    const after = (await http('GET', '/integrations/zoho', { cookie })).body;
    expect(after.connection.notes).toMatchObject({ sent: 1, failed: 0 });
    expect(keysOf(after).filter((k) => SCORE_KEYS.test(k))).toEqual([]);
  });

  it('Z3. a person rejected in Zoho after import is refused a call', async () => {
    const before = (await http('GET', '/integrations/zoho', { cookie })).body.connection.lastSyncAt as string;
    kavya.status = 'Rejected';
    kavya.modifiedTime = zohoIst(new Date(Date.now() + 2000));
    await new Promise((r) => setTimeout(r, 1100)); // so the next lastSyncAt is visibly later
    const sync = await http('POST', '/integrations/zoho/sync', { cookie });
    expect(sync.status).toBe(202);
    await until('the sync to finish', async () => {
      const s = (await http('GET', '/integrations/zoho', { cookie })).body.connection;
      return s.lastSyncAt && s.lastSyncAt > before ? true : undefined;
    }, 60_000);
    const candidateId = (await hv.listCandidates(hrJobId)).candidates[0]!.id;
    await expect(hv.startCall(hrJobId, candidateId)).rejects.toMatchObject({ status: 409, code: 'closed_in_ats' });
  });

  it('Z4. disconnect revokes the token and removes the connection', async () => {
    const del = await http('DELETE', '/integrations/zoho', { cookie });
    expect(del.status).toBe(204);
    expect(fake.revoked.length).toBeGreaterThanOrEqual(1);
    expect((await http('GET', '/integrations/zoho', { cookie })).body).toEqual({ available: true, connection: null });
  });
});
