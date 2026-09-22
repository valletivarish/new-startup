/**
 * Re-exported from drizzle so application code never imports the ORM
 * directly. This is not a convenience: pnpm resolves a separate drizzle
 * instance per distinct optional-peer set, and two instances produce
 * structurally identical but non-assignable types. Routing every consumer
 * through this package guarantees one instance — and keeps the ORM an
 * implementation detail of the data layer, per the modular boundaries rule.
 */
export { sql } from 'drizzle-orm';

export * as schema from './schema/index.js';
export {
  RLS_BOOTSTRAP_TABLES,
  RLS_EXEMPT_TABLES,
} from './schema/index.js';

export { createDatabase, type Database, type DbOptions } from './client.js';

export {
  withActorContext,
  withInvitationContext,
  withTenantContext,
  withoutTenantContext,
  type TenantContext,
  type TenantTransaction,
} from './tenant-context.js';

/**
 * The concrete drizzle database type. Exported so application and test code
 * can name it without importing drizzle directly — see the note on `sql`.
 */
export type { PostgresJsDatabase as PlatformDatabase } from 'drizzle-orm/postgres-js';

export { runMigrations } from './migrate.js';

export {
  backfillJobScreeningFromAgents,
  runBackfillJobScreeningDml,
  type BackfillJobScreeningResult,
} from './backfill-job-screening-from-agents.js';
