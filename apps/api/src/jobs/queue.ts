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

export interface EmailJob {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
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
      logger.info(
        { queues: [EMAIL_QUEUE, DOCUMENT_QUEUE] },
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
