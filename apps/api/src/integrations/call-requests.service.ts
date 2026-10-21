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
import { assertNotClosedInZoho } from '../connectors/zoho/guard.js';
import { assertWithinLimits } from './call-limits.js';
import { nextCallingTime } from './calling-hours.js';
import { createNoopDndChecker, type DndChecker } from './dnd.js';
import { emitRequestFailed } from './events.js';
import { recordingLink, toV1Result, type V1Result } from './public-mappers.js';

export interface CallActor {
  readonly organizationId: string;
  readonly userId: string;
}

export type CallSource = 'api' | 'dashboard' | 'link' | 'zoho';

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
    input: { jobId: string; candidateId: string; source: CallSource; notBefore?: Date },
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
  /** enqueueWebhook delivers `call.failed` for requests that end without a call. */
  queue: (Pick<JobQueue, 'enqueueCall'> & Partial<Pick<JobQueue, 'enqueueWebhook'>>) | null;
  dnd?: DndChecker;
  now?: () => Date;
  /** Public API base URL, for recording links. */
  apiUrl?: string;
  logger?: { warn(obj: object, msg: string): void };
  /** Test-key placement on the fake line (OwnLoopService.placeTestCall). Unwired → `test_mode_unavailable`. */
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

  const emitFailed = (organizationId: string, id: string, reason: string) =>
    emitRequestFailed(database, queue, organizationId, id, reason, {
      error: (obj, msg) => deps.logger?.warn(obj, msg),
    });

  async function finish(
    a: CallActor,
    id: string,
    status: string,
    fields: { reason?: string; notBefore?: Date; voiceSessionId?: string } = {},
  ) {
    const rows = await tenant(a, (tx) =>
      tx.execute<{ voice_session_id: string | null }>(sql`
        update call_requests
        set status = ${status}, reason = ${fields.reason ?? null},
            not_before = ${fields.notBefore?.toISOString() ?? null},
            voice_session_id = coalesce(${fields.voiceSessionId ?? null}::uuid, voice_session_id),
            updated_at = now()
        where id = ${id} and organization_id = ${a.organizationId}
        returning voice_session_id
      `),
    );
    // A request that ends with no call never reaches the call-end paths: report it here.
    if ((status === 'skipped' || status === 'failed') && rows[0] && !rows[0].voice_session_id) {
      await emitFailed(a.organizationId, id, fields.reason ?? 'internal');
    }
  }

  return {
    async request(actor, input) {
      // Throws 404 for a job outside this org.
      await jobs.get(actor, input.jobId);
      // Refuse at once (409 closed_in_ats) rather than queue a call that can never be placed.
      await assertNotClosedInZoho(database, actor, input.candidateId);
      // Test calls are free and never counted, so only live calls are limited.
      if (!actor.isTest) await assertWithinLimits(database, actor.organizationId, now());

      const row = await tenant(actor, async (tx) => {
        // A test key only calls test jobs and a live key only live ones.
        const cand = await tx.execute(sql`
          select 1 from candidates c join jobs j on j.id = c.job_id
          where c.id = ${input.candidateId} and c.job_id = ${input.jobId}
            and c.organization_id = ${actor.organizationId} and j.is_test = ${actor.isTest}
        `);
        if (cand.length === 0) throw ApiError.notFound('Candidate');
        const rows = await tx.execute<Row>(sql`
          insert into call_requests
            (organization_id, job_id, candidate_id, source, is_test, created_by_key_id,
             status, not_before)
          values (${actor.organizationId}, ${input.jobId}, ${input.candidateId},
                  ${input.source}, ${actor.isTest}, ${actor.apiKeyId},
                  ${input.notBefore ? 'scheduled' : 'queued'},
                  ${input.notBefore?.toISOString() ?? null})
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
        }, input.notBefore);
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
        // Calls run in the requester's name; one who left the company must not dial.
        const member = await tenant(a, (tx) =>
          tx.execute(sql`
            select 1 from organization_memberships
            where organization_id = ${a.organizationId} and user_id = ${a.userId}
              and status = 'active'
          `),
        );
        if (member.length === 0) return await finish(a, id, 'failed', { reason: 'creator_inactive' });

        if (!row.consented) return await finish(a, id, 'skipped', { reason: 'no_consent' });

        const e164 = row.phone ? toE164Phone(row.phone) : null;
        if (e164 && (await dnd.check(e164)) === 'dnd') {
          return await finish(a, id, 'skipped', { reason: 'dnd' });
        }

        const target = { jobId: row.job_id, candidateId: row.candidate_id };
        // Test calls ring the fake line, not a person: no calling-hours hold.
        if (row.is_test) {
          if (!deps.placeTest) {
            return await finish(a, id, 'failed', { reason: 'test_mode_unavailable' });
          }
          const placed = await deps.placeTest(a, target);
          return await finish(a, id, 'placed', { voiceSessionId: placed.voiceSessionId });
        }

        if (row.source !== 'dashboard') {
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

        // startOutboundPhoneCall runs assertWithinLimits itself (shared with the dashboard).
        const jobRow = await jobs.get(a, row.job_id);
        if (!jobRow.agentId) throw ApiError.agentRequired();
        const placed = await voice.startOutboundPhoneCall(a, jobRow.agentId, {
          ...target,
          now: now(),
        });
        await finish(a, id, 'placed', { voiceSessionId: placed.voiceSessionId });
      } catch (error) {
        // A limit hit is a throttle: hold the call until the limit resets, then retry.
        const resetsAt = error instanceof ApiError ? error.details?.['resetsAt'] : undefined;
        if (typeof resetsAt === 'string') {
          const at = new Date(resetsAt);
          await finish(a, id, 'scheduled', { notBefore: at });
          // Never sooner than a minute in real time, so a fixed clock cannot spin.
          await queue?.enqueueCall(job, new Date(Math.max(at.getTime(), Date.now() + 60_000)));
          return;
        }
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
          tx.execute<{ id: string }>(sql`
            update call_requests
            set status = 'failed', reason = 'internal_error', updated_at = now()
            where organization_id = ${org.id} and status = 'placing'
              and voice_session_id is null and updated_at < ${cutoff}::timestamptz
            returning id
          `),
        );
        for (const r of rows) await emitFailed(org.id, r.id, 'internal_error');
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
