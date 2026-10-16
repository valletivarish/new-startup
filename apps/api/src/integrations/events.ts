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
import { toV1Result } from './public-mappers.js';

export const WEBHOOK_EVENTS = ['call.completed', 'call.failed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

type Logger = { error(obj: object, msg: string): void };

/** Never throws: a webhook problem must not break the call flow that triggered it. */
export async function emitCallEvent(
  database: Database,
  queue: Pick<JobQueue, 'enqueueWebhook'> | null,
  organizationId: string,
  voiceSessionId: string,
  logger: Logger = { error: (obj, msg) => console.error(msg, obj) },
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
      const seen = await tx.execute(sql`
        select 1 from webhook_deliveries
        where organization_id = ${organizationId} and payload->'data'->>'callId' = ${callId}
        limit 1
      `);
      if (seen.length > 0) return [];

      const payload = {
        id: `evt_${randomUUID()}`,
        type,
        createdAt: new Date().toISOString(),
        data: {
          callId,
          jobId,
          candidateId,
          externalId: vs.external_id,
          isTest: vs.is_test,
          result: toV1Result(session, true, true, { questions: job.screeningQuestions }),
        },
      };
      const rows = await tx.execute<{ id: string }>(sql`
        insert into webhook_deliveries (organization_id, endpoint_id, event, payload)
        select ${organizationId}, e.id, ${type}, ${JSON.stringify(payload)}::jsonb
        from webhook_endpoints e
        where e.organization_id = ${organizationId} and e.disabled_at is null
          and ${type} = any(e.events)
        returning id
      `);
      return rows.map((r) => r.id);
    });

    for (const deliveryId of deliveryIds) {
      // ponytail: a failed enqueue leaves the row pending; the resend route recovers it.
      await queue?.enqueueWebhook({ organizationId, deliveryId }).catch((error: unknown) =>
        logger.error({ err: (error as Error).message, deliveryId }, 'webhooks.enqueue_failed'),
      );
    }
  } catch (error) {
    logger.error(
      { err: (error as Error).message, organizationId, voiceSessionId },
      'webhooks.emit_failed',
    );
  }
}
