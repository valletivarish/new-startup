/**
 * SECURITY regression: a password-reset link must never appear in an HTTP
 * response, whatever the mail transport. The link may only reach the inbox
 * (or, with the console transport, the server log).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerUser, startApi, type ApiHarness, type TestActor } from './setup/api-harness.js';

let api: ApiHarness;
let user: TestActor;

beforeAll(async () => {
  // Console transport is the configuration that previously leaked the link.
  api = await startApi({ NOTIFICATION_TRANSPORT: 'console' });
  user = await registerUser(api, 'reset-leak');
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('password reset never returns a link over HTTP', () => {
  it('request-password-reset answers identically for known and unknown emails', async () => {
    const known = await api.request({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email: user.email, redirectTo: 'http://localhost:3000/reset-password' },
    });
    const unknown = await api.request({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email: 'nobody-here@example.test', redirectTo: 'http://localhost:3000/reset-password' },
    });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(known.body).not.toMatch(/reset-password\/|token/i);
  });

  it('the console-link route returns no link for an email that just requested a reset', async () => {
    await api.request({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email: user.email, redirectTo: 'http://localhost:3000/reset-password' },
    });
    const res = await api.request({
      method: 'POST',
      url: '/auth/password-reset/console-link',
      payload: { email: user.email },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/reset-password\/|https?:\/\//);
  });
});
