/**
 * Client integration tables: tenant isolation, pre-tenant hash lookups and the
 * candidate external_id uniqueness. Real PostgreSQL, real non-owner role.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withTenantContext, type Database } from '@platform/db';

import {
  appDatabase,
  createOrgWithOwner,
  expectDatabaseRejection,
  superDatabase,
  type TestOrg,
} from './setup/fixtures.js';

let app: Database;
let su: Database;

interface World {
  org: TestOrg;
  jobId: string;
  candidateId: string;
  keyHash: string;
  linkHash: string;
}

const TABLES = [
  'api_keys',
  'idempotency_keys',
  'call_requests',
  'org_call_limits',
  'webhook_endpoints',
  'webhook_deliveries',
  'candidate_links',
] as const;

async function build(label: string): Promise<World> {
  const org = await createOrgWithOwner(su, label);
  const o = org.organizationId;
  const keyHash = `keyhash-${label}-${Math.random()}`;
  const linkHash = `linkhash-${label}-${Math.random()}`;
  const one = async (q: ReturnType<typeof sql>) =>
    (await su.db.execute<{ id: string }>(q))[0]!.id;

  const jobId = await one(sql`insert into jobs (organization_id, title) values (${o}, ${label}) returning id`);
  const candidateId = await one(sql`
    insert into candidates (organization_id, job_id, full_name, external_id)
    values (${o}, ${jobId}, ${label}, 'ext-1') returning id`);
  const keyId = await one(sql`
    insert into api_keys (organization_id, created_by_user_id, name, prefix, key_hash, mode, scopes)
    values (${o}, ${org.ownerUserId}, ${label}, 'hrv_', ${keyHash}, 'live', array['calls:write']) returning id`);
  await su.db.execute(sql`
    insert into idempotency_keys (organization_id, key, method, path, status, body)
    values (${o}, 'k1', 'POST', '/v1/calls', 202, '{}'::jsonb)`);
  await su.db.execute(sql`
    insert into call_requests (organization_id, job_id, candidate_id, source, status, created_by_key_id)
    values (${o}, ${jobId}, ${candidateId}, 'api', 'queued', ${keyId})`);
  await su.db.execute(sql`insert into org_call_limits (organization_id) values (${o})`);
  const endpointId = await one(sql`
    insert into webhook_endpoints (organization_id, url, secret, events)
    values (${o}, 'https://example.test/hook', 's3cret', array['call.completed']) returning id`);
  await su.db.execute(sql`
    insert into webhook_deliveries (organization_id, endpoint_id, event, payload, status)
    values (${o}, ${endpointId}, 'call.completed', '{}'::jsonb, 'pending')`);
  await su.db.execute(sql`
    insert into candidate_links (organization_id, job_id, token_hash, expires_at)
    values (${o}, ${jobId}, ${linkHash}, now() + interval '1 day')`);
  return { org, jobId, candidateId, keyHash, linkHash };
}

let a: World;
let b: World;

beforeAll(async () => {
  app = appDatabase();
  su = superDatabase();
  a = await build('int-a');
  b = await build('int-b');
}, 60_000);

afterAll(async () => {
  await app?.close();
  await su?.close();
});

describe('client integration tables', () => {
  for (const table of TABLES) {
    it(`${table} shows only the current organization's rows`, async () => {
      const rows = await withTenantContext(
        app.db,
        { organizationId: a.org.organizationId, userId: a.org.ownerUserId },
        (tx) =>
          tx.execute<{ organization_id: string }>(
            sql`select organization_id from ${sql.identifier(table)}`,
          ),
      );
      expect(rows.length).toBe(1);
      expect(rows.every((r) => r.organization_id === a.org.organizationId)).toBe(true);
    });
  }

  it('resolve_api_key finds a key by hash with no tenant context', async () => {
    const rows = await app.db.execute<{ organization_id: string; mode: string }>(
      sql`select * from resolve_api_key(${a.keyHash})`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.organization_id).toBe(a.org.organizationId);
    expect(rows[0]!.mode).toBe('live');
    const none = await app.db.execute(sql`select * from resolve_api_key('nope')`);
    expect(none.length).toBe(0);
  });

  it('resolve_candidate_link finds a link by hash with no tenant context', async () => {
    const rows = await app.db.execute<{ job_id: string }>(
      sql`select * from resolve_candidate_link(${b.linkHash})`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.job_id).toBe(b.jobId);
  });

  it('a plain query with no context still sees nothing', async () => {
    const rows = await app.db.execute(sql`select 1 from api_keys`);
    expect(rows.length).toBe(0);
  });

  it('refuses a duplicate (organization, job, external_id) candidate', async () => {
    await expectDatabaseRejection(
      () =>
        su.db.execute(sql`
          insert into candidates (organization_id, job_id, full_name, external_id)
          values (${a.org.organizationId}, ${a.jobId}, 'dup', 'ext-1')`),
      /candidates_org_job_external_unique|duplicate key/i,
    );
  });
});
