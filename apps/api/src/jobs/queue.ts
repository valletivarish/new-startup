/**
 * Background job queue (pg-boss), Phase 1 A4 inventory.
 *
 * Postgres-backed, so no new infrastructure is introduced — pg-boss lives in
 * its own `pgboss` schema (migration 0004) where platform_app holds CREATE,
 * while `public` stays DDL-free for the application role.
 *
 * Phase 1 defines exactly ONE job type: email delivery. The
 * NotificationProvider interface is unchanged; what changes is that sending
 * no longer blocks the request that triggered it, and a transient failure
 * retries instead of vanishing.
 */

import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';

export const EMAIL_QUEUE = 'notifications.email';
export const DOCUMENT_QUEUE = 'knowledge.document.process';
export const CALL_QUEUE = 'calls.place';
export const WEBHOOK_QUEUE = 'webhooks.deliver';
export const SUPPORT_QUEUE = 'support.unanswered';
/** Zoho Recruit: one connection's sync, the 15-minute schedule that fans out, and note delivery. */
export const ZOHO_SYNC_QUEUE = 'connectors.zoho.sync';
export const ZOHO_TICK_QUEUE = 'connectors.zoho.tick';
export const ZOHO_NOTE_QUEUE = 'connectors.zoho.note';

/** Ids only; tokens and applicant data stay in the RLS tables. */
export interface ZohoSyncJob {
  readonly organizationId: string;
}
export interface ZohoNoteJob {
  readonly organizationId: string;
  readonly noteId: string;
}

/** Check a chat message 5 minutes on: still unanswered → email the customer. Ids only. */
export interface SupportJob {
  readonly ref: string;
  readonly messageId: string;
}

/** Deliver one webhook_deliveries row. Org id because the worker has no tenant context. */
export interface WebhookJob {
  readonly organizationId: string;
  readonly deliveryId: string;
}

/**
 * Place one /v1 call request. Carries the org and acting user because the
 * worker has no request context and call_requests is tenant-scoped (RLS).
 */
export interface CallJob {
  readonly organizationId: string;
  readonly userId: string;
  readonly callRequestId: string;
}

export interface EmailJob {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  /**
   * Present when the email was triggered inside a tenant context. The worker
   * establishes that context per job, per transaction (ADR-003) before any
   * organization-scoped work — never once per batch.
   */
  readonly organizationId?: string;
}

/**
 * Document indexing. The payload carries the document VERSION, which is what
 * makes a stale retry detectable: the processor compares it against the row
 * and exits without touching anything if the document has moved on.
 */
export interface DocumentJob {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly documentId: string;
  readonly version: number;
}

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueueEmail(job: EmailJob, idempotencyKey?: string): Promise<void>;
  enqueueDocumentProcessing(
    job: DocumentJob,
    idempotencyKey?: string,
  ): Promise<void>;
  /** `startAfter` holds the job until then (calls outside calling hours). */
  enqueueCall(job: CallJob, startAfter?: Date): Promise<void>;
  enqueueWebhook(job: WebhookJob): Promise<void>;
  enqueueSupportCheck(job: SupportJob, startAfter: Date): Promise<void>;
  enqueueZohoSync(job: ZohoSyncJob): Promise<void>;
  enqueueZohoNote(job: ZohoNoteJob): Promise<void>;
  readonly boss: PgBoss;
}

export function createJobQueue(
  connectionString: string,
  logger: Logger,
): JobQueue {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    // Every pg-boss object is installed by the MIGRATOR in migration 0005 and
    // owned by it. The library performs NO DDL at runtime, which is what lets
    // platform_app hold zero CREATE privileges anywhere — not on the database,
    // not on public, not on pgboss. Both flags are required: createSchema
    // suppresses CREATE SCHEMA, migrate suppresses version upgrades.
    //
    // On a pg-boss upgrade, generate a new migration from getMigrationPlans()
    // rather than letting the library self-migrate at runtime.
    createSchema: false,
    migrate: false,
    // Small pool: the worker's tenant work uses the application database
    // client, not this one.
    max: 3,
    application_name: 'platform-jobs',
  });

  boss.on('error', (error: unknown) => {
    logger.error({ err: (error as Error).message }, 'jobs.queue_error');
  });

  return {
    boss,
    async start() {
      await boss.start();
      await boss.createQueue(DOCUMENT_QUEUE, {
        // Bounded retention; indexing jobs carry no secrets, only ids.
        retentionSeconds: 86_400,
        deleteAfterSeconds: 3600,
      });
      await boss.createQueue(EMAIL_QUEUE, {
        // Email payloads carry invitation links, and an invitation link
        // carries the raw token. pg-boss tables are not RLS-protected, so
        // keep the window small: retain a job for at most an hour and delete
        // it shortly after completion.
        retentionSeconds: 3600,
        deleteAfterSeconds: 120,
      });
      await boss.createQueue(CALL_QUEUE, {
        // Ids only. Kept a little over a day so a call held overnight for
        // calling hours is still there at 09:00.
        retentionSeconds: 2 * 86_400,
        deleteAfterSeconds: 3600,
      });
      await boss.createQueue(WEBHOOK_QUEUE, {
        // Ids only; the payload stays in webhook_deliveries (RLS). Retries are capped
        // at 6 h apart and stop at 24 h; 3 days keeps the last retry well inside retention.
        retentionSeconds: 3 * 86_400,
        deleteAfterSeconds: 3600,
      });
      await boss.createQueue(SUPPORT_QUEUE, {
        // Ids only (ticket ref + message id); the thread stays in support_messages (RLS).
        retentionSeconds: 86_400,
        deleteAfterSeconds: 3600,
      });
      for (const name of [ZOHO_SYNC_QUEUE, ZOHO_TICK_QUEUE, ZOHO_NOTE_QUEUE]) {
        // Ids only. Note retries stop at 24 h (handled on the row); 3 days covers the last one.
        await boss.createQueue(name, { retentionSeconds: 3 * 86_400, deleteAfterSeconds: 3600 });
      }
      logger.info(
        { queues: [EMAIL_QUEUE, DOCUMENT_QUEUE, CALL_QUEUE, WEBHOOK_QUEUE, SUPPORT_QUEUE, ZOHO_SYNC_QUEUE, ZOHO_TICK_QUEUE, ZOHO_NOTE_QUEUE] },
        'jobs.queue_ready',
      );
    },
    async stop() {
      await boss.stop({ graceful: true });
    },
    async enqueueDocumentProcessing(job, idempotencyKey) {
      await boss.send(DOCUMENT_QUEUE, job as unknown as object, {
        // BOUNDED retries with backoff — never an infinite loop. After these
        // attempts the document is left in an explicit `failed` state with a
        // reason, which is the honest outcome.
        retryLimit: 3,
        retryDelay: 15,
        retryBackoff: true,
        expireInSeconds: 600,
        ...(idempotencyKey ? { singletonKey: idempotencyKey } : {}),
      });
    },

    async enqueueCall(job, startAfter) {
      await boss.send(CALL_QUEUE, job as unknown as object, {
        // No retries: place() records its own failure on the row, and a
        // blind retry could dial a candidate twice.
        retryLimit: 0,
        expireInSeconds: 300,
        ...(startAfter ? { startAfter } : {}),
      });
    },

    async enqueueWebhook(job) {
      await boss.send(WEBHOOK_QUEUE, job as unknown as object, {
        // 30 s doubling (with jitter), at most 6 h apart; handleWebhookJob
        // marks the row failed past 24 h or on the last attempt.
        retryLimit: 12,
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 21_600,
        retentionSeconds: 3 * 86_400,
        expireInSeconds: 60,
      });
    },

    async enqueueSupportCheck(job, startAfter) {
      await boss.send(SUPPORT_QUEUE, job as unknown as object, {
        retryLimit: 2,
        retryDelay: 60,
        expireInSeconds: 120,
        startAfter,
        // One check per message, however often the enqueue is retried.
        singletonKey: job.messageId,
      });
    },

    async enqueueZohoSync(job) {
      // The connection row's lease makes a duplicate harmless; no retries, the next tick runs it again.
      await boss.send(ZOHO_SYNC_QUEUE, job as unknown as object, { retryLimit: 0, expireInSeconds: 900 });
    },

    async enqueueZohoNote(job) {
      // Same schedule as webhooks: 30 s doubling, at most 6 h apart; the row gives up at 24 h.
      await boss.send(ZOHO_NOTE_QUEUE, job as unknown as object, {
        retryLimit: 12,
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 21_600,
        expireInSeconds: 120,
      });
    },

    async enqueueEmail(job, idempotencyKey) {
      await boss.send(EMAIL_QUEUE, job as unknown as object, {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 300,
        // Duplicate sends must not produce duplicate emails (§19 idempotency).
        ...(idempotencyKey ? { singletonKey: idempotencyKey } : {}),
      });
    },
  };
}
