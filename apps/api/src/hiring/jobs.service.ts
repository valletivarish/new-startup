import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface JobRow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly agentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobCandidateRow {
  readonly id: string;
  readonly candidateId: string;
  readonly status: string;
  readonly fullName: string;
  readonly source: string;
}

export interface CandidateScreeningResults {
  readonly voiceSessionId: string | null;
  readonly status: string | null;
  readonly transcript: readonly unknown[] | null;
  readonly summary: string | null;
  readonly structuredAnswers: Readonly<Record<string, unknown>> | null;
  readonly costCredits: number | null;
}

export interface JobsService {
  list(actor: Actor): Promise<readonly JobRow[]>;
  get(actor: Actor, jobId: string): Promise<JobRow>;
  create(
    actor: Actor,
    input: { title: string; description?: string; agentId?: string },
  ): Promise<{ id: string }>;
  update(
    actor: Actor,
    jobId: string,
    input: {
      title?: string;
      description?: string;
      status?: string;
      agentId?: string | null;
    },
  ): Promise<void>;
  assignCandidate(
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<{ id: string }>;
  listCandidates(
    actor: Actor,
    jobId: string,
  ): Promise<readonly JobCandidateRow[]>;
  updateCandidateStatus(
    actor: Actor,
    jobId: string,
    candidateId: string,
    status: string,
  ): Promise<void>;
  getCandidateResults(
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<CandidateScreeningResults>;
}

type JobRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
};

const JOB_STATUSES = ['draft', 'open', 'closed'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const ASSIGNMENT_STATUSES = ['new', 'screening', 'reviewed'] as const;
type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

type JobCandidateRecord = {
  id: string;
  candidate_id: string;
  status: string;
  full_name: string;
  source: string;
};

function toJob(r: JobRecord): JobRow {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    agentId: r.agent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function assertJobStatus(status: string): JobStatus {
  if (!(JOB_STATUSES as readonly string[]).includes(status)) {
    throw ApiError.validation([
      { field: 'status', message: `Must be one of: ${JOB_STATUSES.join(', ')}` },
    ]);
  }
  return status as JobStatus;
}

function assertAssignmentStatus(status: string): AssignmentStatus {
  if (!(ASSIGNMENT_STATUSES as readonly string[]).includes(status)) {
    throw ApiError.validation([
      {
        field: 'status',
        message: `Must be one of: ${ASSIGNMENT_STATUSES.join(', ')}`,
      },
    ]);
  }
  return status as AssignmentStatus;
}

function toJobCandidate(r: JobCandidateRecord): JobCandidateRow {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    status: r.status,
    fullName: r.full_name,
    source: r.source,
  };
}

export function createJobsService(database: Database): JobsService {
  async function loadAgent(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    agentId: string,
  ): Promise<void> {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from agents
      where id = ${agentId} and organization_id = ${actor.organizationId}
    `);
    if (rows.length === 0) throw ApiError.notFound('Agent');
  }

  async function loadJob(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    jobId: string,
    forUpdate = false,
  ): Promise<JobRecord> {
    const rows = await tx.execute<JobRecord>(sql`
      select id, title, description, status, agent_id,
             created_at::text, updated_at::text
      from jobs
      where id = ${jobId} and organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update` : sql``}
    `);
    const job = rows[0];
    if (!job) throw ApiError.notFound('Job');
    return job;
  }

  async function loadCandidate(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    candidateId: string,
  ): Promise<void> {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from candidates
      where id = ${candidateId} and organization_id = ${actor.organizationId}
    `);
    if (rows.length === 0) throw ApiError.notFound('Candidate');
  }

  async function loadAssignment(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<void> {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from job_candidates
      where job_id = ${jobId}
        and candidate_id = ${candidateId}
        and organization_id = ${actor.organizationId}
    `);
    if (rows.length === 0) throw ApiError.notFound('Job candidate');
  }

  return {
    async list(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<JobRecord>(sql`
            select id, title, description, status, agent_id,
                   created_at::text, updated_at::text
            from jobs
            where organization_id = ${actor.organizationId}
            order by created_at desc
          `),
      );
      return rows.map(toJob);
    },

    async get(actor, jobId) {
      const job = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadJob(tx, actor, jobId),
      );
      return toJob(job);
    },

    async create(actor, input) {
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          if (input.agentId) {
            await loadAgent(tx, actor, input.agentId);
          }

          const rows = await tx.execute<{ id: string }>(sql`
            insert into jobs
              (organization_id, title, description, agent_id, created_by_user_id)
            values (${actor.organizationId}, ${input.title},
                    ${input.description ?? ''},
                    ${input.agentId ?? null}, ${actor.userId})
            returning id
          `);
          const id = rows[0]?.id;
          if (!id) throw new Error('job insert returned no id');
          return { id };
        },
      );
    },

    async update(actor, jobId, input) {
      if (input.status !== undefined) {
        assertJobStatus(input.status);
      }

      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId, true);

          if (input.agentId) {
            await loadAgent(tx, actor, input.agentId);
          }

          if (input.agentId !== undefined) {
            await tx.execute(sql`
              update jobs set
                title = coalesce(${input.title ?? null}, title),
                description = coalesce(${input.description ?? null}, description),
                status = coalesce(${input.status ?? null}, status),
                agent_id = ${input.agentId},
                updated_at = now()
              where id = ${jobId} and organization_id = ${actor.organizationId}
            `);
          } else {
            await tx.execute(sql`
              update jobs set
                title = coalesce(${input.title ?? null}, title),
                description = coalesce(${input.description ?? null}, description),
                status = coalesce(${input.status ?? null}, status),
                updated_at = now()
              where id = ${jobId} and organization_id = ${actor.organizationId}
            `);
          }
        },
      );
    },

    async assignCandidate(actor, jobId, candidateId) {
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);
          await loadCandidate(tx, actor, candidateId);

          try {
            const rows = await tx.execute<{ id: string }>(sql`
              insert into job_candidates
                (organization_id, job_id, candidate_id, status)
              values (${actor.organizationId}, ${jobId}, ${candidateId}, 'new')
              returning id
            `);
            const id = rows[0]?.id;
            if (!id) throw new Error('job_candidates insert returned no id');
            return { id };
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                'This candidate is already assigned to this job',
              );
            }
            throw error;
          }
        },
      );
    },

    async listCandidates(actor, jobId) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);
          return tx.execute<JobCandidateRecord>(sql`
            select jc.id, jc.candidate_id, jc.status,
                   c.full_name, c.source
            from job_candidates jc
            inner join candidates c
              on c.id = jc.candidate_id
             and c.organization_id = jc.organization_id
            where jc.job_id = ${jobId}
              and jc.organization_id = ${actor.organizationId}
            order by jc.id
          `);
        },
      );
      return rows.map(toJobCandidate);
    },

    async updateCandidateStatus(actor, jobId, candidateId, status) {
      assertAssignmentStatus(status);

      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId, true);

          const rows = await tx.execute<{ id: string }>(sql`
            update job_candidates set status = ${status}
            where job_id = ${jobId}
              and candidate_id = ${candidateId}
              and organization_id = ${actor.organizationId}
            returning id
          `);
          if (rows.length === 0) throw ApiError.notFound('Job candidate');
        },
      );
    },

    async getCandidateResults(actor, jobId, candidateId) {
      const row = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);
          await loadCandidate(tx, actor, candidateId);
          await loadAssignment(tx, actor, jobId, candidateId);

          const rows = await tx.execute<{
            id: string;
            status: string;
            transcript: unknown;
            summary: string | null;
            structured_answers: unknown;
            cost_credits: string | null;
          }>(sql`
            select id, status, transcript, summary, structured_answers,
                   cost_credits::text
            from voice_sessions
            where organization_id = ${actor.organizationId}
              and job_id = ${jobId}
              and candidate_id = ${candidateId}
            order by started_at desc
            limit 1
          `);
          return rows[0] ?? null;
        },
      );

      if (!row) {
        return {
          voiceSessionId: null,
          status: null,
          transcript: null,
          summary: null,
          structuredAnswers: null,
          costCredits: null,
        };
      }

      return {
        voiceSessionId: row.id,
        status: row.status,
        transcript: Array.isArray(row.transcript) ? row.transcript : null,
        summary: row.summary,
        structuredAnswers:
          row.structured_answers &&
          typeof row.structured_answers === 'object' &&
          !Array.isArray(row.structured_answers)
            ? (row.structured_answers as Record<string, unknown>)
            : null,
        costCredits: row.cost_credits !== null ? Number(row.cost_credits) : null,
      };
    },
  };
}
