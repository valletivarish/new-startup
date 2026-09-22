/**
 * The job worker — a SECOND ENTRYPOINT from the same codebase, not a service
 * (`03_SYSTEM_ARCHITECTURE` §2 process topology). Same modular monolith,
 * separate process, so a long email retry never delays an API request and an
 * API deploy never drops an in-flight job.
 */

import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { pino } from 'pino';
import { createDatabase } from '@platform/db';

import { loadEnv } from '../config.js';
import {
  createJobQueue,
  DOCUMENT_QUEUE,
  EMAIL_QUEUE,
  type DocumentJob,
  type EmailJob,
} from './queue.js';
import { createNotificationTransport } from '../notifications/create-notification-transport.js';
import { createObjectStorage } from '../knowledge/create-object-storage.js';
import { startTelemetry } from '../observability/telemetry.js';
import { createDocumentProcessor } from '../knowledge/processor.js';
import { createDeterministicEmbeddingProvider } from '../knowledge/deterministic-embedding-provider.js';
import { createChunker } from '../knowledge/chunker.js';
import { createAuditService } from '../audit/audit.service.js';

const env = loadEnv();

const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['*.password', '*.token', '*.secret'],
    censor: '[redacted]',
  },
  base: { service: 'platform-worker' },
});

const telemetry = startTelemetry(env, logger);
const database = createDatabase({
  url: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_MAX,
  statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
});
const queue = createJobQueue(env.DATABASE_URL, logger);

const transport = createNotificationTransport(env, logger);

await queue.start();

await queue.boss.work<EmailJob>(EMAIL_QUEUE, async (jobs) => {
  for (const job of jobs) {
    await transport.sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      text: job.data.text,
      ...(job.data.html !== undefined ? { html: job.data.html } : {}),
    });
    logger.info({ jobId: job.id, to: job.data.to }, 'jobs.email_sent');
  }
});

// ---------------------------------------------------------------------------
// Knowledge indexing.
//
// The whole point of doing this here: extraction, chunking and embedding are
// slow and retryable, so they belong on the worker rather than in a request.
// ---------------------------------------------------------------------------
const audit = createAuditService(database, logger);
const processDocument = createDocumentProcessor({
  database,
  embeddings: createDeterministicEmbeddingProvider(),
  chunker: createChunker(),
  storage: createObjectStorage(env),
  logger,
  onAudit: async (event) => {
    await audit.record({
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      eventType: event.eventType,
      resourceType: 'knowledge_document',
      resourceId: event.documentId,
      metadata: event.metadata,
    });
  },
});

await queue.boss.work<DocumentJob>(DOCUMENT_QUEUE, async (jobs) => {
  for (const job of jobs) {
    await processDocument(job.data);
  }
});

logger.info('platform-worker started');

// Compose healthcheck: prove this process is alive, not only that Postgres is.
const HEARTBEAT_PATH = '/tmp/platform-worker-heartbeat';
const beat = () => {
  try {
    writeFileSync(HEARTBEAT_PATH, String(Date.now()));
  } catch {
    /* ignore */
  }
};
beat();
setInterval(beat, 10_000);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'platform-worker shutting down');
  await queue.stop();
  await database.close();
  await telemetry.shutdown();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}
