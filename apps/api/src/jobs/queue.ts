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

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueueEmail(job: EmailJob, idempotencyKey?: string): Promise<void>;
  readonly boss: PgBoss;
}

export function createJobQueue(
  connectionString: string,
  logger: Logger,
): JobQueue {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    // The schema is created by migration 0004, owned by the migrator. Telling
    // pg-boss not to create it is what keeps platform_app free of CREATE on
    // the database — it needs CREATE on the `pgboss` schema only, for its own
    // tables. Without this, start() attempts CREATE SCHEMA and is (correctly)
    // refused.
    createSchema: false,
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
      await boss.createQueue(EMAIL_QUEUE, {
        // Email payloads carry invitation links, and an invitation link
        // carries the raw token. pg-boss tables are not RLS-protected, so
        // keep the window small: retain a job for at most an hour and delete
        // it shortly after completion.
        retentionSeconds: 3600,
        deleteAfterSeconds: 120,
      });
      logger.info({ queue: EMAIL_QUEUE }, 'jobs.queue_ready');
    },
    async stop() {
      await boss.stop({ graceful: true });
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
