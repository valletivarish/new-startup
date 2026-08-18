/**
 * Structural tests that must not be removed (`07_CODING_RULES` §14).
 *
 * These are what stop the security invariants decaying over time. A future
 * phase that adds `candidates` or `knowledge_chunks` and forgets the RLS
 * clause fails here, in CI, rather than silently shipping a cross-tenant leak.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, RLS_EXEMPT_TABLES, type Database } from '@platform/db';
import {
  PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
} from '@platform/permissions';

import { appDatabase } from './setup/fixtures.js';

let db: Database;

beforeAll(() => {
  db = appDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe('row-level security is enabled and forced on every tenant table', () => {
  it('every table with an organization_id column carries RLS', async () => {
    const rows = await db.db.execute<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>(sql`
      select c.relname          as table_name,
             c.relrowsecurity   as rls_enabled,
             c.relforcerowsecurity as rls_forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'organization_id'
        )
      order by c.relname
    `);

    const exempt = new Set<string>(RLS_EXEMPT_TABLES);
    const offenders = rows
      .filter((r) => !exempt.has(r.table_name))
      .filter((r) => !r.rls_enabled || !r.rls_forced)
      .map(
        (r) =>
          `${r.table_name} (enabled=${r.rls_enabled}, forced=${r.rls_forced})`,
      );

    expect(
      offenders,
      `Tables with organization_id but without ENABLE + FORCE row level security.\n` +
        `Add the policy in the same migration that creates the table, or add the\n` +
        `table to RLS_EXEMPT_TABLES with a documented justification.`,
    ).toEqual([]);

    // Guard against the test silently passing because it found nothing.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every RLS-enabled table actually has at least one policy', async () => {
    const rows = await db.db.execute<{ table_name: string; policies: string }>(sql`
      select c.relname as table_name,
             (select count(*)::text from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      order by c.relname
    `);

    expect(rows.length).toBeGreaterThan(0);
    const naked = rows.filter((r) => r.policies === '0').map((r) => r.table_name);
    expect(
      naked,
      'RLS is enabled but no policy exists — this denies everything, which is ' +
        'fail-closed but almost certainly a mistake.',
    ).toEqual([]);
  });

  it('the exempt list contains no table that does not exist', async () => {
    const rows = await db.db.execute<{ table_name: string }>(sql`
      select tablename as table_name from pg_tables where schemaname = 'public'
    `);
    const existing = new Set(rows.map((r) => r.table_name));
    const stale = RLS_EXEMPT_TABLES.filter((t) => !existing.has(t));
    expect(stale, 'RLS_EXEMPT_TABLES lists tables that no longer exist').toEqual(
      [],
    );
  });
});

describe('the seeded permission catalogue matches the code', () => {
  it('has exactly the permissions declared in @platform/permissions', async () => {
    const rows = await db.db.execute<{ key: string }>(
      sql`select key from permissions order by key`,
    );
    const inDb = rows.map((r) => r.key).sort();
    const inCode = [...PERMISSIONS].sort();
    expect(inDb).toEqual(inCode);
  });

  it('has 51 permissions, as the approved matrix specifies', async () => {
    const rows = await db.db.execute<{ n: string }>(
      sql`select count(*)::text as n from permissions`,
    );
    expect(rows[0]?.n).toBe('51');
    expect(PERMISSIONS.length).toBe(51);
  });

  it('flags exactly the personal-data permissions as sensitive', async () => {
    const rows = await db.db.execute<{ key: string }>(
      sql`select key from permissions where is_sensitive order by key`,
    );
    expect(rows.map((r) => r.key)).toEqual([...SENSITIVE_PERMISSIONS].sort());
  });

  it('has the seven system roles', async () => {
    const rows = await db.db.execute<{ key: string }>(
      sql`select key from roles where organization_id is null order by key`,
    );
    expect(rows.map((r) => r.key)).toEqual(
      SYSTEM_ROLE_DEFINITIONS.map((r) => r.key).sort(),
    );
  });

  it.each(SYSTEM_ROLE_DEFINITIONS.map((r) => [r.key, r] as const))(
    'role %s holds exactly its declared permissions',
    async (_key, role) => {
      const rows = await db.db.execute<{ key: string }>(sql`
        select p.key
        from roles r
        join role_permissions rp on rp.role_id = r.id
        join permissions p on p.id = rp.permission_id
        where r.organization_id is null and r.key = ${role.key}
        order by p.key
      `);
      expect(rows.map((r) => r.key)).toEqual([...role.permissions].sort());
    },
  );
});

describe('the personal-data boundary in the matrix', () => {
  const analyst = SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === 'analyst');
  const viewer = SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === 'viewer');

  it('an Analyst holds no personal-data permission', () => {
    expect(analyst).toBeDefined();
    for (const p of SENSITIVE_PERMISSIONS) {
      expect(analyst?.permissions, `analyst must not hold ${p}`).not.toContain(p);
    }
  });

  it('a Viewer holds no personal-data permission', () => {
    expect(viewer).toBeDefined();
    for (const p of SENSITIVE_PERMISSIONS) {
      expect(viewer?.permissions, `viewer must not hold ${p}`).not.toContain(p);
    }
  });

  it('only Owner, Administrator and Recruiter can read candidate contact details', async () => {
    const rows = await db.db.execute<{ key: string }>(sql`
      select r.key
      from roles r
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where r.organization_id is null and p.key = 'candidates.read_pii'
      order by r.key
    `);
    expect(rows.map((r) => r.key)).toEqual([
      'administrator',
      'owner',
      'recruiter',
    ]);
  });
});
