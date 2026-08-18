/**
 * Migration runner, shared by the CLI script and the test harness so both
 * apply the identical chain as the MIGRATOR role — never a superuser, never
 * the application role.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the migrations folder, resolved from this package. */
export const MIGRATIONS_FOLDER = join(here, '..', 'drizzle');

export async function runMigrations(migrationUrl: string): Promise<void> {
  // max: 1 — migrations must run serially on one connection.
  const client = postgres(migrationUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end({ timeout: 5 });
  }
}
