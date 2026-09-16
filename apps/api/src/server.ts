/**
 * Application assembly, shared by main.ts and the test suite so that tests
 * exercise the REAL app: real guards, real filter, real Better Auth handler,
 * real database role.
 */

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { pino, type Logger } from 'pino';
import { createDatabase, type Database } from '@platform/db';
import { type NotificationProvider } from '@platform/providers';

import { loadEnv, type Env } from './config.js';
import { createJobQueue, type JobQueue } from './jobs/queue.js';
import { createQueuedNotificationProvider } from './jobs/queued-notification-provider.js';
import { startTelemetry, type Telemetry } from './observability/telemetry.js';
import { createAuth, type BetterAuthInstance } from './auth/better-auth.js';
import { createConsoleNotificationProvider } from './notifications/console-notification-provider.js';
import { createAuditService } from './audit/audit.service.js';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './http-exception.filter.js';
import type { VoiceSessionAdapter } from './providers/elevenlabs/adapter.js';

export interface BuiltApp {
  readonly app: NestFastifyApplication;
  readonly env: Env;
  readonly database: Database;
  readonly auth: BetterAuthInstance;
  readonly logger: Logger;
  readonly jobs: JobQueue | null;
  close(): Promise<void>;
}

export interface BuildOverrides {
  /**
   * Substitute NotificationProvider — normal dependency injection through the
   * same interface production uses. Tests inject a capturing provider to read
   * invitation emails the way a recipient would.
   */
  readonly notifications?: NotificationProvider;
  /**
   * Substitute voice session adapter. Tests inject the stub so no live
   * ElevenLabs network calls are made.
   */
  readonly voiceAdapter?: VoiceSessionAdapter;
}

export async function buildApp(
  envSource: NodeJS.ProcessEnv = process.env,
  overrides: BuildOverrides = {},
): Promise<BuiltApp> {
  const env = loadEnv(envSource);

  const logger = pino({
    level: env.LOG_LEVEL,
    // Credentials, tokens and cookies never reach the log (`07_CODING_RULES` §7).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[redacted]',
    },
  });

  const database = createDatabase({
    url: env.DATABASE_URL,
    maxConnections: env.DATABASE_POOL_MAX,
    statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
  });

  const telemetry: Telemetry = startTelemetry(env, logger);

  // Email is enqueued rather than sent inline, so a slow or failing transport
  // never blocks the request that triggered it and a transient failure
  // retries. The interface is unchanged either way.
  const jobs = env.JOBS_ENABLED ? createJobQueue(env.DATABASE_URL, logger) : null;
  if (jobs) await jobs.start();

  const notifications =
    overrides.notifications ??
    (jobs
      ? createQueuedNotificationProvider(jobs)
      : createConsoleNotificationProvider(logger));

  // The audit service is constructed once here so Better Auth's hooks and the
  // Nest container share it.
  const audit = createAuditService(database, logger);

  const auth = createAuth({
    db: database.db,
    env,
    notifications,
    onAuthEvent: async (event) => {
      await audit.record({
        organizationId: null,
        actorUserId: event.userId,
        eventType: event.type,
      });
    },
  });

  const adapter = new FastifyAdapter({
    genReqId: () => randomUUID(),
    // Only trust forwarding headers behind a real proxy — otherwise clients
    // spoof X-Forwarded-For and defeat per-IP rate limiting (audit finding).
    trustProxy: env.TRUST_PROXY,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot({
      env,
      database,
      auth,
      notifications,
      logger,
      jobs,
      ...(overrides.voiceAdapter ? { voiceAdapter: overrides.voiceAdapter } : {}),
    }),
    adapter,
    { logger: false },
  );

  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(fastifyCookie);
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
  });
  await fastify.register(fastifyRateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    // Keyed per client ip; organization-level limits arrive with usage
    // metering in Phase 7.
    errorResponseBuilder: (request, context) => ({
      // The plugin THROWS this object; statusCode is what routes it through
      // the exception filter's 4xx branch, which renders the standard
      // envelope (audit finding: 429s previously flattened to 500).
      statusCode: 429,
      code: 'rate_limited',
      message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s`,
      request_id: request.id,
    }),
  });

  // -------------------------------------------------------------------------
  // Better Auth handler — /api/auth/* (sign-up, sign-in, sign-out,
  // verification, password reset). Web-standard Request/Response bridge.
  // -------------------------------------------------------------------------
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(
        request.raw.url ?? '/',
        `${request.protocol}://${request.headers.host ?? 'localhost'}`,
      );
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }

      const init: RequestInit = { method: request.method, headers };
      if (request.method === 'POST' && request.body !== undefined) {
        init.body = JSON.stringify(request.body);
        headers.set('content-type', 'application/json');
      }

      const response = await auth.handler(new Request(url, init));

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') void reply.header(key, value);
      });
      // Set once, as an array — Headers.forEach visits set-cookie once per
      // cookie, so appending inside the loop duplicated every cookie
      // (audit finding).
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header('set-cookie', cookies);
      const text = await response.text();
      void reply.send(text.length > 0 ? text : undefined);
    },
  });

  app.useGlobalFilters(new ApiExceptionFilter(logger));

  return {
    app,
    env,
    database,
    auth,
    logger,
    jobs,
    async close() {
      await app.close();
      if (jobs) await jobs.stop();
      await database.close();
      await telemetry.shutdown();
    },
  };
}
