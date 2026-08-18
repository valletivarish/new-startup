import { customType } from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text, backed by the PostgreSQL `citext` extension
 * (created in `docker/postgres/init/00-extensions-and-roles.sql`).
 *
 * drizzle-orm 0.45.2 does not ship a `citext` column helper, so it is mapped
 * here rather than degraded to `text`. This matters: email uniqueness is an
 * identity guarantee (ADR-005 — one identity, many organizations), and it
 * should be enforced by the database, not by remembering to call
 * `.toLowerCase()` at every call site.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
