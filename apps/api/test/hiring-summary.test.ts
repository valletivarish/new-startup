/**
 * GET /hiring/summary: the Jobs home in one request. Queue rules mirror the web's
 * `homeQueueOf`; totals stay true when items are capped; someone without candidates.read gets
 * numbers and no names (redesign decision 5); another organization never shows up.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@platform/db';

import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';
import {
  acceptInvitation,
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { superDatabase } from './setup/fixtures.js';

interface Item {
  jobId: string;
  jobTitle: string;
  candidateId: string;
  fullName: string;
  stage: string;
  callStatus: string;
  failureReason: string | null;
  lastCallAt: string | null;
  fit: { overall: string } | null;
}
interface Summary {
  counts: { agents: number | null; openJobs: number; candidates: number };
  totals: { jobs: number };
  queues: Record<'readyForReview' | 'notConnected' | 'onHold' | 'notCalled', { total: number; items: Item[] }>;
  jobs: {
    jobId: string;
    jobTitle: string;
    jobStatus: string;
    funnel: { total: number; notCalled: number; notConnected: number; toReview: number; onHold: number; movedForward: number } | null;
  }[];
}

let api: ApiHarness;
let owner: TestActor;
let rival: TestActor;
let viewer: TestActor;
let phoneCounter = 0;

beforeAll(async () => {
  api = await startApi(
    { ELEVENLABS_ENABLED: 'true', ELEVENLABS_API_KEY: 'stub', ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx' },
    createStubVoiceSessionAdapter(),
  );
  owner = await registerUser(api, 'sum-owner');
  rival = await registerUser(api, 'sum-rival');
  viewer = await registerUser(api, 'sum-viewer');
  await createOrganization(api, owner, 'Summary Org');
  await createOrganization(api, rival, 'Rival Org');
  const token = await inviteAndCaptureToken(api, owner, viewer.email, 'viewer');
  expect((await acceptInvitation(api, viewer, token)).statusCode).toBeLessThan(300);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

async function json<T>(actor: TestActor, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
  const res = await api.request({ method, url, cookie: actor.cookie, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
}

async function summaryOf(actor: TestActor): Promise<Summary> {
  const res = await json<Summary>(actor, 'GET', '/hiring/summary');
  expect(res.status).toBe(200);
  return res.body;
}

async function publishedAgent(actor: TestActor): Promise<string> {
  const agent = await json<{ id: string; versionId: string }>(actor, 'POST', '/agents', {
    name: 'Screen', purpose: 'Screen candidates', description: 'summary test',
  });
  await json(actor, 'POST', `/agents/${agent.body.id}/versions/${agent.body.versionId}/publish`, {});
  return agent.body.id;
}

async function job(actor: TestActor, title: string, status?: 'open' | 'closed'): Promise<string> {
  const created = await json<{ id: string }>(actor, 'POST', '/jobs', { title, description: `${title} role.` });
  if (status) await json(actor, 'PATCH', `/jobs/${created.body.id}`, { status });
  return created.body.id;
}

async function candidate(actor: TestActor, jobId: string, fullName: string, stage?: string): Promise<string> {
  phoneCounter += 1;
  const created = await json<{ id: string }>(actor, 'POST', '/candidates', {
    jobId, fullName, phone: `98${String(10_000_000 + phoneCounter)}`, countryCode: '+91',
  });
  expect(created.status).toBe(201);
  if (stage) {
    const moved = await json(actor, 'PATCH', `/jobs/${jobId}/candidates/${created.body.id}`, { status: stage });
    expect(moved.status).toBe(200);
  }
  return created.body.id;
}

/** A phone call on the candidate in the given state (the stored voice_sessions status). */
async function call(
  actor: TestActor,
  agentId: string,
  jobId: string,
  candidateId: string,
  status: 'ended' | 'failed' | 'active',
  extra: { failureReason?: string; fit?: object } = {},
) {
  const start = await json<{ voiceSessionId: string }>(actor, 'POST', `/agents/${agentId}/voice-sessions`, {});
  const id = start.body.voiceSessionId;
  expect(id).toBeTruthy();
  const superDb = superDatabase();
  await superDb.db.execute(sql`
    update voice_sessions set job_id = ${jobId}, candidate_id = ${candidateId}, status = ${status},
      failure_reason = ${extra.failureReason ?? null},
      fit = ${extra.fit ? JSON.stringify(extra.fit) : null}::jsonb
    where id = ${id}`);
  await superDb.db.execute(sql`
    update agent_sessions set channel = 'phone' where id = (select session_id from voice_sessions where id = ${id})`);
  await superDb.close();
}

describe('empty workspace', () => {
  it('returns zeros and four empty queues', async () => {
    const body = await summaryOf(owner);
    expect(body.counts).toEqual({ agents: 0, openJobs: 0, candidates: 0 });
    expect(body.totals.jobs).toBe(0);
    expect(body.jobs).toEqual([]);
    for (const q of Object.values(body.queues)) expect(q).toEqual({ total: 0, items: [] });
  });
});

describe('with data', () => {
  let agentId: string;
  let main: string;
  let bulk: string;
  let closed: string;
  const names: Record<string, string> = {};

  beforeAll(async () => {
    agentId = await publishedAgent(owner);
    main = await job(owner, 'Main job', 'open');
    bulk = await job(owner, 'Bulk job', 'open');
    closed = await job(owner, 'Closed job', 'closed');

    const people: [string, string | undefined][] = [
      ['Nora NotCalled', undefined],
      ['Rita Ready', undefined],
      ['Sam ScreeningDone', 'screening'],
      ['Fay Failed', undefined],
      ['Hal Hold', 'screening'],
      ['Ron Reviewed', 'reviewed'],
      ['Dee Declined', 'declined'],
      ['Cal Calling', undefined],
    ];
    for (const [name, stage] of people) names[name] = await candidate(owner, main, name, stage);

    await call(owner, agentId, main, names['Rita Ready']!, 'ended', { fit: { overall: 'meets_all', items: [], flags: [] } });
    await call(owner, agentId, main, names['Sam ScreeningDone']!, 'ended');
    await call(owner, agentId, main, names['Fay Failed']!, 'failed', { failureReason: 'no_answer' });
    await call(owner, agentId, main, names['Ron Reviewed']!, 'ended');
    await call(owner, agentId, main, names['Dee Declined']!, 'failed');
    await call(owner, agentId, main, names['Cal Calling']!, 'active');

    for (let i = 1; i <= 12; i += 1) await candidate(owner, bulk, `Bulk ${String(i).padStart(2, '0')}`);
    names['Cleo Closed'] = await candidate(owner, closed, 'Cleo Closed');
  }, 120_000);

  it('puts each person in the one queue homeQueueOf gives them', async () => {
    const { queues } = await summaryOf(owner);
    const ids = (q: keyof Summary['queues']) => queues[q].items.map((i) => i.candidateId);
    expect(ids('readyForReview').sort()).toEqual([names['Rita Ready']!, names['Sam ScreeningDone']!].sort());
    expect(ids('notConnected')).toEqual([names['Fay Failed']!]);
    expect(ids('onHold')).toEqual([names['Hal Hold']!]);
    // Decided people (reviewed, declined) and a call in progress sit in no queue.
    const everyone = Object.values(queues).flatMap((q) => q.items.map((i) => i.candidateId));
    for (const out of ['Ron Reviewed', 'Dee Declined', 'Cal Calling']) expect(everyone).not.toContain(names[out]);
  });

  it('carries the fields the web renders: stage, call status, reason, fit, job', async () => {
    const { queues } = await summaryOf(owner);
    const rita = queues.readyForReview.items.find((i) => i.candidateId === names['Rita Ready'])!;
    expect(rita).toMatchObject({
      jobId: main, jobTitle: 'Main job', fullName: 'Rita Ready', stage: 'new', callStatus: 'completed',
    });
    expect(rita.fit?.overall).toBe('meets_all');
    expect(rita.lastCallAt).toEqual(expect.any(String));
    // Meets-all leads the review list.
    expect(queues.readyForReview.items[0]?.candidateId).toBe(names['Rita Ready']);
    expect(queues.notConnected.items[0]).toMatchObject({ callStatus: 'failed', failureReason: 'no_answer' });
    expect(queues.notCalled.items[0]).toMatchObject({ stage: 'new', callStatus: 'not_called', failureReason: null });
  });

  it('keeps true totals while capping items at 8', async () => {
    const { queues } = await summaryOf(owner);
    // Nora + 12 bulk. A closed job asks nothing of anyone, so Cleo is in no queue.
    expect(queues.notCalled.total).toBe(13);
    const everyone = Object.values(queues).flatMap((q) => q.items.map((i) => i.candidateId));
    expect(everyone).not.toContain(names['Cleo Closed']);
    expect(queues.notCalled.items).toHaveLength(8);
    expect(queues.readyForReview.total).toBe(2);
  });

  it('gives each job its funnel, closed jobs included with their status', async () => {
    const body = await summaryOf(owner);
    const byId = Object.fromEntries(body.jobs.map((j) => [j.jobId, j]));
    expect(byId[main]?.funnel).toEqual({ total: 8, notCalled: 1, notConnected: 1, toReview: 1, onHold: 2, movedForward: 1 });
    expect(byId[bulk]?.funnel).toEqual({ total: 12, notCalled: 12, notConnected: 0, toReview: 0, onHold: 0, movedForward: 0 });
    expect(byId[closed]).toMatchObject({ jobStatus: 'closed', jobTitle: 'Closed job' });
    expect(byId[closed]?.funnel?.total).toBe(1);
    expect(body.counts).toEqual({ agents: 1, openJobs: 2, candidates: 21 });
    expect(body.totals.jobs).toBe(3);
  });

  it('never shows another organization anything, and vice versa', async () => {
    const rivalAgent = await publishedAgent(rival);
    const rivalJob = await job(rival, 'Rival secret job', 'open');
    const rivalPerson = await candidate(rival, rivalJob, 'Rhea Rival');
    await call(rival, rivalAgent, rivalJob, rivalPerson, 'ended');

    const mine = JSON.stringify(await summaryOf(owner));
    expect(mine).not.toContain('Rhea Rival');
    expect(mine).not.toContain('Rival secret job');

    const theirs = await summaryOf(rival);
    expect(theirs.counts).toEqual({ agents: 1, openJobs: 1, candidates: 1 });
    expect(theirs.queues.readyForReview.items.map((i) => i.fullName)).toEqual(['Rhea Rival']);
    expect(JSON.stringify(theirs)).not.toContain('Main job');
  });

  it('without candidates.read: real totals, no names, no items, no funnels', async () => {
    const full = await summaryOf(owner);
    const body = await summaryOf(viewer);
    expect(body.counts.candidates).toBe(full.counts.candidates);
    for (const key of Object.keys(full.queues) as (keyof Summary['queues'])[]) {
      expect(body.queues[key]).toEqual({ total: full.queues[key].total, items: [] });
    }
    expect(body.jobs).toHaveLength(3);
    expect(body.jobs.every((j) => j.funnel === null)).toBe(true);
    const text = JSON.stringify(body);
    for (const name of Object.keys(names)) expect(text).not.toContain(name);
    expect(text).not.toContain('Cleo Closed');
  });

  it('needs a session', async () => {
    const res = await api.request({ method: 'GET', url: '/hiring/summary' });
    expect(res.statusCode).toBe(401);
  });
});

describe('a big job', () => {
  it('lists people by call status, so Review finds answers past the first page; the funnel is exact past 100', async () => {
    const boss = await registerUser(api, 'sum-big');
    await createOrganization(api, boss, 'Big Org');
    const agent = await publishedAgent(boss);
    const big = await job(boss, 'Big job', 'open');
    for (let i = 1; i <= 100; i += 1) await candidate(boss, big, `Quiet ${String(i).padStart(3, '0')}`);
    const answered: string[] = [];
    for (const n of ['A', 'B', 'C']) answered.push(await candidate(boss, big, `Answered ${n}`));
    for (const id of answered) await call(boss, agent, big, id, 'ended');
    await call(boss, agent, big, await candidate(boss, big, 'Failed one'), 'failed');

    type Page = { candidates: { callStatus: string; candidate: { fullName: string } }[]; nextCursor: string | null };
    const review = await json<Page>(boss, 'GET', `/jobs/${big}/candidates?status=new&call=completed&limit=40`);
    expect(review.status).toBe(200);
    expect(review.body.candidates.map((c) => c.candidate.fullName).sort()).toEqual(['Answered A', 'Answered B', 'Answered C']);
    expect(review.body.nextCursor).toBeNull();
    const quiet = await json<Page>(boss, 'GET', `/jobs/${big}/candidates?call=not_called&limit=40`);
    expect(quiet.body.candidates).toHaveLength(40);
    expect(quiet.body.nextCursor).not.toBeNull();
    const failed = await json<Page>(boss, 'GET', `/jobs/${big}/candidates?call=failed`);
    expect(failed.body.candidates.map((c) => c.callStatus)).toEqual(['failed']);
    expect((await json(boss, 'GET', `/jobs/${big}/candidates?call=bogus`)).status).toBe(422);

    const funnel = (await summaryOf(boss)).jobs.find((j) => j.jobId === big)?.funnel;
    expect(funnel).toMatchObject({ total: 104, notCalled: 100, notConnected: 1, toReview: 3 });
  }, 180_000);
});
