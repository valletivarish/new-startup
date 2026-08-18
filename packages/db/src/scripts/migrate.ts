/**
 * Applies pending migrations using the MIGRATOR role.
 *
 * The application never runs this. `platform_app` has DML only and cannot
 * alter schema — which is what stops it disabling row-level security or
 * dropping a policy on a table it can read (ADR-003).
 */

import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.js';

const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
  console.error(
    'DATABASE_MIGRATION_URL is not set. Copy .env.example to .env, or export it.',
  );
  process.exit(1);
}

try {
  console.log(`applying migrations from ${MIGRATIONS_FOLDER}`);
  await runMigrations(url);
  console.log('migrations applied');
} catch (error) {
  console.error('migration failed:', error);
  process.exitCode = 1;
}
