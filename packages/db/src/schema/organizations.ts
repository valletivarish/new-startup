/**
 * Organizations — the tenancy and commercial boundary.
 *
 * RLS status: exempt, per the exhaustive list in
 * `12_ARCHITECTURE_DECISIONS_FINAL.md` A6.
 *
 * NOTE FOR REVIEW: this table is protected by application-layer scoping only.
 * A policy is implementable (`id = current_org_id() OR EXISTS (...membership)`)
 * and would close the gap, but adding it would deviate from an accepted ADR on
 * implementation initiative, which `07_CODING_RULES` §3 forbids. Raised as a
 * recommended follow-up ADR instead — see the Phase 1 completion report.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './columns.js';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: citext('slug').notNull().unique(),
    /** active | suspended */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('organizations_status_idx').on(t.status)],
);
