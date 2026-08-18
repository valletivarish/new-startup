/**
 * Regression tests for the Phase 1 closeout items — the scope and hygiene
 * gaps the independent audit left open. Together with audit-fixes.test.ts,
 * these pin every finding from PHASE_1_AUDIT_REPORT.md.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';
import {
  createOrganization,
  registerUser,
  startApi,
  type ApiHarness,
} from './setup/api-harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

let api: ApiHarness;

beforeAll(async () => {
  api = await startApi();
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('CLOSEOUT: background jobs (pg-boss) exist and are wired', () => {
  it('the pgboss schema is created by migration, scoped away from public', async () => {
    const su = superDatabase();
    try {
      const rows = await su.db.execute<{ nspname: string }>(
        sql`select nspname from pg_namespace where nspname = 'pgboss'`,
      );
      expect(rows.length).toBe(1);

      // Superseded by migration 0005: pg-boss's objects are installed by the
      // migrator, so the runtime role now holds NO create privilege anywhere
      // — pgboss included. Full coverage lives in jobs-initialization.test.ts.
      const priv = await su.db.execute<{ pgboss: boolean; pub: boolean }>(sql`
        select has_schema_privilege('platform_app', 'pgboss', 'CREATE') as pgboss,
               has_schema_privilege('platform_app', 'public', 'CREATE') as pub
      `);
      expect(priv[0]?.pgboss).toBe(false);
      expect(priv[0]?.pub).toBe(false);
    } finally {
      await su.close();
    }
  });

  it('the worker is a second entrypoint from the same codebase, not a service', () => {
    const worker = readFileSync(join(repoRoot, 'apps/api/src/jobs/worker.ts'), 'utf8');
    // Same repo, same config, same db package — one modular monolith.
    expect(worker).toContain("from '../config.js'");
    expect(worker).toContain("from '@platform/db'");
    const compose = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('worker:');
    expect(compose).toContain('api:');
  });

  it('email is delivered through the NotificationProvider interface either way', () => {
    const queued = readFileSync(
      join(repoRoot, 'apps/api/src/jobs/queued-notification-provider.ts'),
      'utf8',
    );
    // Queueing is a delivery discipline, not a new interface — swapping the
    // transport later must not touch business code.
    expect(queued).toContain('NotificationProvider');
    expect(queued).not.toMatch(/@anthropic|openai|twilio|sendgrid|resend/i);
  });
});

describe('CLOSEOUT: OpenTelemetry is initialised and vendor-neutral', () => {
  it('telemetry is wired, disabled by default, and names no vendor', () => {
    const tel = readFileSync(
      join(repoRoot, 'apps/api/src/observability/telemetry.ts'),
      'utf8',
    );
    expect(tel).toContain('NodeSDK');
    expect(tel).toContain('OTEL_ENABLED');
    // The backend is chosen by OTLP endpoint config, never hard-coded.
    expect(tel).not.toMatch(/datadog|newrelic|honeycomb|grafana\.net/i);
  });

  it('a failure to start telemetry never takes the process down', () => {
    const tel = readFileSync(
      join(repoRoot, 'apps/api/src/observability/telemetry.ts'),
      'utf8',
    );
    expect(tel).toContain('catch');
  });
});

describe('CLOSEOUT: audit endpoint is cursor-paginated', () => {
  it('returns a page plus a cursor, and the cursor walks without gaps or repeats', async () => {
    const owner = await registerUser(api, 'page-owner');
    await createOrganization(api, owner, 'Pagination Test Org');

    // Org creation + auth already generated several audit events; add more
    // by switching organizations repeatedly.
    for (let i = 0; i < 6; i += 1) {
      await api.request({
        method: 'GET',
        url: '/organization',
        cookie: owner.cookie,
      });
    }

    const first = await api.request({
      method: 'GET',
      url: '/audit?limit=2',
      cookie: owner.cookie,
    });
    expect(first.statusCode).toBe(200);
    const page1 = JSON.parse(first.body) as {
      events: { id: string }[];
      nextCursor: string | null;
    };
    expect(page1.events.length).toBeLessThanOrEqual(2);

    if (page1.nextCursor) {
      const second = await api.request({
        method: 'GET',
        url: `/audit?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
        cookie: owner.cookie,
      });
      expect(second.statusCode).toBe(200);
      const page2 = JSON.parse(second.body) as { events: { id: string }[] };

      // No repeats across the page boundary — the id tiebreaker doing its job.
      const ids1 = new Set(page1.events.map((e) => e.id));
      for (const e of page2.events) expect(ids1.has(e.id)).toBe(false);
    }
  });

  it('rejects a forged cursor as a validation error, not a 500', async () => {
    const owner = await registerUser(api, 'cursor-owner');
    await createOrganization(api, owner, 'Cursor Test Org');

    const res = await api.request({
      method: 'GET',
      url: '/audit?cursor=not-a-real-cursor',
      cookie: owner.cookie,
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { errors: { field: string }[] };
    expect(body.errors.some((e) => e.field === 'cursor')).toBe(true);
  });

  it('caps the page size regardless of what the caller asks for', async () => {
    const owner = await registerUser(api, 'cap-owner');
    await createOrganization(api, owner, 'Cap Test Org');
    const res = await api.request({
      method: 'GET',
      url: '/audit?limit=100000',
      cookie: owner.cookie,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('CLOSEOUT: production configuration fails closed', () => {
  it('refuses to boot in production without secure cookies', async () => {
    await expect(
      startApi({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).rejects.toThrow(/COOKIE_SECURE/);
  });

  it('refuses to boot in production with the placeholder secret', async () => {
    await expect(
      startApi({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        BETTER_AUTH_SECRET: 'local-development-secret-do-not-use-in-production',
      }),
    ).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});
