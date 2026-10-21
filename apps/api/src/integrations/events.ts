/**
 * Call events. When a call ends, emitCallEvent records one webhook_deliveries
 * row per subscribed endpoint and queues it. Called from every call-end path,
 * which can repeat (reconcile), so it emits at most once per call.
 */

import { randomUUID } from 'node:crypto';
import { sql, withTenantContext, type Database } from '@platform/db';

import { callOutcome } from '../costs/costs.service.js';
import { createJobsService } from '../hiring/jobs.service.js';
import type { JobQueue } from '../jobs/queue.js';
import { recordingLink, toV1Result } from './public-mappers.js';

export const WEBHOOK_EVENTS = ['call.completed', 'call.failed', 'ticket.updated'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

type Logger = { error(obj: object, msg: string): void };
type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];
type WebhookQueue = { enqueueWebhook?: JobQueue['enqueueWebhook'] } | null;

/** One delivery per subscribed endpoint, unless this call already has an event. Caller holds the call's advisory lock. */
async function recordOnce(
  tx: Tx,
  organizationId: string,
  type: 'call.completed' | 'call.failed',
  data: { callId: string } & Record<string, unknown>,
): Promise<string[]> {
  const seen = await tx.execute(sql`
    select 1 from webhook_deliveries
    where organization_id = ${organizationId} and payload->'data'->>'callId' = ${data.callId}
    limit 1
  `);
  if (seen.length > 0) return [];
  const payload = { id: `evt_${randomUUID()}`, type, createdAt: new Date().toISOString(), data };
  const rows = await tx.execute<{ id: string }>(sql`
    insert into webhook_deliveries (organization_id, endpoint_id, event, payload)
    select ${organizationId}, e.id, ${type}, ${JSON.stringify(payload)}::jsonb
    from webhook_endpoints e
    where e.organization_id = ${organizationId} and e.disabled_at is null
      and ${type} = any(e.events)
    returning id
  `);
  return rows.map((r) => r.id);
}

async function enqueueAll(
  queue: WebhookQueue,
  organizationId: string,
  deliveryIds: string[],
  logger: Logger,
): Promise<void> {
  for (const deliveryId of deliveryIds) {
    // ponytail: a failed enqueue leaves the row pending; the resend route recovers it.
    await queue?.enqueueWebhook?.({ organizationId, deliveryId }).catch((error: unknown) =>
      logger.error({ err: (error as Error).message, deliveryId }, 'webhooks.enqueue_failed'),
    );
  }
}

/**
 * `ticket.updated` to every endpoint subscribed to it (staff replied, status changed).
 * Not de-duplicated: each change is its own event. Never throws.
 */
export async function emitTicketEvent(
  database: Database,
  queue: WebhookQueue,
  organizationId: string,
  data: { ticketId: string } & Record<string, unknown>,
  logger: Logger = { error: (obj, msg) => console.error(msg, obj) },
): Promise<void> {
  try {
    const payload = { id: `evt_${randomUUID()}`, type: 'ticket.updated', createdAt: new Date().toISOString(), data };
    const rows = await withTenantContext(database.db, { organizationId, userId: SYSTEM_USER }, (tx) =>
      tx.execute<{ id: string }>(sql`
        insert into webhook_deliveries (organization_id, endpoint_id, event, payload)
        select ${organizationId}, e.id, 'ticket.updated', ${JSON.stringify(payload)}::jsonb
        from webhook_endpoints e
        where e.organization_id = ${organizationId} and e.disabled_at is null
          and 'ticket.updated' = any(e.events)
        returning id
      `),
    );
    await enqueueAll(queue, organizationId, rows.map((r) => r.id), logger);
  } catch (error) {
    logger.error({ err: (error as Error).message, organizationId }, 'webhooks.emit_failed');
  }
}

type CallEventData = {
  jobId: string;
  candidateId: string;
  externalId: string | null;
  isTest: boolean;
  result: ReturnType<typeof toV1Result>;
};

/**
 * The event a call's voice session produces, or null when it is none (not a
 * job screen, or not ended). `dataFor(callId)` builds the payload data for the
 * client's call id (the recording link carries it).
 */
async function buildCallEvent(
  database: Database,
  a: { organizationId: string; userId: string },
  voiceSessionId: string,
  apiUrl: string | undefined,
): Promise<{ outcome: ReturnType<typeof callOutcome>; dataFor: (callId: string) => CallEventData } | null> {
  const sessions = await withTenantContext(database.db, a, (tx) =>
    tx.execute<{
      status: string;
      failure_reason: string | null;
      duration_seconds: number | null;
      transcript: unknown;
      job_id: string | null;
      candidate_id: string | null;
      is_test: boolean;
      external_id: string | null;
    }>(sql`
      select vs.status, vs.failure_reason, vs.duration_seconds, vs.transcript,
             vs.job_id, vs.candidate_id, vs.is_test, c.external_id
      from voice_sessions vs left join candidates c on c.id = vs.candidate_id
      where vs.id = ${voiceSessionId} and vs.organization_id = ${a.organizationId}
    `),
  );
  const vs = sessions[0];
  // Only screens of a candidate for a job are events; browser test calls are not.
  if (!vs?.job_id || !vs.candidate_id || !['ended', 'failed'].includes(vs.status)) return null;
  const jobId = vs.job_id;
  const candidateId = vs.candidate_id;

  const jobs = createJobsService(database);
  const [job, packet] = await Promise.all([
    jobs.get(a, jobId),
    jobs.getCandidateResults(a, jobId, candidateId),
  ]);
  const session = packet.sessions.find((s) => s.voiceSessionId === voiceSessionId);
  if (!session) return null;

  return {
    outcome: callOutcome(vs),
    dataFor: (callId) => ({
      jobId,
      candidateId,
      externalId: vs.external_id,
      isTest: vs.is_test,
      result: toV1Result(session, true, true, {
        questions: job.screeningQuestions,
        ...(apiUrl ? { recordingUrl: recordingLink(apiUrl, callId) } : {}),
      }),
    }),
  };
}

const eventType = (outcome: string): 'call.completed' | 'call.failed' =>
  outcome === 'completed' ? 'call.completed' : 'call.failed';

/** Never throws: a webhook problem must not break the call flow that triggered it. */
export async function emitCallEvent(
  database: Database,
  queue: WebhookQueue,
  organizationId: string,
  voiceSessionId: string,
  logger: Logger = { error: (obj, msg) => console.error(msg, obj) },
  apiUrl?: string,
): Promise<void> {
  try {
    const a = { organizationId, userId: SYSTEM_USER };
    const built = await buildCallEvent(database, a, voiceSessionId, apiUrl);
    if (!built) return;
    const { outcome } = built;

    const deliveryIds = await withTenantContext(database.db, a, async (tx) => {
      // Serialise concurrent call-end paths for this call before the dedupe check.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'call-event:' + voiceSessionId}))`);
      const req = await tx.execute<{ id: string }>(sql`
        update call_requests
        set reason = coalesce(reason, ${outcome === 'completed' ? null : outcome}), updated_at = now()
        where voice_session_id = ${voiceSessionId} and organization_id = ${organizationId}
        returning id
      `);
      // /v1 clients know the call by its call request id; dashboard calls have none.
      const callId = req[0]?.id ?? voiceSessionId;
      return recordOnce(tx, organizationId, eventType(outcome), { callId, ...built.dataFor(callId) });
    });

    await enqueueAll(queue, organizationId, deliveryIds, logger);
  } catch (error) {
    logger.error(
      { err: (error as Error).message, organizationId, voiceSessionId },
      'webhooks.emit_failed',
    );
  }
}

/**
 * The latest call events for GET /v1/events, rebuilt from the most recent
 * ended screens in the shape webhooks deliver (connectors show them as sample
 * data). Ids are `evt_recent_<callId>`, not ids of real deliveries.
 */
export async function recentCallEvents(
  database: Database,
  a: { organizationId: string; userId: string; isTest: boolean },
  type: 'call.completed' | 'call.failed' | undefined,
  limit: number,
  apiUrl?: string,
): Promise<{ id: string; type: string; createdAt: string; data: { callId: string } & CallEventData }[]> {
  // ponytail: looks at the 25 latest ended screens only; a stored event log if clients need history.
  const rows = await withTenantContext(database.db, a, (tx) =>
    tx.execute<{ id: string; ended_at: string; call_id: string | null }>(sql`
      select vs.id, coalesce(vs.ended_at, vs.created_at)::text as ended_at,
             (select cr.id from call_requests cr
               where cr.voice_session_id = vs.id and cr.organization_id = vs.organization_id
               limit 1) as call_id
      from voice_sessions vs
      where vs.organization_id = ${a.organizationId} and vs.is_test = ${a.isTest}
        and vs.job_id is not null and vs.candidate_id is not null
        and vs.status in ('ended', 'failed')
      order by coalesce(vs.ended_at, vs.created_at) desc, vs.id desc
      limit 25
    `),
  );
  const out = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const built = await buildCallEvent(database, a, r.id, apiUrl);
    if (!built || (type && eventType(built.outcome) !== type)) continue;
    const callId = r.call_id ?? r.id;
    out.push({
      id: `evt_recent_${callId}`,
      type: eventType(built.outcome),
      createdAt: new Date(r.ended_at).toISOString(),
      data: { callId, ...built.dataFor(callId) },
    });
  }
  return out;
}

/**
 * `call.failed` for a call request that ended without a voice session (skipped
 * for DND/consent, refused, or failed to dial). Never throws; emits at most once.
 */
export async function emitRequestFailed(
  database: Database,
  queue: WebhookQueue,
  organizationId: string,
  callRequestId: string,
  reason: string,
  logger: Logger = { error: (obj, msg) => console.error(msg, obj) },
): Promise<void> {
  try {
    const deliveryIds = await withTenantContext(
      database.db,
      { organizationId, userId: SYSTEM_USER },
      async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'call-event:' + callRequestId}))`);
        const rows = await tx.execute<{
          job_id: string;
          candidate_id: string;
          is_test: boolean;
          external_id: string | null;
        }>(sql`
          select cr.job_id, cr.candidate_id, cr.is_test, c.external_id
          from call_requests cr left join candidates c on c.id = cr.candidate_id
          where cr.id = ${callRequestId} and cr.organization_id = ${organizationId}
        `);
        const cr = rows[0];
        if (!cr) return [];
        return recordOnce(tx, organizationId, 'call.failed', {
          callId: callRequestId,
          jobId: cr.job_id,
          candidateId: cr.candidate_id,
          externalId: cr.external_id,
          isTest: cr.is_test,
          result: {
            status: 'failed',
            startedAt: null,
            endedAt: null,
            durationSeconds: null,
            answers: [],
            summary: null,
            failureReason: reason,
          },
        });
      },
    );
    await enqueueAll(queue, organizationId, deliveryIds, logger);
  } catch (error) {
    logger.error(
      { err: (error as Error).message, organizationId, callRequestId },
      'webhooks.emit_failed',
    );
  }
}
