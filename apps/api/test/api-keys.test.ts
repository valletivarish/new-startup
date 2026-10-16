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

let api: ApiHarness;
let owner: TestActor;
let orgId: string;

beforeAll(async () => {
  api = await startApi();
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
    const lastUsed = async () => {
      const db = superDatabase();
      try {
        const rows = await withoutTenantContext(db.db, (tx) =>
          tx.execute<{ last_used_at: string | null }>(
            sql`select last_used_at from api_keys where id = ${created.id}`,
          ),
        );
        return rows[0]?.last_used_at ?? null;
      } finally {
        await db.close();
      }
    };
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
});
