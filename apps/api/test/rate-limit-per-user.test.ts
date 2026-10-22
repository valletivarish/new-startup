/**
 * Global rate limiter: signed-in sessions get their own budget (RATE_LIMIT_USER_MAX), anonymous
 * traffic shares one per IP (RATE_LIMIT_MAX), forged cookies never get a bucket of their own,
 * sign-in stays IP-limited and /health is never limited.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOrganization, registerUser, startApi, type ApiHarness, type TestActor } from './setup/api-harness.js';

const IP_MAX = 5;
const USER_MAX = 8;

let api: ApiHarness;
let alice: TestActor;
let bob: TestActor;

const me = (remoteAddress: string, cookie?: string) =>
  api.request({ method: 'GET', url: '/auth/me', remoteAddress, ...(cookie ? { cookie } : {}) });

/** Fire requests until the first 429; returns how many were served before it (cap 50). */
async function servedBeforeLimit(send: () => ReturnType<typeof me>): Promise<number> {
  for (let n = 0; n < 50; n += 1) if ((await send()).statusCode === 429) return n;
  return 50;
}

beforeAll(async () => {
  api = await startApi({ RATE_LIMIT_MAX: String(IP_MAX), RATE_LIMIT_USER_MAX: String(USER_MAX) });
  // Sign-up is an /api/auth route, so it spends the (IP) budget of 127.0.0.1 only.
  alice = await registerUser(api, 'alice');
  bob = await registerUser(api, 'bob');
});
afterAll(async () => api.close());

describe('global rate limit keyed by who is asking', () => {
  it('gives two signed-in users on one IP a budget each, larger than the IP limit', async () => {
    // registerUser already spent one /auth/me on each session.
    const a = await servedBeforeLimit(() => me('10.1.0.1', alice.cookie));
    expect(a).toBe(USER_MAX - 1);
    // Alice is now blocked; Bob, on the same IP, is untouched.
    expect((await me('10.1.0.1', alice.cookie)).statusCode).toBe(429);
    const b = await servedBeforeLimit(() => me('10.1.0.1', bob.cookie));
    expect(b).toBe(USER_MAX - 1);
  });

  it('shares one budget between anonymous requests from one IP, not across IPs', async () => {
    expect(await servedBeforeLimit(() => me('10.2.0.1'))).toBe(IP_MAX);
    expect((await me('10.2.0.2')).statusCode).toBe(401);
  });

  it('puts forged or garbled session cookies in the IP bucket, not a fresh one', async () => {
    const forged = [
      'better-auth.session_token=abc.def',
      `better-auth.session_token=${alice.cookie.split('=')[1]?.replace(/.$/, 'A')}`,
      'better-auth.session_token=%E0%A4%A',
    ];
    let n = 0;
    expect(await servedBeforeLimit(() => me('10.3.0.1', forged[n++ % forged.length]))).toBe(IP_MAX);
    // A real session from that IP is unaffected.
    const carol = await registerUser(api, 'carol');
    expect((await me('10.3.0.1', carol.cookie)).statusCode).toBe(200);
  });

  it('counts forged Bearer keys against the IP bucket, and a real key keeps its own budget', async () => {
    const dave = await registerUser(api, 'dave');
    await createOrganization(api, dave, 'Limit Co');
    const created = await api.request({
      method: 'POST',
      url: '/organization/api-keys',
      cookie: dave.cookie,
      payload: { name: 'k', mode: 'test', scopes: ['jobs'] },
    });
    const { key } = JSON.parse(created.body) as { key: string };
    const ping = (k: string, ip: string) =>
      api.request({ method: 'GET', url: '/v1/ping', remoteAddress: ip, headers: { authorization: `Bearer ${k}` } });
    expect((await ping(key, '10.6.0.1')).statusCode).toBe(200); // validated, now keyed by itself

    let n = 0;
    const forged = () => ping(`hrv_test_${String(n++).padStart(32, 'A')}`, '10.6.0.1');
    let served = 0;
    for (; served < 50; served += 1) if ((await forged()).statusCode === 429) break;
    expect(served).toBe(IP_MAX - 1); // the real key's first, pre-validation request spent one; rotating fake keys never mint fresh buckets
    // The real key from that same blocked IP is unaffected.
    expect((await ping(key, '10.6.0.1')).statusCode).toBe(200);
  });

  it('keeps sign-in IP-limited whatever cookie rides along', async () => {
    let n = 0;
    const signIn = () =>
      api.request({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email: alice.email, password: `wrong-password-${n}` },
        remoteAddress: '10.4.0.1',
        cookie: n++ % 2 ? alice.cookie : `better-auth.session_token=forged${n}.x`,
      });
    let served = 0;
    for (; served < 50; served += 1) if ((await signIn()).statusCode === 429) break;
    expect(served).toBe(IP_MAX);
  });

  it('never limits /health', async () => {
    for (let i = 0; i < IP_MAX * 4; i += 1) {
      const res = await api.request({ method: 'GET', url: '/health', remoteAddress: '10.5.0.1' });
      expect(res.statusCode).toBe(200);
    }
  });
});
