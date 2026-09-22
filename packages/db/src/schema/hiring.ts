import {
  check,
  index,
  jsonb,
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

/** Must-ask screening question stored on the job ({ id, label }). */
export type JobScreeningQuestion = {
  readonly id: string;
  readonly label: string;
};

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
    /** Job-owned must-ask questions — not on the reusable agent. */
    screeningQuestions: jsonb('screening_questions')
      .$type<JobScreeningQuestion[]>()
      .notNull()
      .default([]),
    /** V1: en | hi — drives call language when job screening is set. */
    screeningLanguage: text('screening_language').notNull().default('en'),
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
    check(
      'jobs_screening_language_check',
      sql`${t.screeningLanguage} in ('en', 'hi')`,
    ),
    index('jobs_org_status_idx').on(t.organizationId, t.status),
    index('jobs_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

/**
 * Job-scoped candidates (Hiring V1).
 * Uniqueness: (job_id, phone) where phone is not null.
 * jobCandidates is retained as a legacy archive export — do not write new rows.
 */
export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    countryCode: text('country_code'),
    email: text('email'),
    resumeText: text('resume_text'),
    source: text('source').notNull().default('manual'),
    screeningStatus: text('screening_status').notNull().default('new'),
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
    check(
      'candidates_screening_status_check',
      sql`${t.screeningStatus} in ('new', 'screening', 'reviewed')`,
    ),
    uniqueIndex('candidates_job_phone_unique')
      .on(t.jobId, t.phone)
      .where(sql`${t.phone} is not null`),
    index('candidates_org_created_idx').on(t.organizationId, t.createdAt),
    index('candidates_org_job_idx').on(t.organizationId, t.jobId),
    index('candidates_org_job_created_idx').on(
      t.organizationId,
      t.jobId,
      t.createdAt,
    ),
  ],
);

/** @deprecated Legacy assignment table — archive only; new writes use candidates.job_id. */
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
