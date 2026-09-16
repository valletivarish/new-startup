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
  };
}
