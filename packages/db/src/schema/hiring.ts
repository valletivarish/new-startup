import {
  boolean,
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

/** What HR says the role needs (migration 0035); validated by the API (hiring/requirements.ts). */
export type JobRequirementsRecord = {
  readonly salaryMinLakh: number | null;
  readonly salaryMaxLakh: number | null;
  readonly salaryFlexible: boolean;
  readonly maxNoticeDays: number | null;
  readonly workMode: 'on_site' | 'hybrid' | 'remote' | null;
  readonly officeDaysPerWeek: number | null;
  readonly city: string | null;
  readonly mustHaves: readonly string[];
  readonly nightShiftRequired: boolean;
  readonly replyWithinWorkingDays: number;
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
    /** Null = no requirements set, so calls get no fit (migration 0035). */
    requirements: jsonb('requirements').$type<JobRequirementsRecord>(),
    /** en | hi | bn | mr | te | ta | gu | ur | kn | ml | pa (migration 0033) — drives call language when job screening is set. */
    screeningLanguage: text('screening_language').notNull().default('en'),
    /** Voice engine arm for this job's calls (migration 0031). */
    voiceEngine: text('voice_engine').notNull().default('own_loop_google_voice'),
    /** Google Chirp 3 HD voice: kore (female) | iapetus (male) (migration 0033). */
    voicePersona: text('voice_persona').notNull().default('kore'),
    /** Google voice model: chirp3_hd | gemini_flash (migration 0033). */
    // Gemini quota is 10 req/min on the trial; raise it before launch or switch the default to chirp3_hd.
    ttsModel: text('tts_model').notNull().default('gemini_flash'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Created by a test-mode API key (migration 0032). */
    isTest: boolean('is_test').notNull().default(false),
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
      sql`${t.screeningLanguage} in ('en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'ml', 'pa')`,
    ),
    check('jobs_voice_persona_check', sql`${t.voicePersona} in ('kore', 'iapetus')`),
    check('jobs_tts_model_check', sql`${t.ttsModel} in ('chirp3_hd', 'gemini_flash')`),
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
    /** The customer's own id for this candidate (migration 0032). */
    externalId: text('external_id'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    consentSource: text('consent_source'),
    isTest: boolean('is_test').notNull().default(false),
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
    check(
      'candidates_consent_source_check',
      sql`${t.consentSource} is null or ${t.consentSource} in ('customer', 'candidate')`,
    ),
    uniqueIndex('candidates_org_job_external_unique')
      .on(t.organizationId, t.jobId, t.externalId)
      .where(sql`${t.externalId} is not null`),
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
