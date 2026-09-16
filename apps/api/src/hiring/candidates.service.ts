import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import { extractPhonesFromText } from './phone-extract.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface CandidateRow {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly resumeText: string | null;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CandidatesService {
  list(actor: Actor): Promise<readonly CandidateRow[]>;
  get(actor: Actor, candidateId: string): Promise<CandidateRow>;
  create(
    actor: Actor,
    input: {
      fullName: string;
      phone?: string;
      email?: string;
      resumeText?: string;
    },
  ): Promise<{ id: string }>;
  update(
    actor: Actor,
    candidateId: string,
    input: {
      fullName?: string;
      phone?: string | null;
      email?: string | null;
      resumeText?: string | null;
    },
  ): Promise<void>;
}

type CandidateRecord = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  resume_text: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

function toCandidate(r: CandidateRecord): CandidateRow {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email,
    resumeText: r.resume_text,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function resolveCreateFields(input: {
  phone?: string;
  email?: string;
  resumeText?: string;
}): { phone: string | null; source: 'manual' | 'resume' } {
  const hasResume = input.resumeText !== undefined && input.resumeText.trim() !== '';
  let phone = input.phone ?? null;

  if (!phone && hasResume) {
    const extracted = extractPhonesFromText(input.resumeText!);
    phone = extracted[0] ?? null;
  }

  return { phone, source: hasResume ? 'resume' : 'manual' };
}

export function createCandidatesService(database: Database): CandidatesService {
  async function loadCandidate(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    candidateId: string,
    forUpdate = false,
  ): Promise<CandidateRecord> {
    const rows = await tx.execute<CandidateRecord>(sql`
      select id, full_name, phone, email, resume_text, source,
             created_at::text, updated_at::text
      from candidates
      where id = ${candidateId} and organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update` : sql``}
    `);
    const candidate = rows[0];
    if (!candidate) throw ApiError.notFound('Candidate');
    return candidate;
  }

  return {
    async list(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<CandidateRecord>(sql`
            select id, full_name, phone, email, resume_text, source,
                   created_at::text, updated_at::text
            from candidates
            where organization_id = ${actor.organizationId}
            order by created_at desc
          `),
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
      const { phone, source } = resolveCreateFields(input);

      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const rows = await tx.execute<{ id: string }>(sql`
            insert into candidates
              (organization_id, full_name, phone, email, resume_text, source)
            values (${actor.organizationId}, ${input.fullName},
                    ${phone}, ${input.email ?? null},
                    ${input.resumeText ?? null}, ${source})
            returning id
          `);
          const id = rows[0]?.id;
          if (!id) throw new Error('candidate insert returned no id');
          return { id };
        },
      );
    },

    async update(actor, candidateId, input) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadCandidate(tx, actor, candidateId, true);

          await tx.execute(sql`
            update candidates set
              full_name = coalesce(${input.fullName ?? null}, full_name),
              phone = case when ${input.phone !== undefined} then ${input.phone ?? null} else phone end,
              email = case when ${input.email !== undefined} then ${input.email ?? null} else email end,
              resume_text = case when ${input.resumeText !== undefined} then ${input.resumeText ?? null} else resume_text end,
              updated_at = now()
            where id = ${candidateId} and organization_id = ${actor.organizationId}
          `);
        },
      );
    },
  };
}
