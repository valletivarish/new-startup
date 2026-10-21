/**
 * Zoho Recruit connector against the fake Zoho (apps/acme/src/fake-zoho.ts):
 * connect with PKCE, Modified_Time paging with equal timestamps, rejected
 * applicants skipped and never called, token refresh race, notes with no
 * score, retries, tenant isolation and disconnect. Real app, real RLS.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withTenantContext, withoutTenantContext } from '@platform/db';

import { startFakeZoho, zohoIst, type FakeZoho } from '../../acme/src/fake-zoho.js';
import { appDatabase, superDatabase } from './setup/fixtures.js';
import { createOrganization, registerUser, startApi, type ApiHarness, type TestActor } from './setup/api-harness.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';
import { firstRead, nextRead, isClosedStatus, buildNote, OVERLAP_MS } from '../src/connectors/zoho/sync.js';
import type { ZohoService } from '../src/connectors/zoho/zoho.service.js';
import { JOBS_SERVICE, VOICE_SESSION_SERVICE, ZOHO_SERVICE } from '../src/tokens.more.js';

let api: ApiHarness;
let fake: FakeZoho;
let zoho: ZohoService;

interface Org {
  owner: TestActor;
  orgId: string;
  jobId: string;
  agentId: string;
}

async function superSql<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    return await withoutTenantContext(db.db, (tx) => tx.execute<T>(query));
  } finally {
    await db.close();
  }
}

async function setupOrg(label: string): Promise<Org> {
  const owner = await registerUser(api, label);
  const orgId = await createOrganization(api, owner, `${label} Co`);
  const agent = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: 'Screener', purpose: 'Screen', description: 'calls', agentType: 'hiring' },
  });
  const a = JSON.parse(agent.body) as { id: string; versionId: string };
  await api.request({ method: 'POST', url: `/agents/${a.id}/versions/${a.versionId}/publish`, cookie: owner.cookie, payload: {} });
  const minted = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: owner.cookie,
    payload: { name: 'k', mode: 'live', scopes: ['jobs'] },
  });
  const job = await api.request({
    method: 'POST',
    url: '/v1/jobs',
    headers: { authorization: `Bearer ${JSON.parse(minted.body).key}` },
    payload: { title: `${label} picker`, mustAskQuestions: ['What is your notice period?'] },
  });
  expect(job.statusCode, job.body).toBe(201);
  return { owner, orgId, jobId: JSON.parse(job.body).id, agentId: a.id };
}

const actor = (o: Org) => ({ organizationId: o.orgId, userId: o.owner.userId });

/** Dashboard connect → fake Zoho sign-in → callback, as the browser would. */
async function connect(o: Org): Promise<string> {
  const start = await api.request({ method: 'POST', url: '/integrations/zoho/connect', cookie: o.owner.cookie, payload: { consent: true } });
  expect(start.statusCode, start.body).toBe(201);
  const signIn = await fetch(JSON.parse(start.body).url as string, { redirect: 'manual' });
  const back = new URL(signIn.headers.get('location')!);
  expect(back.pathname).toBe('/backend/integrations/zoho/callback');
  const cb = await api.request({
    method: 'GET',
    url: `/integrations/zoho/callback${back.search}`,
    cookie: o.owner.cookie,
  });
  expect(cb.statusCode, cb.body).toBe(302);
  return String(cb.headers['location']);
}

async function status(o: Org) {
  const res = await api.request({ method: 'GET', url: '/integrations/zoho', cookie: o.owner.cookie });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body);
}

let orgA: Org;
let orgB: Org;
let zohoJobA: string;

beforeAll(async () => {
  fake = await startFakeZoho();
  api = await startApi(
    {
      ELEVENLABS_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'test-key',
      ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
      ZOHO_CLIENT_ID: 'fake-client',
      ZOHO_CLIENT_SECRET: 'fake-secret',
      ZOHO_TEST_BASE_URL: fake.url,
    },
    createStubVoiceSessionAdapter(),
  );
  zoho = api.built.app.get(ZOHO_SERVICE);
  orgA = await setupOrg('zoho-a');
  orgB = await setupOrg('zoho-b');
  zohoJobA = fake.addJob('Warehouse Supervisor');
}, 120_000);

afterAll(async () => {
  await api?.close();
  await fake?.close();
});

describe('paging rule (pure)', () => {
  it('starts the overlap window before the cursor, and steps pages only inside one stuck second', () => {
    const cursor = new Date('2026-10-21T10:00:00Z');
    expect(firstRead(null)).toEqual({ modifiedSince: null, page: 1 });
    expect(firstRead(cursor).modifiedSince!.getTime()).toBe(cursor.getTime() - OVERLAP_MS);

    const t = new Date('2026-10-21T10:05:00.000Z');
    const a = nextRead({ modifiedSince: null, page: 1 }, { latest: t, more: true })!;
    expect(a).toEqual({ modifiedSince: new Date(t.getTime() - 1000), page: 1 });
    // The same full second again: page 2, same window.
    expect(nextRead(a, { latest: t, more: true })).toEqual({ modifiedSince: a.modifiedSince, page: 2 });
    // Time moved on: back to page 1.
    const later = new Date(t.getTime() + 5000);
    expect(nextRead({ ...a, page: 2 }, { latest: later, more: true })).toEqual({
      modifiedSince: new Date(later.getTime() - 1000),
      page: 1,
    });
    expect(nextRead(a, { latest: t, more: false })).toBeNull();
  });

  it('treats hired, rejected and archived as closed', () => {
    for (const s of ['Hired', 'Rejected', 'Archived', 'Rejected - Hiring Manager', 'Offer-Declined']) expect(isClosedStatus(s)).toBe(true);
    for (const s of ['New', 'Applied', 'Screening', 'Qualified']) expect(isClosedStatus(s)).toBe(false);
  });

  it('a note carries answers and the summary, never a score', () => {
    const n = buildNote({
      jobTitle: 'Picker',
      startedAt: '2026-10-21T05:30:00Z',
      durationSeconds: 300,
      outcome: 'completed',
      questions: ['What is your notice period?', 'Expected CTC?'],
      answers: [{ question: 'What is your notice period?', answer: '30 days' }],
      summary: 'Has 3 years of forklift experience.',
      link: 'https://example.test/jobs/x',
    });
    expect(n.content).toContain('- What is your notice period?: 30 days');
    expect(n.content).toContain('- Expected CTC?: No answer noted; check the recording');
    expect(n.content).toContain('21 Oct 2026');
    expect(n.content).not.toMatch(/\d+\s*%|fit|score:/i);
  });
});

describe('Zoho Recruit connector', () => {
  it('reports itself available, with no connection yet', async () => {
    expect(zoho.available()).toBe(true);
    expect((await status(orgB)).connection).toBeNull();
  });

  it('connects with PKCE and a one-time state; a replayed callback is refused', async () => {
    const start = await api.request({ method: 'POST', url: '/integrations/zoho/connect', cookie: orgA.owner.cookie, payload: { consent: false } });
    expect(start.statusCode).toBe(422);

    const location = await connect(orgA);
    expect(location).toBe('/settings?section=connected&zoho=connected');
    const s = await status(orgA);
    expect(s.connection.status).toBe('connected');

    // The sealed column holds no readable token.
    const [row] = await superSql<{ secrets_sealed: string }>(sql`select secrets_sealed from zoho_connections where organization_id = ${orgA.orgId}`);
    expect(row!.secrets_sealed).toMatch(/^v1\./);
    expect(row!.secrets_sealed).not.toContain('fake-');

    // Same state again → expired; another company's session can't use it either.
    const s2 = await api.request({ method: 'POST', url: '/integrations/zoho/connect', cookie: orgA.owner.cookie, payload: { consent: true } });
    const back = new URL((await fetch(JSON.parse(s2.body).url as string, { redirect: 'manual' })).headers.get('location')!);
    const foreign = await api.request({ method: 'GET', url: `/integrations/zoho/callback${back.search}`, cookie: orgB.owner.cookie });
    expect(foreign.headers['location']).toContain('zoho=expired');
    const forged = new URLSearchParams(back.search);
    forged.set('accounts-server', 'https://evil.example');
    const bad = await api.request({ method: 'GET', url: `/integrations/zoho/callback?${forged}`, cookie: orgA.owner.cookie });
    expect(bad.headers['location']).toContain('zoho=not_zoho');
    const replay = await api.request({ method: 'GET', url: `/integrations/zoho/callback${back.search}`, cookie: orgA.owner.cookie });
    expect(replay.headers['location']).toContain('zoho=expired');
  });

  it('lists job openings and links one', async () => {
    const list = await api.request({ method: 'GET', url: '/integrations/zoho/job-openings', cookie: orgA.owner.cookie });
    expect(JSON.parse(list.body).jobOpenings).toContainEqual({ id: zohoJobA, title: 'Warehouse Supervisor', status: 'In-progress' });
    const put = await api.request({
      method: 'PUT',
      url: '/integrations/zoho/links',
      cookie: orgA.owner.cookie,
      payload: { links: [{ zohoJobId: zohoJobA, zohoJobTitle: 'Warehouse Supervisor', jobId: orgA.jobId, autoCall: false }] },
    });
    expect(put.statusCode, put.body).toBe(200);
    // Another company's job can't be linked.
    const foreign = await api.request({
      method: 'PUT',
      url: '/integrations/zoho/links',
      cookie: orgA.owner.cookie,
      payload: { links: [{ zohoJobId: zohoJobA, zohoJobTitle: 'X', jobId: orgB.jobId, autoCall: false }] },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('imports 450 applicants sharing one Modified_Time without deep pages, and skips rejected / no-phone ones', async () => {
    const same = zohoIst(new Date(Date.now() - 3_600_000));
    for (let i = 0; i < 450; i += 1) {
      fake.addApplication({ jobId: zohoJobA, name: `Bulk ${i}`, mobile: `9${String(100000000 + i)}`, status: 'New', modifiedTime: same });
    }
    fake.addApplication({ jobId: zohoJobA, name: 'Rohit Rejected', mobile: '9811111111', status: 'Rejected', modifiedTime: same });
    fake.addApplication({ jobId: zohoJobA, name: 'Nina Nophone', mobile: null, status: 'New' });
    fake.addApplication({ jobId: fake.addJob('Unlinked job'), name: 'Other Job', mobile: '9822222222', status: 'New' });
    fake.applicationReads.length = 0;

    const sync = await api.request({ method: 'POST', url: '/integrations/zoho/sync', cookie: orgA.owner.cookie });
    expect(sync.statusCode).toBe(202);

    const [count] = await superSql<{ n: number }>(sql`
      select count(*)::int as n from candidates where job_id = ${orgA.jobId} and external_id like 'zoho:%' and consent_source = 'customer'`);
    expect(count!.n).toBe(450);
    // Never deeper than page 3 (the stuck second), back to page 1 after.
    expect(Math.max(...fake.applicationReads.map((r) => r.page))).toBeLessThanOrEqual(3);
    // The equal-timestamp branch really ran: pages 2 and 3 inside the one second.
    expect(fake.applicationReads.map((r) => r.page)).toEqual(expect.arrayContaining([2, 3]));

    const s = await status(orgA);
    expect(s.connection.lastSyncAt).toBeTruthy();
    expect(s.connection.links[0].imported).toBe(450);
    const reasons = Object.fromEntries(s.connection.skipped.map((x: { reason: string; count: number }) => [x.reason, x.count]));
    expect(reasons).toEqual({ closed_in_zoho: 1, no_phone: 1 });
    const [rohit] = await superSql<{ n: number }>(sql`select count(*)::int as n from candidates where full_name = 'Rohit Rejected'`);
    expect(rohit!.n).toBe(0);

    // A second sync re-reads only the overlap and changes nothing.
    await api.request({ method: 'POST', url: '/integrations/zoho/sync', cookie: orgA.owner.cookie });
    const [again] = await superSql<{ n: number }>(sql`select count(*)::int as n from candidates where job_id = ${orgA.jobId}`);
    expect(again!.n).toBe(450);
  });

  it('a person rejected in Zoho after import can no longer be called', async () => {
    const app = fake.applications.find((a) => a.name === 'Bulk 7')!;
    app.status = 'Rejected';
    app.modifiedTime = zohoIst(new Date());
    await zoho.syncOrganization(orgA.orgId);
    const [cand] = await superSql<{ id: string }>(sql`select id from candidates where full_name = 'Bulk 7' and job_id = ${orgA.jobId}`);
    const voice = api.built.app.get(VOICE_SESSION_SERVICE);
    await expect(
      voice.startOutboundPhoneCall(actor(orgA), orgA.agentId, { jobId: orgA.jobId, candidateId: cand!.id }),
    ).rejects.toMatchObject({ code: 'closed_in_ats' });
  });

  it('two jobs refreshing an expired token at once both succeed, and one stored token wins', async () => {
    // Expire the stored access token.
    const [row] = await superSql<{ secrets_sealed: string }>(sql`select secrets_sealed from zoho_connections where organization_id = ${orgA.orgId}`);
    const { createSealer } = await import('../src/connectors/zoho/seal.js');
    const sealer = createSealer('test-secret-test-secret-test-secret');
    const secrets = JSON.parse(sealer.open(row!.secrets_sealed));
    await superSql(sql`update zoho_connections set secrets_sealed = ${sealer.seal(JSON.stringify({ ...secrets, expiresAt: 0 }))} where organization_id = ${orgA.orgId}`);
    const before = fake.refreshes;
    const [a, b] = await Promise.all([zoho.jobOpenings(actor(orgA)), zoho.jobOpenings(actor(orgA))]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    expect(fake.refreshes - before).toBeGreaterThanOrEqual(1);
    const [after] = await superSql<{ secrets_sealed: string }>(sql`select secrets_sealed from zoho_connections where organization_id = ${orgA.orgId}`);
    expect(JSON.parse(sealer.open(after!.secrets_sealed)).expiresAt).toBeGreaterThan(Date.now());
    // The stored token works without another refresh.
    const n = fake.refreshes;
    await zoho.jobOpenings(actor(orgA));
    expect(fake.refreshes).toBe(n);
  });

  it('after a call, one note reaches the Zoho candidate with answers and no score; a failed send is retried', async () => {
    const app = fake.applications.find((a) => a.name === 'Bulk 3')!;
    const [cand] = await superSql<{ id: string }>(sql`select id from candidates where full_name = 'Bulk 3' and job_id = ${orgA.jobId}`);
    const voice = api.built.app.get(VOICE_SESSION_SERVICE);
    const { voiceSessionId } = await voice.startOutboundPhoneCall(actor(orgA), orgA.agentId, {
      jobId: orgA.jobId,
      candidateId: cand!.id,
    });
    await superSql(sql`
      update voice_sessions set status = 'ended', duration_seconds = 95,
        transcript = ${JSON.stringify([{ role: 'user', message: 'Thirty days.' }])}::jsonb,
        summary = 'Good fit, we should hire her. Notice period is 30 days.',
        structured_answers = ${JSON.stringify({ what_is_your_notice_period: '30 days' })}::jsonb,
        fit = ${JSON.stringify({ percent: 90 })}::jsonb
      where id = ${voiceSessionId}`);

    fake.notesDown = true;
    await zoho.queueNote(orgA.orgId, voiceSessionId);
    await zoho.queueNote(orgA.orgId, voiceSessionId); // once per call
    const [note] = await superSql<{ id: string }>(sql`select id from zoho_notes where voice_session_id = ${voiceSessionId}`);
    const all = await superSql<{ id: string }>(sql`select id from zoho_notes where voice_session_id = ${voiceSessionId}`);
    expect(all).toHaveLength(1);
    await expect(zoho.sendNote(orgA.orgId, note!.id)).rejects.toThrow(/zoho_unreachable/);
    const [pending] = await superSql<{ status: string; attempts: number }>(sql`select status, attempts from zoho_notes where id = ${note!.id}`);
    expect(pending).toEqual({ status: 'pending', attempts: 1 });
    expect((await status(orgA)).connection.notes.pending).toBe(1);

    fake.notesDown = false;
    await zoho.sendNote(orgA.orgId, note!.id);
    expect(fake.notes).toHaveLength(1);
    const sent = fake.notes[0]!;
    expect(sent.parentId).toBe(app.candidateId);
    expect(sent.module).toBe('Candidates');
    expect(sent.content).toContain('What is your notice period?: 30 days');
    expect(sent.content).not.toMatch(/90\s*%|percent|we should hire/i);
    expect(sent.content).toContain('Notice period is 30 days.');
    expect(JSON.stringify(sent.raw)).not.toMatch(/fitPercent|"fit"|"score"|recommendation/i);
    expect((await status(orgA)).connection.notes.sent).toBe(1);
  });

  it('a refused refresh marks the connection; another company sees nothing of it', async () => {
    // Org B's database view of every Zoho table is empty.
    const db = appDatabase();
    try {
      const counts = await withTenantContext(db.db, actor(orgB), async (tx) => {
        const out: number[] = [];
        for (const t of ['zoho_connections', 'zoho_job_links', 'zoho_applicants', 'zoho_notes']) {
          const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(t)}`);
          out.push(r[0]!.n);
        }
        return out;
      });
      expect(counts).toEqual([0, 0, 0, 0]);
    } finally {
      await db.close();
    }
    expect((await status(orgB)).connection).toBeNull();
    const bSync = await api.request({ method: 'POST', url: '/integrations/zoho/sync', cookie: orgB.owner.cookie });
    expect(bSync.statusCode).toBe(409);

    // Zoho revokes the grant: the next sync stops and says so.
    const [row] = await superSql<{ secrets_sealed: string }>(sql`select secrets_sealed from zoho_connections where organization_id = ${orgA.orgId}`);
    const { createSealer } = await import('../src/connectors/zoho/seal.js');
    const sealer = createSealer('test-secret-test-secret-test-secret');
    const secrets = JSON.parse(sealer.open(row!.secrets_sealed));
    await fetch(`${fake.url}/oauth/v2/token/revoke?token=${secrets.refreshToken}`, { method: 'POST' });
    await superSql(sql`update zoho_connections set secrets_sealed = ${sealer.seal(JSON.stringify({ ...secrets, expiresAt: 0 }))} where organization_id = ${orgA.orgId}`);
    await zoho.syncOrganization(orgA.orgId);
    const s = await status(orgA);
    expect(s.connection).toMatchObject({ status: 'needs_attention', reason: 'consent_revoked' });
  });

  it('reconnect keeps links; disconnect removes the connection data and revokes the token', async () => {
    await connect(orgA); // reconnect revokes the old token and keeps the links
    expect((await status(orgA)).connection.links).toHaveLength(1);
    const [row] = await superSql<{ secrets_sealed: string }>(sql`select secrets_sealed from zoho_connections where organization_id = ${orgA.orgId}`);
    const { createSealer } = await import('../src/connectors/zoho/seal.js');
    const refresh = JSON.parse(createSealer('test-secret-test-secret-test-secret').open(row!.secrets_sealed)).refreshToken;

    const del = await api.request({ method: 'DELETE', url: '/integrations/zoho', cookie: orgA.owner.cookie });
    expect(del.statusCode).toBe(204);
    expect(fake.revoked).toContain(refresh);
    expect((await status(orgA)).connection).toBeNull();
    const [left] = await superSql<{ n: number }>(sql`
      select (select count(*) from zoho_applicants where organization_id = ${orgA.orgId})::int
           + (select count(*) from zoho_notes where organization_id = ${orgA.orgId})::int as n`);
    expect(left!.n).toBe(0);
    // Candidates themselves stay in HRVoice.
    const jobs = api.built.app.get(JOBS_SERVICE);
    expect((await jobs.get(actor(orgA), orgA.jobId)).id).toBe(orgA.jobId);
  });
});
