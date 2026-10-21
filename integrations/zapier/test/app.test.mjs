/**
 * The Zapier app against a fake HRVoice (node:http), through zapier-platform-core's
 * own appTester, so every perform runs the real middleware and request path.
 */

import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const zapier = require('zapier-platform-core');
const schemaTools = require('zapier-platform-core/src/tools/schema');

const hits = [];
let routes = {};
let server;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      hits.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body ? JSON.parse(body) : undefined });
      const [status, out] = routes[`${req.method} ${url.pathname}`] ?? [404, { code: 'not_found', message: 'Job not found', request_id: 'r1' }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.HRVOICE_API_URL = `http://127.0.0.1:${server.address().port}/`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  hits.length = 0;
  routes = {};
});

const App = require('../index.js');
const appTester = zapier.createAppTester(App);
const authData = { apiKey: 'hrv_test_abc' };
const JOB = '0b8f8c9e-4f1d-4a43-9f6b-6d2c3c1f5e20';
const CAND = '7d9e2a10-5b3c-4f8e-8a1d-9c0b1e2f3a45';

const SCORE_KEYS = /fitpercent|fit_percent|score|recommend/i;
const keysOf = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
};

describe('HRVoice Zapier app', () => {
  it('is a valid Zapier app definition', () => {
    expect(schemaTools.validateApp(schemaTools.compileApp(App))).toEqual([]);
  });

  it('tests the connection with GET /v1/ping and a Bearer key', async () => {
    routes['GET /v1/ping'] = [200, { organizationId: 'o1', apiKey: { id: 'k1', mode: 'test' } }];
    const out = await appTester(App.authentication.test, { authData });
    expect(out.apiKey.mode).toBe('test');
    expect(hits[0].headers.authorization).toBe('Bearer hrv_test_abc');
    expect(App.authentication.connectionLabel(null, { inputData: out })).toBe('Test key');
  });

  it('shows the API error message on a refused key', async () => {
    routes['GET /v1/ping'] = [401, { code: 'unauthorized', message: 'Invalid API key', request_id: 'r' }];
    await expect(appTester(App.authentication.test, { authData })).rejects.toThrow(/Invalid API key/);
  });

  it('refuses to add a candidate without consent and sends nothing', async () => {
    const perform = App.creates.add_candidate.operation.perform;
    for (const consent of [undefined, false, 'false', 'no', '']) {
      await expect(
        appTester(perform, { authData, inputData: { jobId: JOB, fullName: 'Asha', phone: '9000000101', consent } }),
      ).rejects.toThrow(/agree/);
    }
    expect(hits).toEqual([]);
    expect(App.creates.add_candidate.operation.inputFields.find((f) => f.key === 'consent').required).toBe(true);
  });

  it('adds a consented candidate with only the fields given', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates`] = [201, { id: CAND, created: true }];
    const out = await appTester(App.creates.add_candidate.operation.perform, {
      authData,
      inputData: { jobId: JOB, fullName: 'Asha Rao', phone: '9000000101', countryCode: '+91', externalId: 'ats-1', email: '', consent: 'true' },
    });
    expect(out).toEqual({ id: CAND, created: true });
    expect(hits[0].body).toEqual({ fullName: 'Asha Rao', phone: '9000000101', countryCode: '+91', externalId: 'ats-1', consent: true });
  });

  it('starts a call and raises a ticket', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates/${CAND}/calls`] = [202, { id: 'c1', status: 'queued' }];
    routes['POST /v1/tickets'] = [201, { id: 't1', ref: 'ABC123', status: 'open' }];
    expect(await appTester(App.creates.start_call.operation.perform, { authData, inputData: { jobId: JOB, candidateId: CAND } }))
      .toMatchObject({ status: 'queued' });
    expect(await appTester(App.creates.raise_ticket.operation.perform, { authData, inputData: { body: 'Help', jobId: JOB } }))
      .toMatchObject({ ref: 'ABC123' });
    expect(hits[1].body).toEqual({ body: 'Help', jobId: JOB, channel: 'api' });
  });

  it('a call refused by a limit surfaces the API message', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates/${CAND}/calls`] = [429, { code: 'call_limit_reached', message: 'Daily call limit reached', request_id: 'r' }];
    await expect(appTester(App.creates.start_call.operation.perform, { authData, inputData: { jobId: JOB, candidateId: CAND } }))
      .rejects.toThrow(/Daily call limit reached/);
  });

  it('a per-key rate limit becomes a Zapier throttle (retried later)', async () => {
    routes[`POST /v1/jobs/${JOB}/candidates/${CAND}/calls`] = [429, { code: 'rate_limited', message: 'Slow down', request_id: 'r' }];
    await expect(appTester(App.creates.start_call.operation.perform, { authData, inputData: { jobId: JOB, candidateId: CAND } }))
      .rejects.toMatchObject({ name: 'ThrottledError' });
  });

  it('creates a job with its must-ask questions', async () => {
    routes['POST /v1/jobs'] = [201, { id: JOB, title: 'Picker' }];
    await appTester(App.creates.create_job.operation.perform, {
      authData, inputData: { title: 'Picker', mustAskQuestions: ['Notice period?', ' '], language: 'hi' },
    });
    expect(hits[0].body).toEqual({ title: 'Picker', language: 'hi', mustAskQuestions: ['Notice period?'] });
  });

  it('finds a candidate by externalId or phone', async () => {
    routes[`GET /v1/jobs/${JOB}/candidates`] = [200, { candidates: [{ id: CAND }], nextCursor: null }];
    const out = await appTester(App.searches.find_candidate.operation.perform, { authData, inputData: { jobId: JOB, phone: '+91 90000 00101' } });
    expect(out).toEqual([{ id: CAND }]);
    expect(hits[0].query).toMatchObject({ phone: '+91 90000 00101', limit: '10' });
    await expect(appTester(App.searches.find_candidate.operation.perform, { authData, inputData: { jobId: JOB } })).rejects.toThrow(/search by/);
  });

  it('job and candidate dropdowns list from /v1', async () => {
    routes['GET /v1/jobs'] = [200, { jobs: [{ id: JOB, title: 'Picker' }] }];
    routes[`GET /v1/jobs/${JOB}/candidates`] = [200, { candidates: [{ id: CAND, fullName: 'Asha' }], nextCursor: null }];
    expect(await appTester(App.triggers.job.operation.perform, { authData })).toEqual([{ id: JOB, title: 'Picker' }]);
    expect(await appTester(App.triggers.candidate.operation.perform, { authData, inputData: { jobId: JOB } }))
      .toEqual([{ id: CAND, fullName: 'Asha' }]);
  });

  describe.each(['call_completed', 'call_failed'])('%s REST hook', (key) => {
    const type = key.replace('_', '.');
    const op = App.triggers[key].operation;

    it('subscribes the Zapier URL to just this event and unsubscribes by id', async () => {
      routes['POST /v1/webhook-endpoints'] = [201, { id: 'e1', secret: 'whsec_x' }];
      routes['DELETE /v1/webhook-endpoints/e1'] = [200, { deleted: true }];
      const sub = await appTester(op.performSubscribe, { authData, targetUrl: 'https://hooks.zapier.com/hooks/standard/1/abc' });
      expect(sub).toEqual({ id: 'e1', secret: 'whsec_x' });
      expect(hits[0].body).toEqual({ url: 'https://hooks.zapier.com/hooks/standard/1/abc', events: [type] });
      expect(await appTester(op.performUnsubscribe, { authData, subscribeData: sub })).toEqual({ deleted: true });
    });

    it('perform passes a correctly signed event through and drops everything else', async () => {
      const event = { id: 'evt_1', type, createdAt: new Date().toISOString(), data: { callId: 'c1', result: { status: 'ended', answers: [] } } };
      const content = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const sig = (secret, at = t, body = content) => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
      const run = (header, body = content) =>
        appTester(op.perform, {
          authData,
          subscribeData: { id: 'e1', secret: 'whsec_right' },
          rawRequest: { method: 'POST', headers: { 'Http-Hrvoice-Signature': header }, content: body },
        });
      expect(await run(sig('whsec_right'))).toEqual([event]);
      expect(await run(sig('whsec_wrong'))).toEqual([]);
      expect(await run(sig('whsec_right', t - 3600))).toEqual([]);
      expect(await run(sig('whsec_right'), content.replace('c1', 'c2'))).toEqual([]);
      expect(await run('garbage')).toEqual([]);
      const other = JSON.stringify({ ...event, type: type === 'call.completed' ? 'call.failed' : 'call.completed' });
      expect(await run(sig('whsec_right', t, other), other)).toEqual([]);
    });

    it('performList shows recent events from /v1/events, and samples carry no score', async () => {
      routes['GET /v1/events'] = [200, { events: [{ id: 'evt_recent_c1', type, data: { callId: 'c1' } }] }];
      expect(await appTester(op.performList, { authData })).toEqual([{ id: 'evt_recent_c1', type, data: { callId: 'c1' } }]);
      expect(hits[0].query).toEqual({ type, limit: '3' });
      expect(op.sample.type).toBe(type);
    });
  });

  it('no sample or output field anywhere names a score, fit or recommendation', () => {
    expect(keysOf(JSON.parse(JSON.stringify(App))).filter((k) => SCORE_KEYS.test(k))).toEqual([]);
    expect(JSON.stringify(App)).not.toMatch(/fitPercent|score|recommend/i);
  });

  it('names none of our voice or telephony vendors', () => {
    const fs = require('node:fs');
    const text = ['index.js', 'signature.js'].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('');
    expect(text).not.toMatch(/exotel|elevenlabs|deepgram|sarvam|gemini|twilio|plivo/i);
  });
});
