import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations.js';
import { users } from './auth.js';
import { agents } from './agents.js';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    agentId: uuid('agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'jobs_status_check',
      sql`${t.status} in ('draft', 'open', 'closed')`,
    ),
    index('jobs_org_status_idx').on(t.organizationId, t.status),
    index('jobs_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    resumeText: text('resume_text'),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'candidates_source_check',
      sql`${t.source} in ('manual', 'resume')`,
    ),
    index('candidates_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

export const jobCandidates = pgTable(
  'job_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('new'),
  },
  (t) => [
    check(
      'job_candidates_status_check',
      sql`${t.status} in ('new', 'screening', 'reviewed')`,
    ),
    uniqueIndex('job_candidates_job_candidate_unique').on(t.jobId, t.candidateId),
    index('job_candidates_org_job_idx').on(t.organizationId, t.jobId),
    index('job_candidates_org_status_idx').on(t.organizationId, t.status),
  ],
);
