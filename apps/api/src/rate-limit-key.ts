/**
 * Who a request is, for the global rate limiter.
 *
 * - Valid Better Auth session cookie -> that session ("s:<hash>"). The cookie is
 *   `<token>.<base64 HMAC-SHA256(secret, token)>`, so we verify the signature locally
 *   with the auth secret: no DB hit, and a forged/garbled cookie fails here and falls
 *   back to the IP bucket (it cannot mint fresh buckets).
 * - `Authorization: Bearer hrv_…` -> that key ("k:<hash>") ONLY once the auth guard has
 *   validated it (see markKeyValidated, short sliding TTL). Unvalidated or forged keys use
 *   the IP bucket, so rotating fake keys neither dodges the limit nor grows the limiter.
 *   A real key's first request after the TTL lapses is counted against its IP bucket.
 * - Everything else, `/api/auth/*` (sign-in/up brute force) and routes with their own
 *   stricter `rateLimit` config -> client IP.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const sha = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 22);
const BEARER_KEY_RE = /^Bearer (hrv_(?:live|test)_[A-Za-z0-9]{32})$/;
const SESSION_COOKIE_RE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/;

const VALIDATED_TTL_MS = 5 * 60_000;
// Only keys the DB accepted get in, so this is bounded by the number of real keys.
const validatedKeys = new Map<string, number>();

/** Called by the auth guard after a Bearer key authenticates; lets that key have its own bucket. */
export function markKeyValidated(authorization: string | undefined): void {
  const key = authorization?.match(BEARER_KEY_RE)?.[1];
  if (!key) return;
  const now = Date.now();
  for (const [k, exp] of validatedKeys) if (exp <= now) validatedKeys.delete(k);
  validatedKeys.set(sha(key), now + VALIDATED_TTL_MS);
}

function signedSessionToken(cookie: string | undefined, secret: string): string | null {
  const raw = cookie?.match(SESSION_COOKIE_RE)?.[1];
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  // Compare the canonical base64 text, not decoded bytes: Buffer.from is lenient about junk characters.
  const given = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(createHmac('sha256', secret).update(token).digest('base64'));
  return given.length === want.length && timingSafeEqual(given, want) ? token : null;
}

export function rateLimitKey(request: FastifyRequest, authSecret: string): string {
  const path = (request.url ?? '').split('?')[0] ?? '';
  const ownLimit = (request.routeOptions?.config as { rateLimit?: unknown } | undefined)?.rateLimit;
  if (ownLimit || path.startsWith('/api/auth/')) return `ip:${request.ip}`;

  const token = signedSessionToken(request.headers.cookie, authSecret);
  if (token) return `s:${sha(token)}`;
  const key = request.headers.authorization?.match(BEARER_KEY_RE)?.[1];
  if (key) {
    const hash = sha(key);
    if ((validatedKeys.get(hash) ?? 0) > Date.now()) return `k:${hash}`;
  }
  return `ip:${request.ip}`;
}
