/**
 * Boots a real PostgreSQL instance for the test suite.
 *
 * `07_CODING_RULES` §14 makes this non-negotiable: row-level security cannot
 * be tested against a mocked or in-memory database. A green suite against a
 * fake proves nothing about tenant isolation, which is the single most
 * important security property in the platform.
 *
 * The container is bootstrapped with the same init scripts as local
 * development, so the roles under test are the real ones — a non-owner
 * application role with no BYPASSRLS.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { runMigrations } from '@platform/db';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const initDir = join(repoRoot, 'docker', 'postgres', 'init');

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  const initFiles = readdirSync(initDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      source: join(initDir, f),
      target: `/docker-entrypoint-initdb.d/${f}`,
    }));

  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    // The init scripts reference the database by name.
    .withDatabase('platform')
    .withUsername('postgres')
    .withPassword('postgres_test')
    .withCopyFilesToContainer(initFiles)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  const migrationUrl = `postgresql://platform_migrator:migrator_local_dev@${host}:${port}/platform`;
  const appUrl = `postgresql://platform_app:app_local_dev@${host}:${port}/platform`;
  const superUrl = container.getConnectionUri();

  // Apply migrations as the MIGRATOR role, exactly as production would —
  // never as a superuser, so the tests exercise the real privilege split.
  await runMigrations(migrationUrl);

  process.env['TEST_DATABASE_URL'] = appUrl;
  process.env['TEST_DATABASE_MIGRATION_URL'] = migrationUrl;
  process.env['TEST_DATABASE_SUPER_URL'] = superUrl;
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
