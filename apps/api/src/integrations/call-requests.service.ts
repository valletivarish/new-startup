/**
 * /v1 call requests: a queued intent to screen one candidate for one job.
 * request() records it and enqueues it; place() (the CALL_QUEUE worker) runs
 * consent, DND, calling-hours and limit checks, then dials through the same
 * voice path the dashboard uses.
 */

import { sql, withTenantContext, withoutTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { JobsService } from '../hiring/jobs.service.js';
import type { CallJob, JobQueue } from '../jobs/queue.js';
import { toE164Phone } from '../providers/elevenlabs/phone-e164.js';
import type { VoiceSessionService } from '../providers/elevenlabs/voice-session.service.js';
import { assertWithinLimits } from './call-limits.js';
import { nextCallingTime } from './calling-hours.js';
import { createNoopDndChecker, type DndChecker } from './dnd.js';
import { recordingLink, toV1Result, type V1Result } from './public-mappers.js';

export interface CallActor {
  readonly organizationId: string;
  readonly userId: string;
}

export type CallSource = 'api' | 'dashboard' | 'link';

export interface V1CallRequest {
  id: string;
  status: string;
  reason: string | null;
  notBefore: string | null;
  candidateId: string;
  jobId: string;
  result: V1Result | null;
}

export interface CallRequestsService {
  request(
    actor: CallActor & { apiKeyId: string | null; isTest: boolean },
    input: { jobId: string; candidateId: string; source: CallSource },
  ): Promise<V1CallRequest>;
  /** Worker side. Safe to run twice: only a queued/scheduled row is picked up. */
  place(job: CallJob): Promise<void>;
  get(
    actor: CallActor & { allowTranscript: boolean; allowRecording: boolean },
    id: string,
  ): Promise<V1CallRequest>;
  /** Fails `placing` rows abandoned for 10+ minutes (crash or deploy mid-place). */
  sweepStuckPlacing(now: Date): Promise<number>;
}

export interface CallRequestsDeps {
  database: Database;
  voice: Pick<VoiceSessionService, 'startOutboundPhoneCall'>;
  jobs: Pick<JobsService, 'get' | 'getCandidateResults'>;
  queue: Pick<JobQueue, 'enqueueCall'> | null;
  dnd?: DndChecker;
  now?: () => Date;
  /** Public API base URL, for recording links. */
  apiUrl?: string;
  logger?: { warn(obj: object, msg: string): void };
  /** Task 8: test-key placement on the fake line. Unwired → `test_mode_unavailable`. */
  placeTest?: (
    actor: CallActor,
    target: { jobId: string; candidateId: string },
  ) => Promise<{ voiceSessionId: string }>;
}

/** Real time, except a fixed CALLING_HOURS_NOW (ISO) outside production. */
export function defaultCallClock(env: NodeJS.ProcessEnv = process.env): () => Date {
  const fixed = env['NODE_ENV'] !== 'production' ? env['CALLING_HOURS_NOW'] : undefined;
  return fixed ? () => new Date(fixed) : () => new Date();
}

type Row = {
  id: string;
  status: string;
  reason: string | null;
  not_before: string | null;
  candidate_id: string;
  job_id: string;
  source: CallSource;
  is_test: boolean;
  voice_session_id: string | null;
};

/** No user acts in the sweeper; the nil uuid is the system-actor sentinel. */
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

const COLUMNS = sql`id, status, reason, not_before, candidate_id, job_id, source, is_test, voice_session_id`;

function toV1(row: Row, result: V1Result | null = null): V1CallRequest {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    notBefore: row.not_before ? new Date(row.not_before).toISOString() : null,
    candidateId: row.candidate_id,
    jobId: row.job_id,
    result,
  };
}

export function createCallRequestsService(deps: CallRequestsDeps): CallRequestsService {
  const { database, voice, jobs, queue } = deps;
  const dnd = deps.dnd ?? createNoopDndChecker();
  const now = deps.now ?? defaultCallClock();
  const tenant = <T>(a: CallActor, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, { organizationId: a.organizationId, userId: a.userId }, fn);

  async function finish(
    a: CallActor,
    id: string,
    status: string,
    fields: { reason?: string; notBefore?: Date; voiceSessionId?: string } = {},
  ) {
    await tenant(a, (tx) =>
      tx.execute(sql`
        update call_requests
        set status = ${status}, reason = ${fields.reason ?? null},
            not_before = ${fields.notBefore?.toISOString() ?? null},
            voice_session_id = coalesce(${fields.voiceSessionId ?? null}::uuid, voice_session_id),
            updated_at = now()
        where id = ${id} and organization_id = ${a.organizationId}
      `),
    );
  }

  return {
    async request(actor, input) {
      // Throws 404 for a job outside this org.
      await jobs.get(actor, input.jobId);
      // Test calls are free and never counted, so only live calls are limited.
      if (!actor.isTest) await assertWithinLimits(database, actor.organizationId, now());

      const row = await tenant(actor, async (tx) => {
        const cand = await tx.execute(sql`
          select 1 from candidates
          where id = ${input.candidateId} and job_id = ${input.jobId}
            and organization_id = ${actor.organizationId}
        `);
        if (cand.length === 0) throw ApiError.notFound('Candidate');
        const rows = await tx.execute<Row>(sql`
          insert into call_requests
            (organization_id, job_id, candidate_id, source, is_test, created_by_key_id)
          values (${actor.organizationId}, ${input.jobId}, ${input.candidateId},
                  ${input.source}, ${actor.isTest}, ${actor.apiKeyId})
          returning ${COLUMNS}
        `);
        return rows[0]!;
      });
      // ponytail: with jobs disabled (tests) nothing places the call; the caller runs place().
      try {
        await queue?.enqueueCall({
          organizationId: actor.organizationId,
          userId: actor.userId,
          callRequestId: row.id,
        });
      } catch {
        await finish(actor, row.id, 'failed', { reason: 'enqueue_failed' });
        throw new ApiError('service_unavailable', 'Could not queue the call. Retry shortly.');
      }
      return toV1(row);
    },

    async place(job) {
      const a = { organizationId: job.organizationId, userId: job.userId };
      const id = job.callRequestId;
      // Claim the row so a duplicate job cannot dial twice.
      const claimed = await tenant(a, (tx) =>
        tx.execute<Row & { phone: string | null; consented: boolean | null }>(sql`
          update call_requests cr
          set status = 'placing', updated_at = now()
          where cr.id = ${id} and cr.organization_id = ${a.organizationId}
            and cr.status in ('queued', 'scheduled')
          returning cr.id, cr.status, cr.reason, cr.not_before, cr.candidate_id, cr.job_id,
                    cr.source, cr.is_test, cr.voice_session_id,
                    (select c.phone from candidates c where c.id = cr.candidate_id) as phone,
                    (select c.consent_at is not null from candidates c
                      where c.id = cr.candidate_id) as consented
        `),
      );
      const row = claimed[0];
      if (!row) return;

      try {
        if (!row.consented) return await finish(a, id, 'skipped', { reason: 'no_consent' });

        const e164 = row.phone ? toE164Phone(row.phone) : null;
        if (e164 && (await dnd.check(e164)) === 'dnd') {
          return await finish(a, id, 'skipped', { reason: 'dnd' });
        }

        if (row.source === 'api') {
          const at = nextCallingTime(now());
          if (at) {
            await finish(a, id, 'scheduled', { notBefore: at });
            // A fixed CALLING_HOURS_NOW can yield a 09:00 already past in real
            // time; enqueueing that would run at once and reschedule forever.
            if (at.getTime() > Date.now()) await queue?.enqueueCall(job, at);
            else deps.logger?.warn({ callRequestId: id, notBefore: at }, 'calls.schedule_in_past');
            return;
          }
        }

        const target = { jobId: row.job_id, candidateId: row.candidate_id };
        if (row.is_test) {
          if (!deps.placeTest) {
            return await finish(a, id, 'failed', { reason: 'test_mode_unavailable' });
          }
          const placed = await deps.placeTest(a, target);
          return await finish(a, id, 'placed', { voiceSessionId: placed.voiceSessionId });
        }

        // startOutboundPhoneCall runs assertWithinLimits itself (shared with the dashboard).
        const jobRow = await jobs.get(a, row.job_id);
        if (!jobRow.agentId) throw ApiError.agentRequired();
        const placed = await voice.startOutboundPhoneCall(a, jobRow.agentId, {
          ...target,
          now: now(),
        });
        await finish(a, id, 'placed', { voiceSessionId: placed.voiceSessionId });
      } catch (error) {
        const reason = error instanceof ApiError ? error.code : 'internal';
        await finish(a, id, 'failed', { reason });
      }
    },

    async sweepStuckPlacing(at) {
      const cutoff = new Date(at.getTime() - 10 * 60_000).toISOString();
      // organizations is RLS-exempt; each org is then swept under its own context.
      const orgs = await withoutTenantContext(database.db, (tx) =>
        tx.execute<{ id: string }>(sql`select id from organizations`),
      );
      let swept = 0;
      // ponytail: one transaction per org; a security-definer sweep function if org count grows large.
      for (const org of orgs) {
        const rows = await tenant({ organizationId: org.id, userId: SYSTEM_USER }, (tx) =>
          tx.execute(sql`
            update call_requests
            set status = 'failed', reason = 'internal_error', updated_at = now()
            where organization_id = ${org.id} and status = 'placing'
              and voice_session_id is null and updated_at < ${cutoff}::timestamptz
            returning id
          `),
        );
        swept += rows.length;
      }
      return swept;
    },

    async get(actor, id) {
      const rows = await tenant(actor, (tx) =>
        tx.execute<Row>(sql`
          select ${COLUMNS} from call_requests
          where id = ${id} and organization_id = ${actor.organizationId}
        `),
      );
      const row = rows[0];
      if (!row) throw ApiError.notFound('Call');
      if (!row.voice_session_id) return toV1(row);

      const [job, packet] = await Promise.all([
        jobs.get(actor, row.job_id),
        jobs.getCandidateResults(actor, row.job_id, row.candidate_id),
      ]);
      const session = packet.sessions.find((s) => s.voiceSessionId === row.voice_session_id);
      return toV1(
        row,
        session
          ? toV1Result(session, actor.allowTranscript, actor.allowRecording, {
              questions: job.screeningQuestions,
              ...(deps.apiUrl ? { recordingUrl: recordingLink(deps.apiUrl, row.id) } : {}),
            })
          : null,
      );
    },
  };
}
