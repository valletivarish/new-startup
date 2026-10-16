/**
 * `Idempotency-Key` support for /v1 writes. The same key + method + path within
 * 24 h replays the stored status and body instead of running the handler again.
 * A claim row (status 0) marks a request in flight; a failed handler releases it,
 * so errors can be retried freely, and a concurrent duplicate gets 409.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import type { FastifyRequest } from 'fastify';

import type { RequestWithAuth } from '../authz/authz.guard.js';
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
  const clientKey = Array.isArray(header) ? header[0] : header;
  if (!clientKey) return handler();
  if (clientKey.length > 255) {
    throw ApiError.validation([
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be at most 255 characters' },
    ]);
  }
  // Scoped per caller, so two API keys of one company never replay each other's bodies.
  const auth = (req as RequestWithAuth).authContext;
  const key = `${auth?.apiKey ? `key:${auth.apiKey.id}` : `user:${ctx.userId}`}:${clientKey}`;
  const method = req.method;
  const path = req.url.split('?')[0]!;

  const tenant = <T>(fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, ctx, fn);

  // Claim the key with a short transaction (status 0 = in flight); no connection
  // is held while the handler runs. Expired (24 h) and abandoned (60 s) claims are retaken.
  for (let attempt = 0; attempt < 3; attempt++) {
    const claimed = await tenant((tx) =>
      tx.execute(sql`
        insert into idempotency_keys (organization_id, key, method, path, status, body, created_at)
        values (${ctx.organizationId}, ${key}, ${method}, ${path}, 0, null, now())
        on conflict (organization_id, key, method, path) do update
          set status = 0, body = null, created_at = now()
          where idempotency_keys.created_at < now() - interval '24 hours'
             or (idempotency_keys.status = 0
                 and idempotency_keys.created_at < now() - interval '60 seconds')
        returning 1
      `),
    );
    if (claimed.length > 0) {
      try {
        const result = await handler();
        await tenant((tx) =>
          tx.execute(sql`
            update idempotency_keys
            set status = ${result.status}, body = ${JSON.stringify(result.body)}::jsonb
            where organization_id = ${ctx.organizationId} and key = ${key}
              and method = ${method} and path = ${path}
          `),
        );
        return result;
      } catch (error) {
        await tenant((tx) =>
          tx.execute(sql`
            delete from idempotency_keys
            where organization_id = ${ctx.organizationId} and key = ${key}
              and method = ${method} and path = ${path} and status = 0
          `),
        );
        throw error;
      }
    }

    const hit = await tenant((tx) =>
      tx.execute<{ status: number; body: unknown }>(sql`
        select status, body from idempotency_keys
        where organization_id = ${ctx.organizationId} and key = ${key}
          and method = ${method} and path = ${path}
      `),
    );
    const row = hit[0];
    if (!row) continue; // released between our claim and read; claim again
    if (row.status === 0) {
      throw new ApiError(
        'idempotency_in_progress',
        'A request with this Idempotency-Key is still being processed. Retry shortly.',
      );
    }
    return { status: row.status, body: row.body };
  }
  throw new ApiError(
    'idempotency_in_progress',
    'A request with this Idempotency-Key is still being processed. Retry shortly.',
  );
}
