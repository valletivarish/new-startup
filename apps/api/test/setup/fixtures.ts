import { sql, createDatabase, withTenantContext, type Database } from '@platform/db';
import type { SystemRole } from '@platform/permissions';

export interface TestOrg {
  readonly organizationId: string;
  readonly ownerUserId: string;
}

export function appDatabase(): Database {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL not set — global setup did not run');
  return createDatabase({ url, maxConnections: 5 });
}

export function migratorDatabase(): Database {
  const url = process.env['TEST_DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('TEST_DATABASE_MIGRATION_URL not set');
  return createDatabase({ url, maxConnections: 2 });
}

/**
 * Superuser connection — BYPASSES row-level security. Test verification and
 * state manipulation ONLY: both app and migrator roles are (correctly)
 * subject to FORCE RLS, so with no tenant context they cannot even observe
 * the rows a test needs to assert about. Never used by application code.
 */
export function superDatabase(): Database {
  const url = process.env['TEST_DATABASE_SUPER_URL'];
  if (!url) throw new Error('TEST_DATABASE_SUPER_URL not set');
  return createDatabase({ url, maxConnections: 2 });
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.floor(Math.random() * 1e6)}`;
}

/** PostgreSQL `insufficient_privilege`, raised when a WITH CHECK fails. */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Asserts that an operation was refused by row-level security.
 *
 * drizzle wraps driver errors in a `DrizzleQueryError` whose message is only
 * the failed SQL, so matching on the top-level message would silently pass for
 * ANY query failure — including a typo. That would be a test that looks green
 * while proving nothing, which is worse than no test. Walk the cause chain and
 * insist on the actual PostgreSQL RLS rejection.
 */
export async function expectRlsDenied(
  operation: () => Promise<unknown>,
): Promise<void> {
  let raised: unknown;
  try {
    await operation();
  } catch (error) {
    raised = error;
  }

  if (raised === undefined) {
    throw new Error(
      'Expected row-level security to refuse this operation, but it succeeded.',
    );
  }

  const chain: unknown[] = [];
  for (let e: unknown = raised, depth = 0; e && depth < 5; depth += 1) {
    chain.push(e);
    e = (e as { cause?: unknown }).cause;
  }

  const denied = chain.some((e) => {
    const code = (e as { code?: string }).code;
    const message = (e as { message?: string }).message ?? '';
    return (
      code === INSUFFICIENT_PRIVILEGE || /row-level security/i.test(message)
    );
  });

  if (!denied) {
    const detail = chain
      .map((e) => {
        const code = (e as { code?: string }).code ?? '-';
        const message = (e as { message?: string }).message ?? String(e);
        return `[${code}] ${message}`;
      })
      .join('\n  caused by: ');
    throw new Error(
      `Operation failed, but NOT because of row-level security:\n  ${detail}`,
    );
  }
}

export async function roleId(db: Database, key: SystemRole): Promise<string> {
  const rows = await db.db.execute<{ id: string }>(
    sql`select id from roles where organization_id is null and key = ${key}`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`system role not seeded: ${key}`);
  return id;
}

export async function createUser(db: Database, label = 'user'): Promise<string> {
  const rows = await db.db.execute<{ id: string }>(sql`
    insert into users (name, email)
    values (${label}, ${`${unique(label)}@example.test`})
    returning id
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('failed to create user');
  return id;
}

/**
 * Creates an organization with an Owner membership.
 *
 * Note how the membership insert must happen INSIDE the organization's tenant
 * context — the RLS WITH CHECK on `organization_memberships` refuses a write
 * whose `organization_id` does not match `current_org_id()`. The fixtures
 * exercise the same constraint the application does.
 */
export async function createOrgWithOwner(
  db: Database,
  label = 'org',
): Promise<TestOrg> {
  const orgRows = await db.db.execute<{ id: string }>(sql`
    insert into organizations (name, slug)
    values (${label}, ${unique(label)})
    returning id
  `);
  const organizationId = orgRows[0]?.id;
  if (!organizationId) throw new Error('failed to create organization');

  const ownerUserId = await createUser(db, `${label}-owner`);
  const owner = await roleId(db, 'owner');

  await withTenantContext(
    db.db,
    { organizationId, userId: ownerUserId },
    async (tx) => {
      await tx.execute(sql`
        insert into organization_memberships (organization_id, user_id, role_id)
        values (${organizationId}, ${ownerUserId}, ${owner})
      `);
    },
  );

  return { organizationId, ownerUserId };
}

export async function addMember(
  db: Database,
  org: TestOrg,
  role: SystemRole,
  label = 'member',
): Promise<string> {
  const userId = await createUser(db, label);
  const rid = await roleId(db, role);
  await withTenantContext(
    db.db,
    { organizationId: org.organizationId, userId: org.ownerUserId },
    async (tx) => {
      await tx.execute(sql`
        insert into organization_memberships (organization_id, user_id, role_id)
        values (${org.organizationId}, ${userId}, ${rid})
      `);
    },
  );
  return userId;
}

/**
 * Asserts an operation was refused by the DATABASE with a message matching
 * `pattern`. Like `expectRlsDenied`, this walks the cause chain: drizzle's
 * wrapper message is only the failed SQL, so matching the top-level message
 * would pass for any failure at all.
 */
export async function expectDatabaseRejection(
  operation: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let raised: unknown;
  try {
    await operation();
  } catch (error) {
    raised = error;
  }
  if (raised === undefined) {
    throw new Error('Expected the database to refuse this operation, but it succeeded.');
  }

  const chain: unknown[] = [];
  for (let e: unknown = raised, depth = 0; e && depth < 5; depth += 1) {
    chain.push(e);
    e = (e as { cause?: unknown }).cause;
  }

  const matched = chain.some((e) =>
    pattern.test((e as { message?: string }).message ?? ''),
  );
  if (!matched) {
    const detail = chain
      .map((e) => (e as { message?: string }).message ?? String(e))
      .join('\n  caused by: ');
    throw new Error(
      `Operation failed, but not with ${pattern}:\n  ${detail}`,
    );
  }
}
