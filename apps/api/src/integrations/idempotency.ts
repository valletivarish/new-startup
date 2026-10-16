/**
 * `Idempotency-Key` support for /v1 writes. The same key + method + path within
 * 24 h replays the stored status and body instead of running the handler again.
 * Only successful responses are stored; errors can be retried freely.
 * ponytail: two truly concurrent first requests with one key can both run;
 * add an advisory lock if clients retry in parallel.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';

export interface IdempotencyResult {
  status: number;
  body: unknown;
}

export async function withIdempotency(
  database: Database,
  ctx: { organizationId: string; userId: string },
  req: FastifyRequest,
  handler: () => Promise<IdempotencyResult>,
): Promise<IdempotencyResult> {
  const header = req.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) return handler();
  if (key.length > 255) {
    throw ApiError.validation([
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be at most 255 characters' },
    ]);
  }
  const method = req.method;
  const path = req.url.split('?')[0]!;

  const hit = await withTenantContext(database.db, ctx, (tx) =>
    tx.execute<{ status: number; body: unknown }>(sql`
      select status, body from idempotency_keys
      where organization_id = ${ctx.organizationId} and key = ${key}
        and method = ${method} and path = ${path}
        and created_at > now() - interval '24 hours'
    `),
  );
  if (hit[0]) return { status: hit[0].status, body: hit[0].body };

  const result = await handler();
  await withTenantContext(database.db, ctx, (tx) =>
    tx.execute(sql`
      insert into idempotency_keys (organization_id, key, method, path, status, body)
      values (${ctx.organizationId}, ${key}, ${method}, ${path}, ${result.status},
              ${JSON.stringify(result.body)}::jsonb)
      on conflict (organization_id, key, method, path)
      do update set status = excluded.status, body = excluded.body, created_at = now()
    `),
  );
  return result;
}
