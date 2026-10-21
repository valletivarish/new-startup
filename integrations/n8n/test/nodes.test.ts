/**
 * The n8n nodes against a fake HRVoice (node:http). n8n's runtime is replaced by
 * a small context that does what n8n does for these nodes: read parameters and
 * send the request with the credential's Bearer header.
 */

import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HRVoiceApi } from '../src/credentials/HRVoiceApi.credentials';
import { HRVoice } from '../src/nodes/HRVoice/HRVoice.node';
import { HRVoiceTrigger } from '../src/nodes/HRVoiceTrigger/HRVoiceTrigger.node';

type Hit = { method: string; path: string; query: Record<string, string>; auth?: string; body?: unknown };
const hits: Hit[] = [];
let routes: Record<string, [number, unknown]> = {};
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      hits.push({ method: req.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
      const [status, out] = routes[`${req.method} ${url.pathname}`] ?? [404, { code: 'not_found', message: 'Not found' }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  hits.length = 0;
  routes = {};
});

/** What n8n's httpRequestWithAuthentication does with the generic Bearer credential. */
async function httpRequestWithAuthentication(_cred: string, o: { method: string; url: string; body?: unknown; qs?: Record<string, unknown> }) {
  const url = new URL(o.url);
  for (const [k, v] of Object.entries(o.qs ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method: o.method,
    headers: { authorization: 'Bearer hrv_test_n8n', ...(o.body ? { 'content-type': 'application/json' } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.message), { httpCode: String(res.status), description: json.message });
  return json;
}

const node = { name: 'HRVoice', type: 'hrVoice', typeVersion: 1, position: [0, 0], parameters: {} };
const staticData: Record<string, unknown> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(params: Record<string, unknown>, extra: Record<string, unknown> = {}): any {
  return {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name: string, _i?: number, fallback?: unknown) => (name in params ? params[name] : fallback),
    getCredentials: async () => ({ apiKey: 'hrv_test_n8n', baseUrl: `${baseUrl}/` }),
    getNode: () => node,
    continueOnFail: () => false,
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => 'https://n8n.example.test/webhook/abc/webhook',
    helpers: { httpRequestWithAuthentication, returnJsonArray: (a: object[]) => a.map((json) => ({ json })) },
    ...extra,
  };
}

const JOB = '0b8f8c9e-4f1d-4a43-9f6b-6d2c3c1f5e20';
const run = (params: Record<string, unknown>) => new HRVoice().execute.call(ctx(params));
const SCORE_KEYS = /fitpercent|fit_percent|score|recommend/i;

describe('n8n-nodes-hrvoice', () => {
  it('credential sends a Bearer key and tests with /v1/ping', () => {
    const c = new HRVoiceApi();
    expect(c.authenticate.properties.headers).toEqual({ Authorization: '=Bearer {{$credentials.apiKey}}' });
    expect(c.test.request.url).toBe('/v1/ping');
    expect(c.properties.find((p) => p.name === 'apiKey')?.typeOptions?.password).toBe(true);
  });

  it('descriptions name no score, fit or recommendation', () => {
    const all = JSON.stringify([new HRVoice().description, new HRVoiceTrigger().description, new HRVoiceApi()]);
    expect(all).not.toMatch(/fitPercent|score|recommend/i);
  });

  it('job dropdown lists /v1/jobs', async () => {
    routes['GET /v1/jobs'] = [200, { jobs: [{ id: JOB, title: 'Picker' }] }];
    expect(await new HRVoice().methods.loadOptions.getJobs.call(ctx({}))).toEqual([{ name: 'Picker', value: JOB }]);
    expect(hits[0]!.auth).toBe('Bearer hrv_test_n8n');
  });

  it('refuses to add a candidate without consent and sends nothing', async () => {
    await expect(run({ operation: 'addCandidate', jobId: JOB, fullName: 'Asha', consent: false })).rejects.toThrow(/agree/);
    expect(hits).toEqual([]);
  });

  it('adds a consented candidate with only the fields given', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates`] = [201, { id: 'c1', created: true }];
    const [[item]] = await run({
      operation: 'addCandidate', jobId: JOB, fullName: 'Asha Rao', phone: '9000000101', externalId: '',
      consent: true, additional: { email: 'asha@example.test' },
    });
    expect(item!.json).toEqual({ id: 'c1', created: true });
    expect(hits[0]!.body).toEqual({ fullName: 'Asha Rao', phone: '9000000101', email: 'asha@example.test', consent: true });
  });

  it('starts a call, finds a candidate, raises a ticket and creates a job', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates/c1/calls`] = [202, { id: 'call1', status: 'queued' }];
    routes[`GET /v1/jobs/${JOB}/candidates`] = [200, { candidates: [{ id: 'c1' }, { id: 'c2' }], nextCursor: null }];
    routes['POST /v1/tickets'] = [201, { id: 't1', ref: 'ABC123' }];
    routes['POST /v1/jobs'] = [201, { id: JOB }];
    expect((await run({ operation: 'startCall', jobId: JOB, candidateId: 'c1' }))[0]![0]!.json).toMatchObject({ status: 'queued' });
    expect((await run({ operation: 'findCandidate', jobId: JOB, phone: '+91 90000 00101' }))[0]).toHaveLength(2);
    expect(hits[1]!.query).toEqual({ phone: '+91 90000 00101', limit: '10' });
    await expect(run({ operation: 'findCandidate', jobId: JOB })).rejects.toThrow(/search by/);
    await run({ operation: 'raiseTicket', body: 'Help', ticketFields: { subject: 'Calls' } });
    expect(hits.at(-1)!.body).toEqual({ body: 'Help', subject: 'Calls', channel: 'api' });
    await run({ operation: 'createJob', title: 'Picker', mustAskQuestions: 'Notice period?\n\n CTC? ', language: 'hi' });
    expect(hits.at(-1)!.body).toEqual({ title: 'Picker', language: 'hi', mustAskQuestions: ['Notice period?', 'CTC?'] });
  });

  it('an API refusal surfaces its message', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates/c1/calls`] = [429, { code: 'call_limit_reached', message: 'Daily call limit reached' }];
    await expect(run({ operation: 'startCall', jobId: JOB, candidateId: 'c1' })).rejects.toThrow(/Daily call limit reached/);
  });

  describe('trigger', () => {
    const trigger = new HRVoiceTrigger();
    const hooks = trigger.webhookMethods.default;

    it('subscribes the n8n URL to the chosen events, finds it again, and unsubscribes', async () => {
      routes['POST /v1/webhook-endpoints'] = [201, { id: 'e1', secret: 'whsec_n8n' }];
      routes['GET /v1/webhook-endpoints'] = [200, { endpoints: [{ id: 'e1', url: 'https://n8n.example.test/webhook/abc/webhook' }] }];
      routes['DELETE /v1/webhook-endpoints/e1'] = [200, { deleted: true }];
      const c = ctx({ events: ['call.completed', 'call.failed'] });
      expect(await hooks.checkExists.call(c)).toBe(false);
      expect(await hooks.create.call(c)).toBe(true);
      expect(hits[0]!.body).toEqual({ url: 'https://n8n.example.test/webhook/abc/webhook', events: ['call.completed', 'call.failed'] });
      expect(staticData).toMatchObject({ endpointId: 'e1', secret: 'whsec_n8n' });
      expect(await hooks.checkExists.call(c)).toBe(true);
      expect(await hooks.delete.call(c)).toBe(true);
      expect(hits.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/webhook-endpoints/e1' });
      expect(staticData).toEqual({});
    });

    it('webhook runs the workflow only for a correctly signed, wanted event', async () => {
      staticData['secret'] = 'whsec_n8n';
      const event = { id: 'evt_1', type: 'call.completed', data: { callId: 'call1', result: { status: 'ended', answers: [] } } };
      const raw = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const sign = (secret: string, body = raw) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
      const sent: { status?: number } = {};
      const response = { status: (s: number) => ((sent.status = s), response), send: () => response };
      const hook = (header: string, body = raw, events = ['call.completed']) =>
        trigger.webhook.call(ctx({ events }, {
          getRequestObject: () => ({ rawBody: Buffer.from(body), body: JSON.parse(body) }),
          getHeaderData: () => ({ 'hrvoice-signature': header }),
          getResponseObject: () => response,
        }));

      const ok = await hook(sign('whsec_n8n'));
      expect(ok.workflowData).toEqual([[{ json: event }]]);
      expect(JSON.stringify(ok).match(SCORE_KEYS)).toBeNull();
      expect(await hook(sign('whsec_other'))).toEqual({ noWebhookResponse: true });
      expect(sent.status).toBe(401);
      expect((await hook(sign('whsec_n8n'), raw.replace('call1', 'call2'))).workflowData).toBeUndefined();
      expect((await hook(sign('whsec_n8n'), raw, ['call.failed'])).workflowData).toBeUndefined();
    });
  });
});
