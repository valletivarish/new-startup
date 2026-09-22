import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import { AgentConfiguration } from '../agents/configuration.js';
import { computeFitPercent } from './fit-percent.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { criteriaFromProvisionSnapshot } from '../providers/elevenlabs/provision-snapshot.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface ScreeningQuestion {
  readonly id: string;
  readonly label: string;
}

export type ScreeningLanguage = 'en' | 'hi';

export interface JobRow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly agentId: string | null;
  readonly screeningQuestions: readonly ScreeningQuestion[];
  readonly screeningLanguage: ScreeningLanguage;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** True when knowledge docs are attached (file or saved JD text). */
  readonly hasJdDocs: boolean;
}

export interface JobKnowledgeSourceRow {
  readonly id: string;
  readonly name: string;
  readonly readyDocs: number;
  readonly pendingDocs: number;
  readonly failedDocs: number;
}

export interface JobCandidateRow {
  readonly id: string;
  readonly candidateId: string;
  readonly status: string;
  readonly fullName: string;
  readonly source: string;
  readonly phone: string | null;
  /**
   * Derived from the latest live phone screen for this job/candidate.
   * not_called | calling | completed | failed — never invented.
   */
  readonly callStatus: 'not_called' | 'calling' | 'completed' | 'failed';
  /** True only when a phone screen ended successfully (candidate was reached). */
  readonly callReceived: boolean;
}

export interface CandidateScreeningResults {
  readonly voiceSessionId: string | null;
  readonly status: string | null;
  readonly transcript: ReadonlyArray<{ role?: string; message?: string }> | null;
  readonly summary: string | null;
  readonly structuredAnswers: Readonly<Record<string, unknown>> | null;
  readonly costCredits: number | null;
  /** True when a recording may be available (ended screen with provider conversation). */
  readonly recordingAvailable: boolean;
  /**
   * Must-ask coverage (0–100). null when no criteria, or when structured
   * answers have not landed yet — never invent a market-standard score.
   */
  readonly fitPercent: number | null;
  readonly startedAt: string | null;
  readonly durationSeconds: number | null;
}

export interface CandidateScreeningPacket {
  /** Latest screen (back-compat for existing clients). */
  readonly results: CandidateScreeningResults;
  /** All screens for this job/candidate, newest first. */
  readonly sessions: readonly CandidateScreeningResults[];
}

export interface JobsService {
  list(actor: Actor): Promise<readonly JobRow[]>;
  get(actor: Actor, jobId: string): Promise<JobRow>;
  create(
    actor: Actor,
    input: {
      title: string;
      description?: string;
      agentId?: string;
      mustAskQuestions?: readonly string[];
      screeningLanguage?: ScreeningLanguage;
    },
  ): Promise<{ id: string }>;
  update(
    actor: Actor,
    jobId: string,
    input: {
      title?: string;
      description?: string;
      status?: string;
      agentId?: string | null;
      mustAskQuestions?: readonly string[];
      screeningLanguage?: ScreeningLanguage;
    },
  ): Promise<void>;
  attachKnowledge(actor: Actor, jobId: string, sourceId: string): Promise<void>;
  listKnowledge(
    actor: Actor,
    jobId: string,
  ): Promise<readonly JobKnowledgeSourceRow[]>;
  assignCandidate(
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<{ id: string }>;
  listCandidates(
    actor: Actor,
    jobId: string,
    opts?: {
      limit?: number;
      cursor?: string;
      status?: string;
      q?: string;
    },
  ): Promise<{
    candidates: readonly JobCandidateRow[];
    nextCursor: string | null;
    totals: {
      all: number;
      new: number;
      screening: number;
      reviewed: number;
    };
  }>;
  updateCandidateStatus(
    actor: Actor,
    jobId: string,
    candidateId: string,
    status: string,
  ): Promise<{ previous: string; status: string }>;
  updateCandidateStatuses(
    actor: Actor,
    jobId: string,
    updates: readonly { candidateId: string; status: string }[],
  ): Promise<
    readonly { candidateId: string; previous: string; status: string }[]
  >;
  listCandidateStageHistory(
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<
    readonly {
      id: string;
      previous: string | null;
      status: string | null;
      reason: string | null;
      actorUserId: string | null;
      actorName: string | null;
      createdAt: string;
    }[]
  >;
  getCandidateResults(
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<CandidateScreeningPacket>;
}

type JobRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  agent_id: string | null;
  screening_questions: unknown;
  screening_language: string;
  created_at: string;
  updated_at: string;
  has_jd_docs?: boolean | string | number | null;
};

const JOB_STATUSES = ['draft', 'open', 'closed'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const ASSIGNMENT_STATUSES = ['new', 'screening', 'reviewed'] as const;
type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

const SCREENING_LANGUAGES = ['en', 'hi'] as const;

type JobCandidateRecord = {
  id: string;
  candidate_id: string;
  status: string;
  full_name: string;
  source: string;
  phone: string | null;
  phone_call_status: string | null;
  created_at: string;
};

function deriveCallFlags(phoneCallStatus: string | null): {
  callStatus: JobCandidateRow['callStatus'];
  callReceived: boolean;
} {
  if (phoneCallStatus === 'pending' || phoneCallStatus === 'active') {
    return { callStatus: 'calling', callReceived: false };
  }
  if (phoneCallStatus === 'ended') {
    return { callStatus: 'completed', callReceived: true };
  }
  if (phoneCallStatus === 'failed') {
    return { callStatus: 'failed', callReceived: false };
  }
  return { callStatus: 'not_called', callReceived: false };
}

function toJobCandidate(r: JobCandidateRecord): JobCandidateRow {
  const flags = deriveCallFlags(r.phone_call_status);
  return {
    id: r.id,
    candidateId: r.candidate_id,
    status: r.status,
    fullName: r.full_name,
    source: r.source,
    phone: r.phone,
    callStatus: flags.callStatus,
    callReceived: flags.callReceived,
  };
}

function parseScreeningQuestions(raw: unknown): ScreeningQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreeningQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!id || !label) continue;
    out.push({ id, label });
  }
  return out;
}

/** string[] from API → stored { id: qN, label } */
export function toStoredScreeningQuestions(
  labels: readonly string[],
): ScreeningQuestion[] {
  return labels
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label, i) => ({ id: `q${i + 1}`, label }));
}

function toJob(r: JobRecord): JobRow {
  const lang = (SCREENING_LANGUAGES as readonly string[]).includes(
    r.screening_language,
  )
    ? (r.screening_language as ScreeningLanguage)
    : 'en';
  const hasJdDocs =
    r.has_jd_docs === true ||
    r.has_jd_docs === 1 ||
    r.has_jd_docs === '1' ||
    r.has_jd_docs === 't' ||
    r.has_jd_docs === 'true';
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    agentId: r.agent_id,
    screeningQuestions: parseScreeningQuestions(r.screening_questions),
    screeningLanguage: lang,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasJdDocs,
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

function assertScreeningLanguage(lang: string): ScreeningLanguage {
  if (!(SCREENING_LANGUAGES as readonly string[]).includes(lang)) {
    throw ApiError.validation([
      {
        field: 'screeningLanguage',
        message: `Must be one of: ${SCREENING_LANGUAGES.join(', ')}`,
      },
    ]);
  }
  return lang as ScreeningLanguage;
}

export function createJobsService(database: Database): JobsService {
  async function updateCandidateStatuses(
    actor: Actor,
    jobId: string,
    updates: readonly { candidateId: string; status: string }[],
  ): Promise<
    readonly { candidateId: string; previous: string; status: string }[]
  > {
    if (updates.length === 0) return [];
    const normalized = updates.map((u) => ({
      candidateId: u.candidateId,
      status: assertAssignmentStatus(u.status),
    }));

    return withTenantContext(
      database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) => {
        await loadJob(tx, actor, jobId, true);
        const results: {
          candidateId: string;
          previous: string;
          status: string;
        }[] = [];

        for (const u of normalized) {
          const current = await tx.execute<{ screening_status: string }>(sql`
            select screening_status
            from candidates
            where id = ${u.candidateId}
              and job_id = ${jobId}
              and organization_id = ${actor.organizationId}
            limit 1
          `);
          if (current.length === 0) throw ApiError.notFound('Job candidate');
          const previous = current[0]!.screening_status;
          if (previous === u.status) {
            results.push({
              candidateId: u.candidateId,
              previous,
              status: u.status,
            });
            continue;
          }
          const rows = await tx.execute<{ id: string }>(sql`
            update candidates set
              screening_status = ${u.status},
              updated_at = now()
            where id = ${u.candidateId}
              and job_id = ${jobId}
              and organization_id = ${actor.organizationId}
            returning id
          `);
          if (rows.length === 0) throw ApiError.notFound('Job candidate');
          results.push({
            candidateId: u.candidateId,
            previous,
            status: u.status,
          });
        }
        return results;
      },
    );
  }

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
             screening_questions, screening_language,
             created_at::text, updated_at::text,
             exists (
               select 1
               from job_knowledge_sources jks
               join knowledge_documents d
                 on d.source_id = jks.source_id
                and d.organization_id = jks.organization_id
                and d.status <> 'deleted'
               where jks.job_id = jobs.id
                 and jks.organization_id = ${actor.organizationId}
             ) as has_jd_docs
      from jobs
      where id = ${jobId} and organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update` : sql``}
    `);
    const job = rows[0];
    if (!job) throw ApiError.notFound('Job');
    return job;
  }

  async function loadJobCandidate(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    jobId: string,
    candidateId: string,
  ): Promise<void> {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from candidates
      where id = ${candidateId}
        and job_id = ${jobId}
        and organization_id = ${actor.organizationId}
    `);
    if (rows.length === 0) throw ApiError.notFound('Job candidate');
  }

  async function loadAgentCriteria(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    agentId: string,
  ): Promise<{ id: string; label: string }[]> {
    const agentRows = await tx.execute<{
      configuration: unknown;
    }>(sql`
      select av.configuration
      from agents a
      join agent_versions av
        on av.id = a.current_version_id
       and av.organization_id = a.organization_id
      where a.id = ${agentId}
        and a.organization_id = ${actor.organizationId}
    `);
    const parsed = AgentConfiguration.safeParse(agentRows[0]?.configuration);
    if (!parsed.success) return [];
    return parsed.data.evaluation.criteria.map((c) => ({
      id: c.id,
      label: c.label,
    }));
  }

  return {
    async list(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<JobRecord>(sql`
            select id, title, description, status, agent_id,
                   screening_questions, screening_language,
                   created_at::text, updated_at::text,
                   exists (
                     select 1
                     from job_knowledge_sources jks
                     join knowledge_documents d
                       on d.source_id = jks.source_id
                      and d.organization_id = jks.organization_id
                      and d.status <> 'deleted'
                     where jks.job_id = jobs.id
                       and jks.organization_id = ${actor.organizationId}
                   ) as has_jd_docs
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

          const questions = toStoredScreeningQuestions(
            input.mustAskQuestions ?? [],
          );
          const language = input.screeningLanguage
            ? assertScreeningLanguage(input.screeningLanguage)
            : 'en';

          const rows = await tx.execute<{ id: string }>(sql`
            insert into jobs
              (organization_id, title, description, agent_id,
               screening_questions, screening_language, created_by_user_id)
            values (${actor.organizationId}, ${input.title},
                    ${input.description ?? ''},
                    ${input.agentId ?? null},
                    ${JSON.stringify(questions)}::jsonb,
                    ${language},
                    ${actor.userId})
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
      if (input.screeningLanguage !== undefined) {
        assertScreeningLanguage(input.screeningLanguage);
      }

      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId, true);

          if (input.agentId) {
            await loadAgent(tx, actor, input.agentId);
          }

          const questionsJson =
            input.mustAskQuestions !== undefined
              ? JSON.stringify(
                  toStoredScreeningQuestions(input.mustAskQuestions),
                )
              : null;

          await tx.execute(sql`
            update jobs set
              title = coalesce(${input.title ?? null}, title),
              description = coalesce(${input.description ?? null}, description),
              status = coalesce(${input.status ?? null}, status),
              agent_id = case
                when ${input.agentId !== undefined} then ${input.agentId ?? null}::uuid
                else agent_id
              end,
              screening_questions = case
                when ${questionsJson !== null} then ${questionsJson}::jsonb
                else screening_questions
              end,
              screening_language = coalesce(
                ${input.screeningLanguage ?? null},
                screening_language
              ),
              updated_at = now()
            where id = ${jobId} and organization_id = ${actor.organizationId}
          `);
        },
      );
    },

    async attachKnowledge(actor, jobId, sourceId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);

          const source = await tx.execute<{ id: string }>(sql`
            select id from knowledge_sources
            where id = ${sourceId} and organization_id = ${actor.organizationId}
              and status <> 'archived'
          `);
          if (source.length === 0) throw ApiError.notFound('Knowledge source');

          await tx.execute(sql`
            insert into job_knowledge_sources (organization_id, job_id, source_id)
            values (${actor.organizationId}, ${jobId}, ${sourceId})
            on conflict (job_id, source_id) do nothing
          `);
        },
      );
    },

    async listKnowledge(actor, jobId) {
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);
          const rows = await tx.execute<{
            id: string;
            name: string;
            ready_docs: string;
            pending_docs: string;
            failed_docs: string;
          }>(sql`
            select
              s.id,
              s.name,
              count(d.id) filter (where d.status = 'ready')::text as ready_docs,
              count(d.id) filter (
                where d.status in ('pending', 'processing')
              )::text as pending_docs,
              count(d.id) filter (where d.status = 'failed')::text as failed_docs
            from job_knowledge_sources j
            join knowledge_sources s
              on s.id = j.source_id and s.organization_id = j.organization_id
            left join knowledge_documents d
              on d.source_id = s.id
             and d.organization_id = s.organization_id
             and d.status <> 'deleted'
            where j.job_id = ${jobId}
              and j.organization_id = ${actor.organizationId}
              and s.status <> 'archived'
            group by s.id, s.name
            order by s.name
          `);
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            readyDocs: Number(r.ready_docs),
            pendingDocs: Number(r.pending_docs),
            failedDocs: Number(r.failed_docs),
          }));
        },
      );
    },

    async assignCandidate(actor, jobId, _candidateId) {
      // M4: job_candidates is read-only archive — no new writes.
      // Still resolve the job so cross-tenant probes stay 404 (IDOR hygiene).
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);
        },
      );
      throw ApiError.validation([
        {
          field: 'candidateId',
          message:
            'Assigning from a directory is no longer supported. Create the candidate under this job (POST /candidates with jobId).',
        },
      ]);
    },

    async listCandidates(actor, jobId, opts) {
      const limit =
        opts?.limit != null
          ? Math.min(Math.max(Math.floor(opts.limit), 1), 200)
          : null;
      const statusFilter =
        opts?.status &&
        (ASSIGNMENT_STATUSES as readonly string[]).includes(opts.status)
          ? opts.status
          : null;
      const after = opts?.cursor ? decodeCursor(opts.cursor) : null;
      const qRaw = opts?.q?.trim() ?? '';
      const q =
        qRaw.length > 0 && qRaw.length <= 120
          ? qRaw.replace(/[%_\\]/g, '')
          : null;
      const qLike = q ? `%${q}%` : null;

      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);

          const totalsRows = await tx.execute<{
            status: string;
            n: string;
          }>(sql`
            select screening_status as status, count(*)::text as n
            from candidates
            where job_id = ${jobId}
              and organization_id = ${actor.organizationId}
              ${
                qLike
                  ? sql`and (
                      full_name ilike ${qLike}
                      or coalesce(phone, '') ilike ${qLike}
                    )`
                  : sql``
              }
            group by screening_status
          `);
          const totals = {
            all: 0,
            new: 0,
            screening: 0,
            reviewed: 0,
          };
          for (const row of totalsRows) {
            const n = Number(row.n) || 0;
            totals.all += n;
            if (row.status === 'new') totals.new = n;
            else if (row.status === 'screening') totals.screening = n;
            else if (row.status === 'reviewed') totals.reviewed = n;
          }

          const rows = await tx.execute<JobCandidateRecord>(sql`
            select c.id, c.id as candidate_id, c.screening_status as status,
                   c.full_name, c.source, c.phone, c.created_at::text,
                   vs.status as phone_call_status
            from candidates c
            left join lateral (
              select v.status
              from voice_sessions v
              join agent_sessions s on s.id = v.session_id
              where v.organization_id = c.organization_id
                and v.job_id = c.job_id
                and v.candidate_id = c.id
                and s.channel = 'phone'
              order by v.started_at desc nulls last, v.created_at desc
              limit 1
            ) vs on true
            where c.job_id = ${jobId}
              and c.organization_id = ${actor.organizationId}
              ${
                statusFilter
                  ? sql`and c.screening_status = ${statusFilter}`
                  : sql``
              }
              ${
                qLike
                  ? sql`and (
                      c.full_name ilike ${qLike}
                      or coalesce(c.phone, '') ilike ${qLike}
                    )`
                  : sql``
              }
              ${
                after
                  ? sql`and (c.created_at, c.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                  : sql``
              }
            order by c.created_at, c.id
            ${limit != null ? sql`limit ${limit + 1}` : sql``}
          `);

          let nextCursor: string | null = null;
          const pageRows =
            limit != null && rows.length > limit
              ? rows.slice(0, limit)
              : [...rows];
          if (limit != null && rows.length > limit) {
            const last = pageRows[pageRows.length - 1];
            if (last) {
              nextCursor = encodeCursor({
                createdAt: last.created_at,
                id: last.id,
              });
            }
          }

          return {
            candidates: pageRows.map(toJobCandidate),
            nextCursor,
            totals,
          };
        },
      );
    },

    async updateCandidateStatus(actor, jobId, candidateId, status) {
      const [row] = await updateCandidateStatuses(actor, jobId, [
        { candidateId, status },
      ]);
      if (!row) throw ApiError.notFound('Job candidate');
      return { previous: row.previous, status: row.status };
    },

    updateCandidateStatuses,

    async listCandidateStageHistory(actor, jobId, candidateId) {
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadJob(tx, actor, jobId);
          await loadJobCandidate(tx, actor, jobId, candidateId);
          const rows = await tx.execute<{
            id: string;
            actor_user_id: string | null;
            actor_name: string | null;
            metadata: unknown;
            created_at: string;
          }>(sql`
            select e.id, e.actor_user_id, e.metadata, e.created_at::text,
                   coalesce(nullif(u.name, ''), u.email) as actor_name
            from audit_events e
            left join users u on u.id = e.actor_user_id
            where e.organization_id = ${actor.organizationId}
              and e.event_type = 'hiring.candidate_status_changed'
              and e.resource_type = 'candidate'
              and e.resource_id = ${candidateId}
              and coalesce(e.metadata->>'jobId', '') = ${jobId}
            order by e.created_at desc, e.id desc
            limit 50
          `);
          return rows.map((r) => {
            const meta =
              r.metadata &&
              typeof r.metadata === 'object' &&
              !Array.isArray(r.metadata)
                ? (r.metadata as Record<string, unknown>)
                : {};
            return {
              id: r.id,
              previous: typeof meta.from === 'string' ? meta.from : null,
              status: typeof meta.to === 'string' ? meta.to : null,
              reason: typeof meta.reason === 'string' ? meta.reason : null,
              actorUserId: r.actor_user_id,
              actorName: r.actor_name,
              createdAt: r.created_at,
            };
          });
        },
      );
    },

    async getCandidateResults(actor, jobId, candidateId) {
      const empty: CandidateScreeningResults = {
        voiceSessionId: null,
        status: null,
        transcript: null,
        summary: null,
        structuredAnswers: null,
        costCredits: null,
        recordingAvailable: false,
        fitPercent: null,
        startedAt: null,
        durationSeconds: null,
      };

      const packet = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const job = await loadJob(tx, actor, jobId);
          await loadJobCandidate(tx, actor, jobId, candidateId);

          const rows = await tx.execute<{
            id: string;
            status: string;
            transcript: unknown;
            summary: string | null;
            structured_answers: unknown;
            cost_credits: string | null;
            external_conversation_id: string | null;
            started_at: string;
            duration_seconds: number | null;
            provision_snapshot: unknown;
          }>(sql`
            select id, status, transcript, summary, structured_answers,
                   cost_credits::text, external_conversation_id,
                   started_at::text, duration_seconds, provision_snapshot
            from voice_sessions
            where organization_id = ${actor.organizationId}
              and job_id = ${jobId}
              and candidate_id = ${candidateId}
            order by started_at desc
            limit 50
          `);

          // Live Job/Agent criteria only for legacy sessions without a snapshot.
          let liveCriteria = parseScreeningQuestions(job.screening_questions);
          if (liveCriteria.length === 0 && job.agent_id) {
            liveCriteria = await loadAgentCriteria(tx, actor, job.agent_id);
          }

          const sessions: CandidateScreeningResults[] = rows.map((row) => {
            const structuredAnswers =
              row.structured_answers &&
              typeof row.structured_answers === 'object' &&
              !Array.isArray(row.structured_answers)
                ? (row.structured_answers as Record<string, unknown>)
                : null;
            const frozen = criteriaFromProvisionSnapshot(row.provision_snapshot);
            const criteria = frozen ?? liveCriteria;
            return {
              voiceSessionId: row.id,
              status: row.status,
              transcript: Array.isArray(row.transcript)
                ? (row.transcript as ReadonlyArray<{
                    role?: string;
                    message?: string;
                  }>)
                : null,
              summary: row.summary,
              structuredAnswers,
              costCredits:
                row.cost_credits !== null ? Number(row.cost_credits) : null,
              recordingAvailable:
                Boolean(row.external_conversation_id) &&
                (row.status === 'ended' || row.status === 'active'),
              fitPercent: computeFitPercent(criteria, structuredAnswers),
              startedAt: row.started_at,
              durationSeconds: row.duration_seconds,
            };
          });

          return {
            results: sessions[0] ?? empty,
            sessions,
          };
        },
      );

      return packet;
    },
  };
}
