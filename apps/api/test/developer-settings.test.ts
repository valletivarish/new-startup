/**
 * Settings → Developers: the dashboard's session routes for webhook endpoints, the delivery
 * log and usage (the same services as /v1, reached with a cookie, never with an API key).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withoutTenantContext } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';
import { createOrganization, registerUser, startApi, type ApiHarness, type TestActor } from './setup/api-harness.js';

let api: ApiHarness;
let owner: TestActor;
let orgId: string;

async function superSql<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = superDatabase();
  try {
    return await withoutTenantContext(db.db, (tx) => tx.execute<T>(query));
  } finally {
    await db.close();
  }
}

const asOwner = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  api.request({ method, url, cookie: owner.cookie, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  api = await startApi();
  owner = await registerUser(api, 'dev-settings');
  orgId = await createOrganization(api, owner, 'Dev Settings Co');
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('dashboard webhooks', () => {
  it('adds an endpoint (secret once), lists it, logs deliveries, resends and deletes', async () => {
    const created = await asOwner('POST', '/organization/webhooks', {
      url: 'http://localhost:4100/hrvoice/webhook',
      events: ['call.completed', 'call.completed'],
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id, secret } = JSON.parse(created.body) as { id: string; secret: string };
    expect(secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);

    const list = JSON.parse((await asOwner('GET', '/organization/webhooks')).body) as {
      endpoints: { id: string; url: string; events: string[] }[];
    };
    expect(list.endpoints).toEqual([
      expect.objectContaining({ id, url: 'http://localhost:4100/hrvoice/webhook', events: ['call.completed'] }),
    ]);
    expect(JSON.stringify(list)).not.toContain(secret);

    const [row] = await superSql<{ id: string }>(sql`
      insert into webhook_deliveries (organization_id, endpoint_id, event, payload, status, attempts, last_status_code, last_error)
      values (${orgId}, ${id}, 'call.completed', '{}'::jsonb, 'failed', 13, 500, 'HTTP 500')
      returning id
    `);
    const deliveries = await asOwner('GET', '/organization/webhooks/deliveries');
    expect(deliveries.statusCode).toBe(200);
    expect(JSON.parse(deliveries.body).deliveries).toEqual([
      expect.objectContaining({ id: row!.id, status: 'failed', attempts: 13, lastStatusCode: 500 }),
    ]);

    const resent = await asOwner('POST', `/organization/webhooks/deliveries/${row!.id}/resend`);
    expect(resent.statusCode, resent.body).toBe(201);
    expect(JSON.parse(resent.body)).toMatchObject({ status: 'pending', attempts: 0 });
    // Still pending: a second resend is refused.
    expect((await asOwner('POST', `/organization/webhooks/deliveries/${row!.id}/resend`)).statusCode).toBe(409);

    expect((await asOwner('DELETE', `/organization/webhooks/${id}`)).statusCode).toBe(204);
    expect(JSON.parse((await asOwner('GET', '/organization/webhooks')).body).endpoints).toEqual([]);
    expect((await asOwner('DELETE', `/organization/webhooks/${id}`)).statusCode).toBe(404);
  });

  it('rejects a bad URL and unknown events', async () => {
    const bad = await asOwner('POST', '/organization/webhooks', { url: 'ftp://example.com', events: ['call.completed'] });
    expect(bad.statusCode).toBe(422);
    const noEvents = await asOwner('POST', '/organization/webhooks', { url: 'https://example.com/h', events: ['nope'] });
    expect(noEvents.statusCode).toBe(422);
  });

  it('is closed to API keys, even with the webhooks scope', async () => {
    const minted = await asOwner('POST', '/organization/api-keys', {
      name: 'ATS', mode: 'test', scopes: ['webhooks', 'results', 'usage'],
    });
    const { key } = JSON.parse(minted.body) as { key: string };
    for (const url of ['/organization/webhooks', '/organization/webhooks/deliveries', '/organization/usage']) {
      const res = await api.request({ method: 'GET', url, headers: { authorization: `Bearer ${key}` } });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

describe('dashboard usage', () => {
  it('answers this month by default and a chosen month', async () => {
    const now = await asOwner('GET', '/organization/usage');
    expect(now.statusCode, now.body).toBe(200);
    expect(JSON.parse(now.body)).toMatchObject({
      month: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7),
      callsPlaced: 0,
      completedScreens: 0,
    });
    const past = await asOwner('GET', '/organization/usage?month=2026-01');
    expect(JSON.parse(past.body)).toMatchObject({ month: '2026-01', callsPlaced: 0 });
    expect((await asOwner('GET', '/organization/usage?month=2026-13')).statusCode).toBe(422);
  });
});
