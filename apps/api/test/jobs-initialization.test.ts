/**
 * pg-boss initialization — privilege model and end-to-end job processing.
 *
 * ROOT CAUSE this pins: pg-boss installs its own schema and tables on
 * start(). Running as the restricted application role, PostgreSQL correctly
 * refused it. The fix was to move ALL pg-boss DDL into a migration performed
 * by the migrator, leaving the runtime role with DML only.
 *
 * These tests fail if anyone ever "fixes" a future pg-boss problem by
 * granting the application role CREATE.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import { sql } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';

function appUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL not set');
  return url;
}

describe('pg-boss objects are installed by the MIGRATOR, not at runtime', () => {
  let su: ReturnType<typeof superDatabase>;

  beforeAll(() => {
    su = superDatabase();
  });
  afterAll(async () => {
    await su?.close();
  });

  it('the pgboss schema and its tables exist after migration alone', async () => {
    // No application process has started at this point in the suite — the
    // objects must already be there, put there by the migration chain.
    const rows = await su.db.execute<{ n: string }>(
      sql`select count(*)::text as n from pg_tables where schemaname = 'pgboss'`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(6);
  });

  it('every pg-boss table is owned by the migrator, none by the app role', async () => {
    const rows = await su.db.execute<{ tableowner: string; tablename: string }>(
      sql`select tablename, tableowner from pg_tables where schemaname = 'pgboss'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const appOwned = rows
      .filter((r) => r.tableowner === 'platform_app')
      .map((r) => r.tablename);
    expect(
      appOwned,
      'the runtime role owns pg-boss tables — it performed DDL at runtime',
    ).toEqual([]);
    for (const row of rows) expect(row.tableowner).toBe('platform_migrator');
  });

  it('the application role holds NO create privilege anywhere', async () => {
    const rows = await su.db.execute<{
      pgboss: boolean;
      pub: boolean;
      db: boolean;
    }>(sql`
      select has_schema_privilege('platform_app', 'pgboss', 'CREATE') as pgboss,
             has_schema_privilege('platform_app', 'public', 'CREATE')  as pub,
             has_database_privilege('platform_app', current_database(), 'CREATE') as db
    `);
    expect(rows[0]?.pgboss, 'CREATE on pgboss must stay revoked').toBe(false);
    expect(rows[0]?.pub).toBe(false);
    expect(rows[0]?.db).toBe(false);
  });

  it('the application role still cannot bypass row-level security', async () => {
    const rows = await su.db.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = 'platform_app'`,
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
    expect(rows[0]?.rolsuper).toBe(false);
  });

  it('row-level security remains enabled AND forced on tenant tables', async () => {
    const rows = await su.db.execute<{ n: string }>(sql`
      select count(*)::text as n from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
        and relrowsecurity and relforcerowsecurity
    `);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(4);
  });
});

describe('the worker can process a job end to end as the runtime role', () => {
  let boss: PgBoss;
  const QUEUE = 'test.initialization.probe';

  beforeAll(async () => {
    boss = new PgBoss({
      connectionString: appUrl(),
      schema: 'pgboss',
      // Exactly the production configuration: the library performs no DDL.
      createSchema: false,
      migrate: false,
      max: 2,
    });
    await boss.start();
  }, 60_000);

  afterAll(async () => {
    await boss?.stop({ graceful: true });
  });

  it('starts, creates a queue, sends and processes a job with DML only', async () => {
    await boss.createQueue(QUEUE);
    const jobId = await boss.send(QUEUE, { probe: 'end-to-end' });
    expect(jobId).toBeTruthy();

    let received: unknown = null;
    await boss.work<{ probe: string }>(QUEUE, async (jobs) => {
      received = jobs[0]?.data;
    });

    // Poll rather than sleep blindly: the worker wakes on its own schedule.
    for (let i = 0; i < 40 && received === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(received, 'the worker never received the job').toEqual({
      probe: 'end-to-end',
    });
  }, 60_000);
});
