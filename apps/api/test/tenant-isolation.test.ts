/**
 * Tenant isolation — the security core.
 *
 * Every test here runs against real PostgreSQL as the real non-owner
 * application role. `07_CODING_RULES` §14: row-level security cannot be
 * verified against a mock.
 *
 * The property under test is the one the founder elevated to an engineering
 * rule: "No cross-tenant data access, even accidentally."
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sql,
  withActorContext,
  withTenantContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';

import {
  addMember,
  appDatabase,
  createOrgWithOwner,
  createUser,
  expectRlsDenied,
  migratorDatabase,
  roleId,
  type TestOrg,
} from './setup/fixtures.js';

let db: Database;
let orgA: TestOrg;
let orgB: TestOrg;

beforeAll(async () => {
  db = appDatabase();
  orgA = await createOrgWithOwner(db, 'org-a');
  orgB = await createOrgWithOwner(db, 'org-b');
  await addMember(db, orgA, 'recruiter', 'a-recruiter');
  await addMember(db, orgB, 'recruiter', 'b-recruiter');
});

afterAll(async () => {
  await db?.close();
});

describe('the application database role', () => {
  it('is not a superuser and cannot bypass row-level security', async () => {
    const rows = await db.db.execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolname: string;
    }>(sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);

    expect(rows[0]?.rolname).toBe('platform_app');
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('does not own the tables it queries', async () => {
    const rows = await db.db.execute<{ owner: string }>(sql`
      select tableowner as owner from pg_tables
      where schemaname = 'public' and tablename = 'organization_memberships'
    `);
    expect(rows[0]?.owner).toBe('platform_migrator');
    expect(rows[0]?.owner).not.toBe('platform_app');
  });

  it('cannot disable row-level security', async () => {
    await expect(
      db.db.execute(
        sql`alter table organization_memberships disable row level security`,
      ),
    ).rejects.toThrow();
  });

  it('cannot drop a tenant policy', async () => {
    await expect(
      db.db.execute(
        sql`drop policy organization_memberships_tenant_isolation on organization_memberships`,
      ),
    ).rejects.toThrow();
  });
});

describe('organization A cannot reach organization B', () => {
  it('cannot READ B rows', async () => {
    const rows = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) =>
        tx.execute<{ id: string }>(
          sql`select id from organization_memberships where organization_id = ${orgB.organizationId}`,
        ),
    );
    expect(rows.length).toBe(0);
  });

  it('sees only its OWN rows on an unfiltered read', async () => {
    const rows = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) =>
        tx.execute<{ organization_id: string }>(
          sql`select organization_id from organization_memberships`,
        ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.organization_id).toBe(orgA.organizationId);
    }
  });

  it('cannot UPDATE B rows', async () => {
    const result = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) =>
        tx.execute(
          sql`update organization_memberships set status = 'suspended'
              where organization_id = ${orgB.organizationId}`,
        ),
    );
    expect(result.count).toBe(0);

    // and B is genuinely untouched
    const bRows = await withTenantContext(
      db.db,
      { organizationId: orgB.organizationId, userId: orgB.ownerUserId },
      async (tx) =>
        tx.execute<{ status: string }>(
          sql`select status from organization_memberships`,
        ),
    );
    expect(bRows.length).toBeGreaterThan(0);
    for (const row of bRows) expect(row.status).toBe('active');
  });

  it('cannot DELETE B rows', async () => {
    const before = await withTenantContext(
      db.db,
      { organizationId: orgB.organizationId, userId: orgB.ownerUserId },
      async (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*)::text as n from organization_memberships`,
        ),
    );

    const result = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) => tx.execute(sql`delete from organization_memberships`),
    );
    // A's own rows may be deleted; B's must not be.
    expect(result).toBeDefined();

    const after = await withTenantContext(
      db.db,
      { organizationId: orgB.organizationId, userId: orgB.ownerUserId },
      async (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*)::text as n from organization_memberships`,
        ),
    );
    expect(after[0]?.n).toBe(before[0]?.n);

    // restore A's owner membership for later tests
    const owner = await roleId(db, 'owner');
    await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) => {
        await tx.execute(sql`
          insert into organization_memberships (organization_id, user_id, role_id)
          values (${orgA.organizationId}, ${orgA.ownerUserId}, ${owner})
          on conflict do nothing
        `);
      },
    );
  });

  it('cannot INSERT a row attributed to B', async () => {
    const stranger = await createUser(db, 'stranger');
    const owner = await roleId(db, 'owner');

    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
        async (tx) => {
          await tx.execute(sql`
            insert into organization_memberships (organization_id, user_id, role_id)
            values (${orgB.organizationId}, ${stranger}, ${owner})
          `);
        },
      ),
    );
  });

  it('cannot write an audit event attributed to B', async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
        async (tx) => {
          await tx.execute(sql`
            insert into audit_events (organization_id, event_type)
            values (${orgB.organizationId}, 'forged.event')
          `);
        },
      ),
    );
  });
});

describe('fail-closed behaviour', () => {
  it('returns zero rows from every tenant table with NO context', async () => {
    const tables = [
      'organization_memberships',
      'organization_invitations',
      'audit_events',
    ];

    for (const table of tables) {
      const rows = await withoutTenantContext(db.db, async (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*)::text as n from ${sql.raw(`"${table}"`)}`,
        ),
      );
      expect(
        rows[0]?.n,
        `${table} leaked rows with no tenant context`,
      ).toBe('0');
    }
  });

  it('exposes only system roles with no context', async () => {
    const rows = await withoutTenantContext(db.db, async (tx) =>
      tx.execute<{ n: string }>(
        sql`select count(*)::text as n from roles where organization_id is not null`,
      ),
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('rejects a malformed organization id before it reaches a policy', async () => {
    await expect(
      withTenantContext(
        db.db,
        { organizationId: 'not-a-uuid', userId: orgA.ownerUserId },
        async (tx) => tx.execute(sql`select 1`),
      ),
    ).rejects.toThrow(/not a uuid/i);
  });

  it('does not leak tenant context between sequential transactions', async () => {
    await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) => tx.execute(sql`select 1`),
    );

    // SET LOCAL is transaction-scoped, so the next transaction on a pooled
    // connection must start with no organization at all.
    const rows = await withoutTenantContext(db.db, async (tx) =>
      tx.execute<{ org: string | null }>(
        sql`select current_org_id()::text as org`,
      ),
    );
    expect(rows[0]?.org).toBeNull();
  });
});

describe('the membership bootstrap policy', () => {
  it('lets a user read their OWN memberships with no organization context', async () => {
    const rows = await withActorContext(db.db, orgA.ownerUserId, async (tx) =>
      tx.execute<{ organization_id: string }>(
        sql`select organization_id from organization_memberships`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.organization_id).toBe(orgA.organizationId);
    }
  });

  it("does not let a user read someone else's memberships", async () => {
    const rows = await withActorContext(db.db, orgA.ownerUserId, async (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from organization_memberships where user_id = ${orgB.ownerUserId}`,
      ),
    );
    expect(rows.length).toBe(0);
  });

  it('does not widen WRITE authority — actor context alone cannot insert', async () => {
    const stranger = await createUser(db, 'stranger-2');
    const owner = await roleId(db, 'owner');

    await expectRlsDenied(() =>
      withActorContext(db.db, orgA.ownerUserId, async (tx) => {
        await tx.execute(sql`
          insert into organization_memberships (organization_id, user_id, role_id)
          values (${orgA.organizationId}, ${stranger}, ${owner})
        `);
      }),
    );
  });
});

describe('pgvector tenant isolation', () => {
  // Phase 1 has no production vector table — knowledge_chunks arrives in
  // Phase 3. This proves the mechanism works with pgvector BEFORE Phase 3
  // depends on it, using a table created and dropped inside the test.
  let migrator: Database;

  beforeAll(async () => {
    migrator = migratorDatabase();
    await migrator.db.execute(sql`
      create table if not exists test_vector_chunks (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references organizations(id) on delete cascade,
        content text not null,
        embedding vector(3) not null
      )
    `);
    await migrator.db.execute(
      sql`alter table test_vector_chunks enable row level security`,
    );
    await migrator.db.execute(
      sql`alter table test_vector_chunks force row level security`,
    );
    await migrator.db.execute(sql`
      create policy test_vector_chunks_tenant_isolation on test_vector_chunks
        for all
        using (organization_id = current_org_id())
        with check (organization_id = current_org_id())
    `);
    await migrator.db.execute(
      sql`grant select, insert, update, delete on test_vector_chunks to platform_app`,
    );

    for (const org of [orgA, orgB]) {
      await withTenantContext(
        db.db,
        { organizationId: org.organizationId, userId: org.ownerUserId },
        async (tx) => {
          await tx.execute(sql`
            insert into test_vector_chunks (organization_id, content, embedding)
            values (${org.organizationId}, ${`secret of ${org.organizationId}`}, '[1,1,1]')
          `);
        },
      );
    }
  });

  afterAll(async () => {
    await migrator?.db.execute(sql`drop table if exists test_vector_chunks`);
    await migrator?.close();
  });

  it('returns only same-organization chunks from a similarity search', async () => {
    const rows = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) =>
        tx.execute<{ organization_id: string }>(sql`
          select organization_id from test_vector_chunks
          order by embedding <-> '[1,1,1]'
          limit 100
        `),
    );

    expect(rows.length).toBe(1);
    expect(rows[0]?.organization_id).toBe(orgA.organizationId);
  });

  it('returns nothing from a similarity search with no tenant context', async () => {
    const rows = await withoutTenantContext(db.db, async (tx) =>
      tx.execute(sql`
        select organization_id from test_vector_chunks
        order by embedding <-> '[1,1,1]'
        limit 100
      `),
    );
    expect(rows.length).toBe(0);
  });
});
