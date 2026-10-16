/**
 * `Idempotency-Key` support for /v1 writes. The same key + method + path within
 * 24 h replays the stored status and body instead of running the handler again.
 * Only successful responses are stored; errors can be retried freely.
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

  // One transaction holds an advisory lock on the key for lookup + handler + store,
  // so a concurrent request with the same key waits, then replays.
  const lock = `${ctx.organizationId}:${key}:${method}:${path}`;
  return withTenantContext(database.db, ctx, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lock}))`);
    const hit = await tx.execute<{ status: number; body: unknown }>(sql`
      select status, body from idempotency_keys
      where organization_id = ${ctx.organizationId} and key = ${key}
        and method = ${method} and path = ${path}
        and created_at > now() - interval '24 hours'
    `);
    if (hit[0]) return { status: hit[0].status, body: hit[0].body };

    const result = await handler();
    await tx.execute(sql`
      insert into idempotency_keys (organization_id, key, method, path, status, body)
      values (${ctx.organizationId}, ${key}, ${method}, ${path}, ${result.status},
              ${JSON.stringify(result.body)}::jsonb)
      on conflict (organization_id, key, method, path)
      do update set status = excluded.status, body = excluded.body, created_at = now()
    `);
    return result;
  });
}
