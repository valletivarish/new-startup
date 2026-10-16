/**
 * Company API keys: created once in the dashboard, then presented as
 * `Authorization: Bearer hrv_live_…` against /v1. The key acts as its
 * creator inside the key's organization, narrowed to its scopes, and stops
 * working the moment it is revoked or the creator loses the membership.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withoutTenantContext } from '@platform/db';

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
import { createKeyRateLimiter } from '../src/integrations/api-keys.service.js';
import { ApiError } from '../src/errors.js';
import { AuthzGuard } from '../src/authz/authz.guard.js';
import type { AuthContext } from '../src/authz/auth-context.js';
import type { AuditRecord } from '../src/audit/audit.service.js';

const PLATFORM_ADMIN_EMAIL = `keys-platform-admin-${Date.now()}@example.test`;

let api: ApiHarness;
let owner: TestActor;
let orgId: string;

/** Superuser read for assertions (bypasses RLS; tests only). */
async function superQuery<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  const db = superDatabase();
  try {
    return [...(await withoutTenantContext(db.db, (tx) => tx.execute(query)))] as T[];
  } finally {
    await db.close();
  }
}

async function auditFor(eventType: string, apiKeyId: string) {
  return superQuery<{ actor_user_id: string; metadata: Record<string, unknown> }>(sql`
    select actor_user_id, metadata from audit_events
    where event_type = ${eventType} and metadata->>'apiKeyId' = ${apiKeyId}
  `);
}

beforeAll(async () => {
  api = await startApi({ PLATFORM_ADMIN_EMAILS: PLATFORM_ADMIN_EMAIL });
  owner = await registerUser(api, 'keys-owner');
  orgId = await createOrganization(api, owner, 'Keys Co');
}, 120_000);

afterAll(async () => {
  await api?.close();
});

async function createKey(
  actor: TestActor,
  scopes: string[] = ['jobs'],
  mode: 'live' | 'test' = 'live',
): Promise<{ id: string; key: string; prefix: string }> {
  const res = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: actor.cookie,
    payload: { name: 'ATS sync', mode, scopes },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body);
}

function ping(key: string) {
  return api.request({
    method: 'GET',
    url: '/v1/ping',
    headers: { authorization: `Bearer ${key}` },
  });
}

describe('company API keys', () => {
  it('creates a key shown once and lists it by prefix only', async () => {
    const created = await createKey(owner, ['jobs'], 'live');
    expect(created.key).toMatch(/^hrv_live_[A-Za-z0-9]{32}$/);
    expect(created.prefix).toBe(created.key.slice(0, 12));

    const list = await api.request({
      method: 'GET',
      url: '/organization/api-keys',
      cookie: owner.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(created.key);
    expect(list.body).not.toMatch(/key_?hash/i);
    const row = (JSON.parse(list.body) as { keys: Record<string, unknown>[] }).keys.find(
      (k) => k['id'] === created.id,
    );
    expect(row).toMatchObject({
      id: created.id,
      name: 'ATS sync',
      prefix: created.prefix,
      mode: 'live',
      scopes: ['jobs'],
      revokedAt: null,
    });

    const test = await createKey(owner, ['jobs'], 'test');
    expect(test.key).toMatch(/^hrv_test_[A-Za-z0-9]{32}$/);
  });

  it("Bearer key reaches GET /v1/ping with the key's org", async () => {
    const created = await createKey(owner, ['jobs'], 'test');
    const res = await ping(created.key);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      organizationId: orgId,
      apiKey: { id: created.id, mode: 'test' },
    });
  });

  it('scopes limit permissions', async () => {
    const created = await createKey(owner, ['usage']);
    const res = await ping(created.key);
    expect(res.statusCode).toBe(403);
  });

  it('revoked key → 401', async () => {
    const created = await createKey(owner);
    expect((await ping(created.key)).statusCode).toBe(200);
    const del = await api.request({
      method: 'DELETE',
      url: `/organization/api-keys/${created.id}`,
      cookie: owner.cookie,
    });
    expect(del.statusCode).toBe(204);
    expect((await ping(created.key)).statusCode).toBe(401);
  });

  it('creator removed from org → 401 immediately', async () => {
    const admin = await registerUser(api, 'keys-admin');
    const token = await inviteAndCaptureToken(api, owner, admin.email, 'administrator');
    expect((await acceptInvitation(api, admin, token)).statusCode).toBe(201);

    const created = await createKey(admin);
    expect((await ping(created.key)).statusCode).toBe(200);

    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: owner.cookie,
    });
    const membershipId = (
      JSON.parse(members.body) as { members: { email: string; membershipId: string }[] }
    ).members.find((m) => m.email === admin.email)?.membershipId;
    expect(membershipId).toBeDefined();
    const removed = await api.request({
      method: 'DELETE',
      url: `/organization/members/${membershipId}`,
      cookie: owner.cookie,
    });
    expect(removed.statusCode).toBeLessThan(300);

    expect((await ping(created.key)).statusCode).toBe(401);
  });

  it('unknown or malformed hrv_ token → 401, with the same error body as a missing session', async () => {
    const missing = await api.request({ method: 'GET', url: '/v1/ping' });
    expect(missing.statusCode).toBe(401);
    const { request_id: _a, ...expected } = JSON.parse(missing.body) as Record<string, unknown>;

    for (const token of [
      `hrv_live_${'A'.repeat(32)}`,
      'hrv_live_short',
      `hrv_prod_${'A'.repeat(32)}`,
      `hrv_test_${'A'.repeat(31)}!`,
    ]) {
      const res = await ping(token);
      expect(res.statusCode, token).toBe(401);
      const { request_id: _b, ...body } = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toEqual(expected);
    }
  });

  it('a key cannot create keys → 403', async () => {
    const created = await createKey(owner, ['webhooks']);
    const headers = { authorization: `Bearer ${created.key}` };
    const post = await api.request({
      method: 'POST',
      url: '/organization/api-keys',
      headers,
      payload: { name: 'escalate', mode: 'live', scopes: ['jobs'] },
    });
    expect(post.statusCode).toBe(403);
    const list = await api.request({ method: 'GET', url: '/organization/api-keys', headers });
    expect(list.statusCode).toBe(403);
    const del = await api.request({
      method: 'DELETE',
      url: `/organization/api-keys/${created.id}`,
      headers,
    });
    expect(del.statusCode).toBe(403);
  });

  it('last_used_at is set', async () => {
    const created = await createKey(owner);
    const lastUsed = async () =>
      (
        await superQuery<{ last_used_at: string | null }>(
          sql`select last_used_at from api_keys where id = ${created.id}`,
        )
      )[0]?.last_used_at ?? null;
    expect(await lastUsed()).toBeNull();
    expect((await ping(created.key)).statusCode).toBe(200);
    const first = await lastUsed();
    expect(first).not.toBeNull();
    // A second call inside the minute does not move it.
    expect((await ping(created.key)).statusCode).toBe(200);
    expect(await lastUsed()).toEqual(first);
  });

  it('more than 600 requests a minute from one key → 429 rate_limited', () => {
    let now = 1_000_000;
    const limiter = createKeyRateLimiter({ limit: 600, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 600; i += 1) limiter.check('key-a');
    let thrown: unknown;
    try {
      limiter.check('key-a');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(429);
    expect((thrown as ApiError).code).toBe('rate_limited');
    // Other keys have their own budget; a new window resets this one.
    expect(() => limiter.check('key-b')).not.toThrow();
    now += 60_000;
    expect(() => limiter.check('key-a')).not.toThrow();
  });

  it('keys work only on /v1 permission routes, never account or admin routes', async () => {
    const signUp = await api.request({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        email: PLATFORM_ADMIN_EMAIL,
        password: 'correct-horse-battery-staple',
        name: 'platform-admin',
      },
    });
    expect(signUp.statusCode).toBe(200);
    const cookie = (Array.isArray(signUp.headers['set-cookie'])
      ? signUp.headers['set-cookie']
      : [signUp.headers['set-cookie'] ?? '']
    )
      .map((c) => c.split(';')[0] ?? '')
      .filter((c) => c.includes('session_token'))
      .join('; ');
    const me = JSON.parse(
      (await api.request({ method: 'GET', url: '/auth/me', cookie })).body,
    ) as { user: { id: string } };
    const admin: TestActor = { email: PLATFORM_ADMIN_EMAIL, cookie, userId: me.user.id };
    const adminOrg = await createOrganization(api, admin, 'Platform Admin Co');

    // The creator really is a platform admin: the cookie session gets in.
    const summary = await api.request({ method: 'GET', url: '/admin/costs/summary', cookie });
    expect(summary.statusCode).toBe(200);

    const created = await createKey(admin, ['jobs', 'candidates', 'calls', 'results', 'webhooks', 'usage']);
    const headers = { authorization: `Bearer ${created.key}` };
    const attempts = [
      { method: 'POST', url: '/organizations', payload: { name: 'Key Made Co' } },
      { method: 'POST', url: '/organizations/ensure', payload: {} },
      { method: 'GET', url: '/auth/me' },
      { method: 'GET', url: '/auth/organizations' },
      { method: 'POST', url: '/auth/switch-organization', payload: { organizationId: orgId } },
      { method: 'POST', url: '/invitations/accept', payload: { token: 'x'.repeat(32) } },
      { method: 'GET', url: '/admin/costs/summary' },
      { method: 'GET', url: '/admin/costs/services' },
      { method: 'GET', url: '/organization/members' },
      { method: 'GET', url: '/organization' },
    ] as const;
    for (const attempt of attempts) {
      const res = await api.request({ ...attempt, headers });
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
      expect(JSON.parse(res.body)).toMatchObject({
        code: 'forbidden',
        message: 'You do not have permission to do this',
      });
    }

    const ok = await ping(created.key);
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).organizationId).toBe(adminOrg);
  });

  it('audits key creation and revocation without the key or its hash', async () => {
    const created = await createKey(owner, ['jobs', 'usage'], 'test');
    await api.request({
      method: 'DELETE',
      url: `/organization/api-keys/${created.id}`,
      cookie: owner.cookie,
    });
    for (const eventType of ['integrations.api_key_created', 'integrations.api_key_revoked']) {
      const rows = await auditFor(eventType, created.id);
      expect(rows, eventType).toHaveLength(1);
      expect(rows[0]?.actor_user_id).toBe(owner.userId);
      expect(rows[0]?.metadata).toEqual({
        apiKeyId: created.id,
        prefix: created.prefix,
        mode: 'test',
        scopes: 'jobs,usage',
      });
      const raw = JSON.stringify(rows[0]);
      expect(raw).not.toContain(created.key);
      expect(raw).not.toMatch(/[a-f0-9]{64}/);
    }
  });

  it("a key's permission denial is audited with the key id", async () => {
    const created = await createKey(owner, ['usage']);
    expect((await ping(created.key)).statusCode).toBe(403);
    const rows = await auditFor('authz.denied', created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_user_id).toBe(owner.userId);
    expect(rows[0]?.metadata).toMatchObject({ apiKeyId: created.id, apiKeyMode: 'live' });
  });

  it("a key's sensitive-permission use is audited with the key id", async () => {
    // No /v1 route uses a sensitive permission yet, so drive the guard directly.
    const records: AuditRecord[] = [];
    const ctx: AuthContext = {
      userId: '11111111-1111-1111-1111-111111111111',
      userEmail: 'creator@example.test',
      userName: 'creator',
      emailVerified: true,
      sessionToken: '',
      organization: {
        organizationId: '22222222-2222-2222-2222-222222222222',
        membershipId: 'm',
        roleId: 'r',
        roleKey: 'owner',
        permissions: new Set(['candidates.read_pii']),
      },
      apiKey: { id: 'key-1', name: 'ATS', mode: 'test' },
    };
    const meta: Record<string, unknown> = {
      'authz:mode': 'permission',
      'authz:permission': 'candidates.read_pii',
    };
    const guard = new AuthzGuard(
      { getAllAndOverride: (k: string) => meta[k] } as never,
      { resolve: async () => ctx },
      { record: async (r: AuditRecord) => void records.push(r) },
    );
    const request = { method: 'GET', url: '/v1/candidates/x', headers: {} };
    const execution = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(execution as never)).resolves.toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventType: 'authz.sensitive_access',
      actorUserId: ctx.userId,
      metadata: { permission: 'candidates.read_pii', apiKeyId: 'key-1', apiKeyMode: 'test' },
    });
  });
});
