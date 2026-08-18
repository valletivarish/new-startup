import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated and applied with the MIGRATOR role, which owns the
 * tables. The application never uses this connection string — it connects as
 * `platform_app`, which has DML only and cannot alter schema or drop a policy.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATION_URL ??
      'postgresql://platform_migrator:migrator_local_dev@localhost:5434/platform',
  },
  strict: true,
  verbose: true,
});
