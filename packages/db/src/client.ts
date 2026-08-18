/**
 * Database client construction.
 *
 * The application connects as `platform_app`: not the table owner, no DDL, no
 * BYPASSRLS. It therefore cannot disable row-level security or drop a policy
 * on a table it can read (ADR-003).
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

export interface DbOptions {
  readonly url: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
  readonly onNotice?: (notice: unknown) => void;
}

export interface Database {
  readonly db: PostgresJsDatabase<Record<string, never>>;
  readonly sql: Sql;
  close(): Promise<void>;
}

export function createDatabase(options: DbOptions): Database {
  const client = postgres(options.url, {
    max: options.maxConnections ?? 10,
    // Transaction-mode pooling is the required posture: tenant context is set
    // with SET LOCAL inside an explicit transaction, so it is discarded on
    // commit and a pooled connection cannot carry a stale organization into
    // the next request. Session-level SET is forbidden (ADR-003).
    prepare: false,
    connection: {
      statement_timeout: options.statementTimeoutMs ?? 15_000,
      // Never let the client library adopt a role that could bypass policies.
      application_name: 'platform-api',
    },
    onnotice: options.onNotice ?? (() => {}),
  });

  return {
    db: drizzle(client),
    sql: client,
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
