/**
 * Boots the REAL application against the Testcontainers database: real
 * guards, real Better Auth, real RLS, real non-owner role. Requests go
 * through fastify.inject — no network, full middleware chain.
 *
 * The only substitution is the NotificationProvider, injected through the
 * same interface production uses, so tests can read invitation emails the
 * way a recipient would. Raw invitation tokens exist ONLY in those emails.
 */

import 'reflect-metadata';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import type { NotificationProvider } from '@platform/providers';
import { buildApp, type BuiltApp } from '../../src/server.js';

export interface CapturedEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface ApiHarness {
  readonly built: BuiltApp;
  readonly outbox: CapturedEmail[];
  request(options: InjectOptions & { cookie?: string }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function startApi(
  extraEnv: Record<string, string> = {},
): Promise<ApiHarness> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL not set — global setup did not run');

  const outbox: CapturedEmail[] = [];
  const capturingProvider: NotificationProvider = {
    name: 'test-capture',
    async sendEmail(params) {
      outbox.push({ to: params.to, subject: params.subject, text: params.text });
    },
  };

  const built = await buildApp(
    {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      API_URL: 'http://localhost:3001',
      WEB_URL: 'http://localhost:3000',
      LOG_LEVEL: 'silent',
      // Generous: security tests fire many requests from one injected "ip".
      RATE_LIMIT_MAX: '10000',
      // No worker process in tests — deliver inline so the capturing
      // provider observes sends synchronously.
      JOBS_ENABLED: 'false',
      ...extraEnv,
    },
    { notifications: capturingProvider },
  );
  await built.app.init();
  const fastify = built.app.getHttpAdapter().getInstance();
  await fastify.ready();

  return {
    built,
    outbox,
    async request({ cookie, ...options }) {
      const headers: Record<string, string> = {
        // Only claim a JSON body when one exists — Fastify correctly rejects
        // an empty body under a JSON content type.
        ...(options.payload !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(options.headers as Record<string, string> | undefined),
      };
      if (cookie) headers['cookie'] = cookie;
      return fastify.inject({ ...options, headers });
    },
    async close() {
      await built.close();
    },
  };
}

/** Extract the session cookie pair from a Better Auth response. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const setCookies = res.headers['set-cookie'];
  const list = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  const pairs = list
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c.includes('session_token'));
  if (pairs.length === 0) {
    throw new Error(
      `no session cookie in response (status ${res.statusCode}): ${res.body.slice(0, 300)}`,
    );
  }
  return pairs.join('; ');
}

let emailCounter = 0;

export interface TestActor {
  readonly email: string;
  readonly cookie: string;
  readonly userId: string;
}

/** Register a fresh user through the real sign-up route and return a session. */
export async function registerUser(
  api: ApiHarness,
  label: string,
): Promise<TestActor> {
  emailCounter += 1;
  const email = `${label}-${emailCounter}-${Math.floor(Math.random() * 1e9)}@example.test`;

  const res = await api.request({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: label },
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-up failed (${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
  const cookie = sessionCookie(res);

  const me = await api.request({ method: 'GET', url: '/auth/me', cookie });
  if (me.statusCode !== 200) {
    throw new Error(`/auth/me failed (${me.statusCode}): ${me.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(me.body) as { user: { id: string } };
  return { email, cookie, userId: parsed.user.id };
}

/** Log an existing user in again, returning a fresh session cookie. */
export async function login(api: ApiHarness, email: string): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    payload: { email, password: 'correct-horse-battery-staple' },
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-in failed (${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
  return sessionCookie(res);
}

/** Create an organization through the real endpoint; session becomes active in it. */
export async function createOrganization(
  api: ApiHarness,
  actor: TestActor,
  name: string,
): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/organizations',
    cookie: actor.cookie,
    payload: { name },
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    throw new Error(`org create failed (${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
  return (JSON.parse(res.body) as { id: string }).id;
}

/**
 * Invite an email through the real endpoint and capture the raw token from
 * the invitation email, exactly as the recipient would.
 */
export async function inviteAndCaptureToken(
  api: ApiHarness,
  inviter: TestActor,
  email: string,
  roleKey: string,
): Promise<string> {
  const before = api.outbox.length;
  const res = await api.request({
    method: 'POST',
    url: '/organization/invitations',
    cookie: inviter.cookie,
    payload: { email, roleKey },
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    throw new Error(`invite failed (${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
  // The response body must never contain the token.
  if (/token=/.test(res.body)) {
    throw new Error('SECURITY: invitation API response leaked the raw token');
  }
  const mail = api.outbox.slice(before).find((m) => m.to === email);
  if (!mail) throw new Error('invitation email not captured');
  const match = /token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!match?.[1]) throw new Error('token not found in invitation email');
  return match[1];
}

/** Accept an invitation as the given actor. */
export async function acceptInvitation(
  api: ApiHarness,
  actor: TestActor,
  token: string,
): Promise<LightMyRequestResponse> {
  return api.request({
    method: 'POST',
    url: '/invitations/accept',
    cookie: actor.cookie,
    payload: { token },
  });
}
