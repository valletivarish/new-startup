/**
 * Company API keys. The raw key (`hrv_live_` / `hrv_test_` + 32 base62
 * characters) is returned once at creation; only its SHA-256 hex digest and
 * the first 12 characters (for display) are stored.
 */

import { createHash, randomBytes } from 'node:crypto';
import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { ApiScope } from './scopes.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export type ApiKeyMode = 'live' | 'test';

export interface ApiKeyRow {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly mode: ApiKeyMode;
  readonly scopes: readonly string[];
  readonly createdByUserId: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface ApiKeysService {
  create(
    actor: Actor,
    input: { name: string; mode: ApiKeyMode; scopes: readonly ApiScope[] },
  ): Promise<{ id: string; key: string; prefix: string }>;
  list(actor: Actor): Promise<ApiKeyRow[]>;
  revoke(actor: Actor, id: string): Promise<void>;
  hashKey(key: string): string;
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** `length` uniformly random base62 characters (rejection sampling, no modulo bias). */
function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function createApiKeysService(database: Database): ApiKeysService {
  return {
    hashKey,

    async create(actor, { name, mode, scopes }) {
      const key = `hrv_${mode}_${randomBase62(32)}`;
      const prefix = key.slice(0, 12);
      const scopeList = sql.join(
        scopes.map((s) => sql`${s}`),
        sql`, `,
      );
      const rows = await withTenantContext(database.db, actor, (tx) =>
        tx.execute<{ id: string }>(sql`
          insert into api_keys
            (organization_id, created_by_user_id, name, prefix, key_hash, mode, scopes)
          values (${actor.organizationId}, ${actor.userId}, ${name}, ${prefix},
                  ${hashKey(key)}, ${mode}, array[${scopeList}]::text[])
          returning id
        `),
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('api key insert returned no row');
      return { id, key, prefix };
    },

    async list(actor) {
      const rows = await withTenantContext(database.db, actor, (tx) =>
        tx.execute<{
          id: string;
          name: string;
          prefix: string;
          mode: ApiKeyMode;
          scopes: string[];
          created_by_user_id: string;
          last_used_at: unknown;
          revoked_at: unknown;
          created_at: unknown;
        }>(sql`
          select id, name, prefix, mode, scopes, created_by_user_id,
                 last_used_at, revoked_at, created_at
          from api_keys
          where organization_id = ${actor.organizationId}
          order by created_at desc
        `),
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        mode: r.mode,
        scopes: r.scopes,
        createdByUserId: r.created_by_user_id,
        lastUsedAt: iso(r.last_used_at),
        revokedAt: iso(r.revoked_at),
        createdAt: iso(r.created_at) ?? '',
      }));
    },

    async revoke(actor, id) {
      const rows = await withTenantContext(database.db, actor, (tx) =>
        tx.execute<{ id: string }>(sql`
          update api_keys set revoked_at = coalesce(revoked_at, now())
          where id = ${id} and organization_id = ${actor.organizationId}
          returning id
        `),
      );
      if (rows.length === 0) throw ApiError.notFound('API key');
    },
  };
}

/**
 * Fixed-window per-key request limit (600/min by default). Throws the same
 * `rate_limited` 429 envelope the IP limiter produces.
 * ponytail: in-process counters; move to a shared store if the API runs on
 * more than one instance.
 */
export function createKeyRateLimiter({
  limit = 600,
  windowMs = 60_000,
  now = Date.now,
}: { limit?: number; windowMs?: number; now?: () => number } = {}) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(keyId: string): void {
      const t = now();
      let w = windows.get(keyId);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(keyId, w);
      }
      w.count += 1;
      if (w.count > limit) {
        const ttl = Math.ceil((w.start + windowMs - t) / 1000);
        throw new ApiError('rate_limited', `Too many requests. Try again in ${ttl}s`);
      }
    },
  };
}

export type KeyRateLimiter = ReturnType<typeof createKeyRateLimiter>;
