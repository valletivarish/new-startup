import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import { extractPhonesFromText } from './phone-extract.js';
import {
  previewCandidateImport,
  validateConfirmRows,
  type ConfirmImportRow,
  type ImportPreviewResult,
} from './candidate-import.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface CandidateRow {
  readonly id: string;
  readonly jobId: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly countryCode: string | null;
  readonly email: string | null;
  readonly resumeText: string | null;
  readonly source: string;
  readonly screeningStatus: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CandidatesService {
  list(
    actor: Actor,
    options: { jobId: string },
  ): Promise<readonly CandidateRow[]>;
  get(actor: Actor, candidateId: string): Promise<CandidateRow>;
  create(
    actor: Actor,
    input: {
      jobId: string;
      fullName: string;
      /** Required for new creates (M2); may be filled from resume text. */
      phone?: string;
      countryCode: string;
      email?: string;
      resumeText?: string;
    },
  ): Promise<{ id: string; phone: string; phoneFromResume: boolean }>;
  update(
    actor: Actor,
    candidateId: string,
    input: {
      fullName?: string;
      phone?: string | null;
      countryCode?: string | null;
      email?: string | null;
      resumeText?: string | null;
    },
  ): Promise<void>;
  delete(actor: Actor, candidateId: string): Promise<void>;
  exportRecord(actor: Actor, candidateId: string): Promise<CandidateRow>;
  previewImport(
    actor: Actor,
    jobId: string,
    csvText: string,
  ): Promise<ImportPreviewResult>;
  confirmImport(
    actor: Actor,
    jobId: string,
    rows: readonly ConfirmImportRow[],
  ): Promise<{
    created: readonly { id: string; fullName: string; phone: string }[];
    skipped: number;
    rejected: readonly {
      fullName: string;
      phone: string;
      issues: readonly string[];
    }[];
  }>;
}

type CandidateRecord = {
  id: string;
  job_id: string;
  full_name: string;
  phone: string | null;
  country_code: string | null;
  email: string | null;
  resume_text: string | null;
  source: string;
  screening_status: string;
  created_at: string;
  updated_at: string;
};

function toCandidate(r: CandidateRecord): CandidateRow {
  return {
    id: r.id,
    jobId: r.job_id,
    fullName: r.full_name,
    phone: r.phone,
    countryCode: r.country_code,
    email: r.email,
    resumeText: r.resume_text,
    source: r.source,
    screeningStatus: r.screening_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function resolveCreateFields(input: {
  phone?: string;
  resumeText?: string;
}): { phone: string; source: 'manual' | 'resume'; phoneFromResume: boolean } {
  const hasResume = input.resumeText !== undefined && input.resumeText.trim() !== '';
  const provided = input.phone?.trim() ?? '';

  if (provided) {
    return {
      phone: provided,
      source: hasResume ? 'resume' : 'manual',
      phoneFromResume: false,
    };
  }

  if (hasResume) {
    const extracted = extractPhonesFromText(input.resumeText!);
    const phone = extracted[0];
    if (phone) {
      return { phone, source: 'resume', phoneFromResume: true };
    }
  }

  throw ApiError.validation([
    {
      field: 'phone',
      message: 'Phone is required for new candidates',
    },
  ]);
}

export function createCandidatesService(database: Database): CandidatesService {
  async function loadCandidate(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    candidateId: string,
    forUpdate = false,
  ): Promise<CandidateRecord> {
    const rows = await tx.execute<CandidateRecord>(sql`
      select id, job_id, full_name, phone, country_code, email, resume_text, source,
             screening_status, created_at::text, updated_at::text
      from candidates
      where id = ${candidateId} and organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update` : sql``}
    `);
    const candidate = rows[0];
    if (!candidate) throw ApiError.notFound('Candidate');
    return candidate;
  }

  async function assertJob(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    jobId: string,
  ): Promise<void> {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from jobs
      where id = ${jobId} and organization_id = ${actor.organizationId}
    `);
    if (rows.length === 0) throw ApiError.notFound('Job');
  }

  return {
    async list(actor, options) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await assertJob(tx, actor, options.jobId);
          return tx.execute<CandidateRecord>(sql`
            select id, job_id, full_name, phone, country_code, email, resume_text, source,
                   screening_status, created_at::text, updated_at::text
            from candidates
            where organization_id = ${actor.organizationId}
              and job_id = ${options.jobId}
            order by created_at desc
          `);
        },
      );
      return rows.map(toCandidate);
    },

    async get(actor, candidateId) {
      const candidate = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadCandidate(tx, actor, candidateId),
      );
      return toCandidate(candidate);
    },

    async create(actor, input) {
      const { phone, source, phoneFromResume } = resolveCreateFields(input);
      const countryCode = input.countryCode.trim() || '+91';

      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await assertJob(tx, actor, input.jobId);

          try {
            const rows = await tx.execute<{ id: string }>(sql`
              insert into candidates
                (organization_id, job_id, full_name, phone, country_code,
                 email, resume_text, source, screening_status)
              values (
                ${actor.organizationId}, ${input.jobId}, ${input.fullName},
                ${phone}, ${countryCode},
                ${input.email ?? null}, ${input.resumeText ?? null},
                ${source}, 'new'
              )
              returning id
            `);
            const id = rows[0]?.id;
            if (!id) throw new Error('candidate insert returned no id');
            return { id, phone, phoneFromResume };
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                'A candidate with this phone already exists on this job',
              );
            }
            throw error;
          }
        },
      );
    },

    async update(actor, candidateId, input) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadCandidate(tx, actor, candidateId, true);

          try {
            await tx.execute(sql`
              update candidates set
                full_name = coalesce(${input.fullName ?? null}, full_name),
                phone = case when ${input.phone !== undefined} then ${input.phone ?? null} else phone end,
                country_code = case when ${input.countryCode !== undefined} then ${input.countryCode ?? null} else country_code end,
                email = case when ${input.email !== undefined} then ${input.email ?? null} else email end,
                resume_text = case when ${input.resumeText !== undefined} then ${input.resumeText ?? null} else resume_text end,
                updated_at = now()
              where id = ${candidateId} and organization_id = ${actor.organizationId}
            `);
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                'A candidate with this phone already exists on this job',
              );
            }
            throw error;
          }
        },
      );
    },

    async delete(actor, candidateId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadCandidate(tx, actor, candidateId, true);
          await tx.execute(sql`
            delete from candidates
            where id = ${candidateId} and organization_id = ${actor.organizationId}
          `);
        },
      );
    },

    async exportRecord(actor, candidateId) {
      const candidate = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadCandidate(tx, actor, candidateId),
      );
      return toCandidate(candidate);
    },

    async previewImport(actor, jobId, csvText) {
      const existing = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await assertJob(tx, actor, jobId);
          return tx.execute<{ phone: string | null }>(sql`
            select phone from candidates
            where organization_id = ${actor.organizationId}
              and job_id = ${jobId}
              and phone is not null
          `);
        },
      );
      const phones = new Set(
        existing.map((r) => r.phone).filter((p): p is string => Boolean(p)),
      );
      return previewCandidateImport(csvText, phones);
    },

    async confirmImport(actor, jobId, rows) {
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await assertJob(tx, actor, jobId);
          const existing = await tx.execute<{ phone: string | null }>(sql`
            select phone from candidates
            where organization_id = ${actor.organizationId}
              and job_id = ${jobId}
              and phone is not null
          `);
          const phones = new Set(
            existing.map((r) => r.phone).filter((p): p is string => Boolean(p)),
          );
          const { accepted, rejected: initialRejected } = validateConfirmRows(
            rows,
            phones,
          );
          const rejected = [...initialRejected];

          const created: { id: string; fullName: string; phone: string }[] = [];
          for (const row of accepted) {
            try {
              const inserted = await tx.execute<{ id: string }>(sql`
                insert into candidates
                  (organization_id, job_id, full_name, phone, country_code,
                   email, resume_text, source, screening_status)
                values (
                  ${actor.organizationId}, ${jobId}, ${row.fullName},
                  ${row.phone}, ${row.countryCode},
                  ${row.email ?? null}, null,
                  'manual', 'new'
                )
                returning id
              `);
              const id = inserted[0]?.id;
              if (id) {
                created.push({
                  id,
                  fullName: row.fullName,
                  phone: row.phone,
                });
                phones.add(row.phone);
              }
            } catch (error) {
              if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
                rejected.push({
                  row,
                  issues: ['duplicate_on_job'],
                });
                continue;
              }
              throw error;
            }
          }

          return {
            created,
            skipped: rejected.length,
            rejected: rejected.map((r) => ({
              fullName: r.row.fullName,
              phone: r.row.phone,
              issues: r.issues,
            })),
          };
        },
      );
    },
  };
}
