/**
 * Environment configuration, validated with Zod at startup.
 * A misconfigured process refuses to boot rather than limping into runtime.
 */

import { z } from 'zod';
import type { RuntimeLimits } from '@platform/providers';

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_URL: z.string().url().default('http://localhost:3001'),
  WEB_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (u) => !/platform_migrator/.test(u),
      'The API must connect as the application role, never the migrator',
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(15_000),

  BETTER_AUTH_SECRET: z.string().min(16),
  SESSION_EXPIRY_SECONDS: z.coerce.number().int().min(300).default(604_800),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether Fastify trusts X-Forwarded-* headers. OFF by default: with no
   * proxy in front, trusting them lets any client spoof its IP and rotate
   * rate-limit buckets at will (audit finding). Set true only when deployed
   * behind the reverse proxy described in ADR-006.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

  /**
   * Root for the local ObjectStorage adapter. Cloudflare R2 replaces this
   * adapter entirely at deployment; nothing above the interface changes.
   */
  STORAGE_ROOT: z.string().default('.storage'),

  NOTIFICATION_TRANSPORT: z.enum(['console']).default('console'),
  EMAIL_FROM: z.string().default('no-reply@localhost'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  OTEL_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_SERVICE_NAME: z.string().default('platform-api'),

  /**
   * Deliver email through the background queue (production shape) or inline
   * (tests, and any environment with no worker running).
   */
  JOBS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Runtime safety limits (Phase 4, §25 cost safety).
   *
   * These are the ceilings the intelligence loop enforces in application
   * code. They are environment-tunable so an operator can tighten them under
   * cost pressure without a deploy — and because a limit nobody can adjust
   * tends to get removed rather than lowered. An agent's own configuration
   * may narrow them further; nothing can widen them.
   */
  RUNTIME_MAX_TOOL_CALLS_PER_TURN: z.coerce.number().int().min(0).max(20).default(3),
  RUNTIME_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(0).max(10).default(3),
  RUNTIME_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  RUNTIME_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1_000).max(500_000).default(60_000),
  RUNTIME_MAX_TOOL_OUTPUT_CHARS: z.coerce.number().int().min(200).max(64_000).default(8_000),
  RUNTIME_MAX_DURATION_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  RUNTIME_MAX_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(200).default(40),

  // -------------------------------------------------------------------------
  // MVP-01 ElevenLabs browser-voice
  //
  // ELEVENLABS_ENABLED=false by default — the feature is entirely off until
  // an operator explicitly turns it on, so a misconfigured key can never
  // silently start spending money.
  // -------------------------------------------------------------------------

  /** Master kill switch. Off by default: no credentials needed unless enabled. */
  ELEVENLABS_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * ElevenLabs API key. Required only when ELEVENLABS_ENABLED=true.
   * The Zod superRefine below enforces this.
   */
  ELEVENLABS_API_KEY: z.string().default(''),

  /**
   * HMAC secret for webhook signature verification.
   * Obtained from the ElevenLabs dashboard → Webhooks → Signing Secret.
   */
  ELEVENLABS_WEBHOOK_SECRET: z.string().default(''),

  /** Default voice ID to assign to provisioned agents when none is specified. */
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().default(''),

  /** Maximum single-session length in minutes (cost guard). */
  ELEVENLABS_MAX_TEST_MINUTES: z.coerce.number().int().min(1).max(30).default(5),

  /** Maximum number of test voice sessions per org per calendar day. */
  ELEVENLABS_DAILY_TEST_SESSIONS: z.coerce.number().int().min(1).max(100).default(10),

  /** Maximum total voice minutes per org per calendar day. */
  ELEVENLABS_DAILY_TEST_MINUTES: z.coerce.number().int().min(1).max(300).default(30),
}).superRefine((env, ctx) => {
  // Fail-closed toward production (audit finding): a production process with
  // development-grade security settings must refuse to boot, not limp along.
  // ElevenLabs: when enabled, key and webhook secret must be present.
  if (env.ELEVENLABS_ENABLED) {
    if (!env.ELEVENLABS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ELEVENLABS_API_KEY'],
        message: 'ELEVENLABS_API_KEY is required when ELEVENLABS_ENABLED=true',
      });
    }
    if (!env.ELEVENLABS_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ELEVENLABS_WEBHOOK_SECRET'],
        message: 'ELEVENLABS_WEBHOOK_SECRET is required when ELEVENLABS_ENABLED=true',
      });
    }
  }

  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message:
          'COOKIE_SECURE must be true in production — ADR-002 mandates Secure cookies',
      });
    }
    if (
      env.BETTER_AUTH_SECRET.length < 32 ||
      /do-not-use-in-production|local-development/.test(env.BETTER_AUTH_SECRET)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message:
          'Production requires a strong secret (>=32 chars, not the committed placeholder). Generate one: openssl rand -base64 32',
      });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

/** The runtime limits, assembled from the validated environment. */
export function runtimeLimitsFrom(env: Env): RuntimeLimits {
  return {
    maxToolCallsPerTurn: env.RUNTIME_MAX_TOOL_CALLS_PER_TURN,
    maxToolIterations: env.RUNTIME_MAX_TOOL_ITERATIONS,
    maxRetries: env.RUNTIME_MAX_RETRIES,
    maxContextChars: env.RUNTIME_MAX_CONTEXT_CHARS,
    maxToolOutputChars: env.RUNTIME_MAX_TOOL_OUTPUT_CHARS,
    maxDurationMs: env.RUNTIME_MAX_DURATION_MS,
    maxHistoryMessages: env.RUNTIME_MAX_HISTORY_MESSAGES,
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}
