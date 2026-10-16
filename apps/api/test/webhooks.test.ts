/**
 * Call events and signed webhooks: a local node:http server plays the client
 * endpoint; the worker handler (handleWebhookJob) is called directly.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { createCallRequestsService } from '../src/integrations/call-requests.service.js';
import { istMidnight } from '../src/integrations/calling-hours.js';
import { emitCallEvent } from '../src/integrations/events.js';
import { handleWebhookJob, signPayload } from '../src/integrations/deliver.js';
import { assertWebhookUrl } from '../src/integrations/webhooks.service.js';
import type { WebhookJob } from '../src/jobs/queue.js';
import { JOBS_SERVICE, VOICE_SESSION_SERVICE } from '../src/tokens.more.js';

interface Hit {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let api: ApiHarness;
let server: Server;
let baseUrl: string;
let replyStatus = 200;
const hits: Hit[] = [];
const enqueued: WebhookJob[] = [];
const queue = { enqueueWebhook: async (job: WebhookJob) => void enqueued.push(job) };
let phoneSeq = 700;

interface Org {
  owner: TestActor;
  orgId: string;
  key: string;
  jobId: string;
}

function v1(org: Org, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
  return api.request({
    method,
    url,
    headers: { authorization: `Bearer ${org.key}` },
    ...(payload ? { payload } : {}),
  });
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
  const minted = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: owner.cookie,
    payload: { name: 'ATS', mode: 'live', scopes: ['jobs', 'candidates', 'calls', 'results', 'webhooks'] },
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
  const job = await v1(org, 'POST', '/v1/jobs', {
    title: 'Picker',
    mustAskQuestions: ['What is your notice period?'],
  });
  expect(job.statusCode, job.body).toBe(201);
  org.jobId = JSON.parse(job.body).id;
  return org;
}

async function addEndpoint(org: Org, events = ['call.completed', 'call.failed']) {
  const res = await v1(org, 'POST', '/v1/webhook-endpoints', { url: `${baseUrl}/hook`, events });
  expect(res.statusCode, res.body).toBe(201);
  const body = JSON.parse(res.body) as { id: string; secret: string };
  expect(body.secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
  return body;
}

/** A placed /v1 call whose voice session then ends with the given facts. */
async function endedCall(
  org: Org,
  facts: { status?: string; failureReason?: string | null; duration?: number; spoke?: boolean } = {},
) {
  const cand = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates`, {
    fullName: 'Priya',
    phone: `9000001${++phoneSeq}`,
    externalId: `ats-${phoneSeq}`,
    consent: true,
  });
  expect(cand.statusCode, cand.body).toBe(201);
  const candidateId = JSON.parse(cand.body).id as string;
  const req = await v1(org, 'POST', `/v1/jobs/${org.jobId}/candidates/${candidateId}/calls`);
  expect(req.statusCode, req.body).toBe(202);
  const callId = JSON.parse(req.body).id as string;
  const app = api.built.app;
  await createCallRequestsService({
    database: api.built.database,
    voice: app.get(VOICE_SESSION_SERVICE),
    jobs: app.get(JOBS_SERVICE),
    queue: null,
    now: () => new Date(istMidnight(new Date()).getTime() + 10 * 3_600_000),
  }).place({ organizationId: org.orgId, userId: org.owner.userId, callRequestId: callId });
  const [cr] = await superSql<{ voice_session_id: string }>(
    sql`select voice_session_id from call_requests where id = ${callId}`,
  );
  const vsId = cr!.voice_session_id;
  expect(vsId).toBeTruthy();
  const transcript = facts.spoke === false ? [] : [{ role: 'user', message: 'Thirty days notice.' }];
  await superSql(sql`
    update voice_sessions set
      status = ${facts.status ?? 'ended'},
      failure_reason = ${facts.failureReason ?? null},
      duration_seconds = ${facts.duration ?? 60},
      transcript = ${JSON.stringify(transcript)}::jsonb,
      summary = 'Good fit, we should hire her.',
      structured_answers = ${JSON.stringify({ notice_period: '30 days' })}::jsonb
    where id = ${vsId}
  `);
  return { callId, candidateId, vsId };
}

async function emit(org: Org, vsId: string): Promise<WebhookJob[]> {
  const before = enqueued.length;
  await emitCallEvent(api.built.database, queue, org.orgId, vsId);
  return enqueued.slice(before);
}

async function deliveryRow(id: string) {
  const [row] = await superSql<{ status: string; attempts: number; last_status_code: number | null }>(
    sql`select status, attempts, last_status_code from webhook_deliveries where id = ${id}`,
  );
  return row!;
}

let orgA: Org;
let orgB: Org;
let endpointA: { id: string; secret: string };

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      hits.push({ headers: req.headers, body });
      res.statusCode = replyStatus;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  api = await startApi(
    {
      ELEVENLABS_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'test-key',
      ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
    },
    createStubVoiceSessionAdapter(),
  );
  orgA = await setupOrg('hooks-a');
  orgB = await setupOrg('hooks-b');
  endpointA = await addEndpoint(orgA);
}, 120_000);

afterAll(async () => {
  await api?.close();
  await new Promise((r) => server?.close(r));
});

describe('call events and signed webhooks', () => {
  it('call.completed arrives with a valid signature and no fitPercent', async () => {
    replyStatus = 200;
    const call = await endedCall(orgA);
    const jobs = await emit(orgA, call.vsId);
    expect(jobs).toHaveLength(1);
    // The reconcile path can run again; the event is not emitted twice.
    expect(await emit(orgA, call.vsId)).toHaveLength(0);

    const before = hits.length;
    await handleWebhookJob(api.built.database, jobs[0]!);
    const hit = hits[before]!;
    expect(hit.headers['hrvoice-event']).toBe('call.completed');
    expect(hit.headers['hrvoice-delivery']).toBe(jobs[0]!.deliveryId);
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(hit.headers['hrvoice-signature']));
    expect(m).toBeTruthy();
    expect(m![2]).toBe(signPayload(endpointA.secret, Number(m![1]), hit.body));

    const event = JSON.parse(hit.body);
    expect(event).toMatchObject({
      type: 'call.completed',
      data: {
        callId: call.callId,
        jobId: orgA.jobId,
        candidateId: call.candidateId,
        externalId: expect.stringMatching(/^ats-/),
        isTest: false,
        result: { status: 'ended', durationSeconds: 60 },
      },
    });
    expect(event.id).toMatch(/^evt_/);
    expect(event.data.result.transcript).toEqual([{ role: 'user', message: 'Thirty days notice.' }]);
    expect(hit.body).not.toMatch(/fitPercent|score/i);
    expect(hit.body).not.toContain('we should hire her');
    expect(await deliveryRow(jobs[0]!.deliveryId)).toMatchObject({ status: 'delivered', attempts: 1 });
  });

  it('a short or unanswered call is call.failed', async () => {
    const call = await endedCall(orgA, { status: 'failed', failureReason: 'no_answer', spoke: false });
    const [job] = await emit(orgA, call.vsId);
    const before = hits.length;
    await handleWebhookJob(api.built.database, job!);
    expect(JSON.parse(hits[before]!.body).type).toBe('call.failed');
    const got = JSON.parse((await v1(orgA, 'GET', `/v1/calls/${call.callId}`)).body);
    expect(got.reason).toBe('no_answer');
  });

  it('500 from endpoint → retried, then delivered when it recovers', async () => {
    const call = await endedCall(orgA);
    const [job] = await emit(orgA, call.vsId);
    replyStatus = 500;
    await expect(handleWebhookJob(api.built.database, job!)).rejects.toThrow(/HTTP 500/);
    expect(await deliveryRow(job!.deliveryId)).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_status_code: 500,
    });
    replyStatus = 200;
    await handleWebhookJob(api.built.database, job!);
    expect(await deliveryRow(job!.deliveryId)).toMatchObject({
      status: 'delivered',
      attempts: 2,
      last_status_code: 200,
    });
  });

  it('older than 24h → failed', async () => {
    const call = await endedCall(orgA);
    const [job] = await emit(orgA, call.vsId);
    await superSql(sql`
      update webhook_deliveries set created_at = now() - interval '25 hours'
      where id = ${job!.deliveryId}
    `);
    const before = hits.length;
    await handleWebhookJob(api.built.database, job!);
    expect(hits.length).toBe(before);
    expect((await deliveryRow(job!.deliveryId)).status).toBe('failed');

    const listed = await v1(orgA, 'GET', '/v1/webhook-deliveries?status=failed');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(JSON.parse(listed.body).deliveries.map((d: { id: string }) => d.id)).toContain(
      job!.deliveryId,
    );
  });

  it('resend re-queues a failed delivery', async () => {
    const [failed] = await superSql<{ id: string }>(sql`
      select id from webhook_deliveries
      where organization_id = ${orgA.orgId} and status = 'failed' limit 1
    `);
    const res = await v1(orgA, 'POST', `/v1/webhook-deliveries/${failed!.id}/resend`);
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ id: failed!.id, status: 'pending', attempts: 0 });
    replyStatus = 200;
    await handleWebhookJob(api.built.database, { organizationId: orgA.orgId, deliveryId: failed!.id });
    expect((await deliveryRow(failed!.id)).status).toBe('delivered');

    // Another company cannot resend it.
    const other = await v1(orgB, 'POST', `/v1/webhook-deliveries/${failed!.id}/resend`);
    expect(other.statusCode).toBe(404);
  });

  it('org A endpoint never receives org B events', async () => {
    const call = await endedCall(orgB);
    expect(await emit(orgB, call.vsId)).toHaveLength(0);
    const [{ n }] = (await superSql<{ n: number }>(sql`
      select count(*)::int as n from webhook_deliveries where endpoint_id = ${endpointA.id}
        and payload->'data'->>'callId' = ${call.callId}
    `)) as [{ n: number }];
    expect(n).toBe(0);
    // Org B cannot see or delete org A's endpoint.
    const list = JSON.parse((await v1(orgB, 'GET', '/v1/webhook-endpoints')).body);
    expect(list.endpoints).toEqual([]);
    expect((await v1(orgB, 'DELETE', `/v1/webhook-endpoints/${endpointA.id}`)).statusCode).toBe(404);
  });

  it('lists endpoints without the secret and deletes them', async () => {
    const extra = await addEndpoint(orgB, ['call.failed']);
    const list = await v1(orgB, 'GET', '/v1/webhook-endpoints');
    expect(list.body).not.toContain(extra.secret);
    expect(JSON.parse(list.body).endpoints).toMatchObject([{ id: extra.id, events: ['call.failed'] }]);
    expect((await v1(orgB, 'DELETE', `/v1/webhook-endpoints/${extra.id}`)).statusCode).toBe(200);
    expect(JSON.parse((await v1(orgB, 'GET', '/v1/webhook-endpoints')).body).endpoints).toEqual([]);
  });

  it('non-https url rejected in production mode', async () => {
    expect(() => assertWebhookUrl('http://127.0.0.1:9/hook', true)).toThrow(/https/);
    expect(() => assertWebhookUrl('http://example.com/hook', true)).toThrow(/https/);
    expect(() => assertWebhookUrl('https://10.0.0.5/hook', true)).toThrow(/private/);
    expect(() => assertWebhookUrl('https://169.254.169.254/hook', true)).toThrow(/private/);
    expect(() => assertWebhookUrl('https://[::1]/hook', true)).toThrow(/private/);
    expect(() => assertWebhookUrl('https://hooks.acme.example/hr', true)).not.toThrow();
    expect(() => assertWebhookUrl('http://localhost:4000/hook', false)).not.toThrow();
    // Outside production too, plain http is only for localhost.
    const res = await v1(orgA, 'POST', '/v1/webhook-endpoints', {
      url: 'http://example.com/hook',
      events: ['call.completed'],
    });
    expect(res.statusCode).toBe(422);
  });
});
