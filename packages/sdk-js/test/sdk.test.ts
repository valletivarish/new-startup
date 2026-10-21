import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { HRVoice, HRVoiceError, verifyWebhook, WebhookVerificationError } from '../src/index.ts';

type Call = { url: string; init: RequestInit };

/** A fetch that answers from a queue and records what it was sent. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const envelope = (code: string, extra: object = {}) => ({ code, message: code, request_id: 'req-1', ...extra });
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

const client = (fn: typeof fetch, opts: object = {}) =>
  new HRVoice({ apiKey: 'hrv_test_x', baseUrl: 'http://api.test/', fetch: fn, ...opts });

describe('HRVoice client', () => {
  it('sends the bearer key and builds paths and query strings', async () => {
    const f = fakeFetch(json(200, { candidates: [], nextCursor: null }));
    await client(f.fn).listCandidates('job 1', { limit: 5 });
    expect(f.calls[0]!.url).toBe('http://api.test/v1/jobs/job%201/candidates?limit=5');
    expect(header(f.calls[0]!, 'authorization')).toBe('Bearer hrv_test_x');
    expect(header(f.calls[0]!, 'idempotency-key')).toBeUndefined();
  });

  it('adds an Idempotency-Key to writes, and uses the one passed in', async () => {
    const f = fakeFetch(json(201, { id: 'j' }), json(202, { id: 'c' }));
    const hv = client(f.fn);
    await hv.createJob({ title: 'Picker' });
    await hv.startCall('j', 'cand', { idempotencyKey: 'mine' });
    expect(header(f.calls[0]!, 'idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(f.calls[1]!, 'idempotency-key')).toBe('mine');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ title: 'Picker' });
  });

  it('batches candidates and unwraps list responses', async () => {
    const f = fakeFetch(json(201, { candidates: [{ id: 'a', created: true }] }), json(200, { jobs: [{ id: 'j' }] }));
    const hv = client(f.fn);
    const out = await hv.addCandidates('j', [{ fullName: 'A', consent: true }]);
    expect(out).toEqual([{ id: 'a', created: true }]);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ candidates: [{ fullName: 'A', consent: true }] });
    expect(await hv.listJobs()).toEqual([{ id: 'j' }]);
  });

  it('retries a 429 honouring Retry-After, with the same Idempotency-Key', async () => {
    const f = fakeFetch(json(429, envelope('rate_limited'), { 'retry-after': '0.05' }), json(202, { id: 'call' }));
    const started = Date.now();
    expect(await client(f.fn).startCall('j', 'c')).toEqual({ id: 'call' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(f.calls).toHaveLength(2);
    expect(header(f.calls[1]!, 'idempotency-key')).toBe(header(f.calls[0]!, 'idempotency-key'));
  });

  it('retries 5xx and network errors, then gives up with the last error', async () => {
    const f = fakeFetch(new Error('ECONNRESET'), json(503, envelope('service_unavailable')), json(200, { ok: 1 }));
    expect(await client(f.fn).ping()).toEqual({ ok: 1 });

    const g = fakeFetch(json(500, envelope('internal')), json(500, envelope('internal')));
    await expect(client(g.fn, { maxRetries: 1 }).ping()).rejects.toMatchObject({ status: 500, code: 'internal' });
    expect(g.calls).toHaveLength(2);
  });

  it('does not wait out a call limit that resets hours from now', async () => {
    const resetsAt = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const f = fakeFetch(json(429, envelope('call_limit_reached', { details: { resetsAt } })));
    const err = await client(f.fn).startCall('j', 'c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HRVoiceError);
    expect((err as HRVoiceError).code).toBe('call_limit_reached');
    expect((err as HRVoiceError).resetsAt?.toISOString()).toBe(resetsAt);
    expect(f.calls).toHaveLength(1);
  });

  it('maps the error envelope onto HRVoiceError and does not retry 4xx', async () => {
    const f = fakeFetch(
      json(422, envelope('validation_failed', { errors: [{ field: 'title', message: 'Required' }] })),
      new Response('<html>bad gateway</html>', { status: 404 }),
    );
    const hv = client(f.fn);
    const e = (await hv.createJob({ title: '' }).catch((x: unknown) => x)) as HRVoiceError;
    expect(e).toMatchObject({ status: 422, code: 'validation_failed', requestId: 'req-1' });
    expect(e.fields).toEqual([{ field: 'title', message: 'Required' }]);
    const plain = (await hv.getJob('x').catch((x: unknown) => x)) as HRVoiceError;
    expect(plain).toMatchObject({ status: 404, code: 'http_error' });
    expect(f.calls).toHaveLength(2);
  });

  it('gives the recording URL on the API origin', () => {
    expect(client(fakeFetch().fn).recordingUrl('abc')).toBe('http://api.test/v1/calls/abc/recording');
  });
});

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'call.completed', createdAt: 'x', data: {} });
  const now = 1_760_000_000_000;
  const t = Math.floor(now / 1000);
  // Signed the way apps/api deliver.ts signPayload does.
  const sign = (ts: number, raw = body, key = secret) =>
    `t=${ts},v1=${createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex')}`;

  it('accepts a valid signature and returns the typed event', async () => {
    const evt = await verifyWebhook(body, sign(t), secret, 300, now);
    expect(evt.type).toBe('call.completed');
    expect(evt.id).toBe('evt_1');
    await expect(verifyWebhook(new TextEncoder().encode(body), sign(t), secret, 300, now)).resolves.toBeTruthy();
  });

  it('rejects a tampered body, a wrong secret and a forged signature', async () => {
    await expect(verifyWebhook(body.replace('evt_1', 'evt_2'), sign(t), secret, 300, now)).rejects.toThrow(WebhookVerificationError);
    await expect(verifyWebhook(body, sign(t, body, 'other'), secret, 300, now)).rejects.toThrow('does not match');
    await expect(verifyWebhook(body, `t=${t},v1=${'0'.repeat(64)}`, secret, 300, now)).rejects.toThrow('does not match');
  });

  it('rejects an expired (or future) timestamp and a malformed header', async () => {
    await expect(verifyWebhook(body, sign(t - 301), secret, 300, now)).rejects.toThrow('tolerance');
    await expect(verifyWebhook(body, sign(t + 301), secret, 300, now)).rejects.toThrow('tolerance');
    await expect(verifyWebhook(body, sign(t - 301), secret, 600, now)).resolves.toBeTruthy();
    await expect(verifyWebhook(body, 'v1=abc', secret, 300, now)).rejects.toThrow('malformed');
    await expect(verifyWebhook(body, undefined, secret)).rejects.toThrow('missing');
  });
});
