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

export const WEBHOOK_EVENTS = ['call.completed', 'call.failed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

type Logger = { error(obj: object, msg: string): void };
type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];
type WebhookQueue = { enqueueWebhook?: JobQueue['enqueueWebhook'] } | null;

/** One delivery per subscribed endpoint, unless this call already has an event. Caller holds the call's advisory lock. */
async function recordOnce(
  tx: Tx,
  organizationId: string,
  type: WebhookEvent,
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
    const tenant = <T>(fn: Parameters<typeof withTenantContext<T>>[2]) =>
      withTenantContext(database.db, a, fn);

    const sessions = await tenant((tx) =>
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
        where vs.id = ${voiceSessionId} and vs.organization_id = ${organizationId}
      `),
    );
    const vs = sessions[0];
    // Only screens of a candidate for a job are events; browser test calls are not.
    if (!vs?.job_id || !vs.candidate_id || !['ended', 'failed'].includes(vs.status)) return;
    const jobId = vs.job_id;
    const candidateId = vs.candidate_id;

    const jobs = createJobsService(database);
    const [job, packet] = await Promise.all([
      jobs.get(a, jobId),
      jobs.getCandidateResults(a, jobId, candidateId),
    ]);
    const session = packet.sessions.find((s) => s.voiceSessionId === voiceSessionId);
    if (!session) return;

    const outcome = callOutcome(vs);
    const type: WebhookEvent = outcome === 'completed' ? 'call.completed' : 'call.failed';

    const deliveryIds = await tenant(async (tx) => {
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
      return recordOnce(tx, organizationId, type, {
        callId,
        jobId,
        candidateId,
        externalId: vs.external_id,
        isTest: vs.is_test,
        result: toV1Result(session, true, true, {
          questions: job.screeningQuestions,
          ...(apiUrl ? { recordingUrl: recordingLink(apiUrl, callId) } : {}),
        }),
      });
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
