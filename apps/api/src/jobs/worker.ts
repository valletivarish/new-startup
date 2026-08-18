/**
 * The job worker — a SECOND ENTRYPOINT from the same codebase, not a service
 * (`03_SYSTEM_ARCHITECTURE` §2 process topology). Same modular monolith,
 * separate process, so a long email retry never delays an API request and an
 * API deploy never drops an in-flight job.
 */

import 'reflect-metadata';
import { pino } from 'pino';
import { createDatabase } from '@platform/db';

import { loadEnv } from '../config.js';
import { createJobQueue, EMAIL_QUEUE, type EmailJob } from './queue.js';
import { createConsoleNotificationProvider } from '../notifications/console-notification-provider.js';
import { startTelemetry } from '../observability/telemetry.js';

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

// The concrete transport. No external email provider is selected
// (12_ARCHITECTURE_DECISIONS_FINAL D3); the console provider satisfies the
// interface until one is chosen on benchmark evidence.
const transport = createConsoleNotificationProvider(logger);

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

logger.info('platform-worker started');

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
