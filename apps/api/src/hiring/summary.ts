import { sql, withTenantContext, type Database } from '@platform/db';

import { parseStoredFit, type CallFit } from './requirements.js';
import type { Actor } from './jobs.service.js';

/** Rows per Home queue; `total` is always the true count. Matches the web's HOME_QUEUE_LIMIT. */
export const HOME_QUEUE_LIMIT = 8;

const QUEUES = ['readyForReview', 'notConnected', 'onHold', 'notCalled'] as const;
type Queue = (typeof QUEUES)[number];

export interface SummaryFunnel {
  total: number;
  notCalled: number;
  /** Calls that failed on people nobody has decided on yet. */
  notConnected: number;
  toReview: number;
  onHold: number;
  movedForward: number;
}

export interface SummaryQueueItem {
  jobId: string;
  jobTitle: string;
  candidateId: string;
  fullName: string;
  stage: string;
  callStatus: string;
  failureReason: string | null;
  lastCallAt: string | null;
  fit: CallFit | null;
}

export interface HiringSummaryResult {
  counts: { agents: number | null; openJobs: number; candidates: number };
  totals: { jobs: number };
  queues: Record<Queue, { total: number; items: SummaryQueueItem[] }>;
  /** `funnel` is null when the viewer cannot read candidates. */
  jobs: { jobId: string; jobTitle: string; jobStatus: string; funnel: SummaryFunnel | null }[];
}

/**
 * Every candidate with the latest phone call's state and the queue it sits in. The queue rules
 * are the web's `homeQueueOf` (apps/web/lib/hiring-people.ts): decided people and calls in
 * progress sit in none. Call status is derived exactly as the job candidate list does.
 */
const CLASSIFIED = (organizationId: string) => sql`
  select c.id, c.job_id, c.full_name, c.screening_status as st, c.created_at,
         vs.failure_reason, vs.called_at, vf.fit,
         case when c.screening_status in ('reviewed', 'declined') then null
              when vs.status = 'ended' then 'readyForReview'
              when vs.status = 'failed' then 'notConnected'
              when c.screening_status = 'screening' then 'onHold'
              when c.screening_status = 'new'
                   and coalesce(vs.status, '') not in ('pending', 'active') then 'notCalled'
         end as queue,
         case when vs.status = 'ended' then 'completed'
              when vs.status = 'failed' then 'failed'
              when vs.status in ('pending', 'active') then 'calling'
              else 'not_called'
         end as call_status
  from candidates c
  left join lateral (
    select v.status, v.failure_reason, coalesce(v.started_at, v.created_at) as called_at
    from voice_sessions v
    join agent_sessions s on s.id = v.session_id
    where v.organization_id = c.organization_id and v.job_id = c.job_id
      and v.candidate_id = c.id and s.channel = 'phone'
    order by v.started_at desc nulls last, v.created_at desc
    limit 1
  ) vs on true
  left join lateral (
    select v.fit
    from voice_sessions v
    where v.organization_id = c.organization_id and v.job_id = c.job_id
      and v.candidate_id = c.id and v.fit is not null
    order by v.started_at desc nulls last, v.created_at desc
    limit 1
  ) vf on true
  where c.organization_id = ${organizationId}`;

/**
 * GET /hiring/summary in three queries however many jobs there are: counts, per-job funnels
 * (GROUP BY), and the top rows of each queue (row_number window). Without `canReadCandidates`
 * the totals are real but no names, items or funnels leave the server (redesign decision 5).
 */
export async function loadHiringSummary(
  database: Database,
  actor: Actor,
  viewer: { canReadCandidates: boolean; canReadAgents: boolean },
): Promise<HiringSummaryResult> {
  const org = actor.organizationId;
  return withTenantContext(
    database.db,
    { organizationId: org, userId: actor.userId },
    async (tx) => {
      const [counts] = await tx.execute<{ agents: string; open_jobs: string; candidates: string }>(sql`
        select (select count(*) from agents where organization_id = ${org} and status <> 'archived')::text as agents,
               (select count(*) from jobs where organization_id = ${org} and status = 'open')::text as open_jobs,
               (select count(*) from candidates where organization_id = ${org})::text as candidates`);

      const jobRows = await tx.execute<Record<string, string | null>>(sql`
        select j.id, j.title, j.status,
               count(k.id)::text as total,
               count(*) filter (where k.st = 'reviewed')::text as moved,
               count(*) filter (where k.st = 'screening')::text as on_hold,
               count(*) filter (where k.queue = 'notCalled')::text as q_not_called,
               count(*) filter (where k.queue = 'readyForReview')::text as q_ready,
               count(*) filter (where k.queue = 'readyForReview' and k.st = 'new')::text as to_review,
               count(*) filter (where k.queue = 'notConnected')::text as q_not_connected,
               count(*) filter (where k.queue = 'onHold')::text as q_on_hold
        from jobs j
        left join (${CLASSIFIED(org)}) k on k.job_id = j.id
        where j.organization_id = ${org}
        group by j.id, j.title, j.status, j.created_at
        order by j.created_at desc`);

      const n = (v: string | null | undefined) => Number(v) || 0;
      const total: Record<Queue, number> = { readyForReview: 0, notConnected: 0, onHold: 0, notCalled: 0 };
      // Closed and archived jobs keep their funnel on the jobs list but ask nothing of anyone.
      const ACTIONABLE = new Set(['draft', 'open']);
      for (const r of jobRows) {
        if (!ACTIONABLE.has(String(r['status']))) continue;
        total.readyForReview += n(r['q_ready']);
        total.notConnected += n(r['q_not_connected']);
        total.onHold += n(r['q_on_hold']);
        total.notCalled += n(r['q_not_called']);
      }

      const queues = {} as HiringSummaryResult['queues'];
      for (const q of QUEUES) queues[q] = { total: total[q], items: [] };

      if (viewer.canReadCandidates) {
        const items = await tx.execute<{
          queue: Queue;
          job_id: string;
          title: string;
          id: string;
          full_name: string;
          st: string;
          call_status: string;
          failure_reason: string | null;
          called_at: string | null;
          fit: unknown;
        }>(sql`
          select * from (
            select k.queue, k.job_id, j.title, k.id, k.full_name, k.st, k.call_status, k.failure_reason,
                   k.called_at::text as called_at, k.fit,
                   row_number() over (
                     partition by k.queue
                     order by (k.fit->>'overall' = 'meets_all') desc nulls last,
                              k.called_at desc nulls last, k.created_at, k.id
                   ) as rn
            from (${CLASSIFIED(org)}) k
            join jobs j on j.id = k.job_id and j.organization_id = ${org}
            where k.queue is not null and j.status in ('draft', 'open')
          ) ranked
          where rn <= ${HOME_QUEUE_LIMIT}
          order by rn`);
        for (const r of items) {
          queues[r.queue].items.push({
            jobId: r.job_id,
            jobTitle: r.title,
            candidateId: r.id,
            fullName: r.full_name,
            stage: r.st,
            callStatus: r.call_status,
            failureReason: r.failure_reason,
            lastCallAt: r.called_at,
            fit: parseStoredFit(r.fit),
          });
        }
      }

      return {
        counts: {
          agents: viewer.canReadAgents ? n(counts?.agents) : null,
          openJobs: n(counts?.open_jobs),
          candidates: n(counts?.candidates),
        },
        totals: { jobs: jobRows.length },
        queues,
        jobs: jobRows.map((r) => ({
          jobId: r['id'] as string,
          jobTitle: r['title'] as string,
          jobStatus: r['status'] as string,
          funnel: viewer.canReadCandidates
            ? {
                total: n(r['total']),
                notCalled: n(r['q_not_called']),
                notConnected: n(r['q_not_connected']),
                toReview: n(r['to_review']),
                onHold: n(r['on_hold']),
                movedForward: n(r['moved']),
              }
            : null,
        })),
      };
    },
  );
}
