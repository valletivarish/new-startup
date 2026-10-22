/**
 * Who a request is, for the global rate limiter.
 *
 * - Valid Better Auth session cookie -> that session ("s:<hash>"). The cookie is
 *   `<token>.<base64 HMAC-SHA256(secret, token)>`, so we verify the signature locally
 *   with the auth secret: no DB hit, and a forged/garbled cookie fails here and falls
 *   back to the IP bucket (it cannot mint fresh buckets).
 * - `Authorization: Bearer hrv_…` -> that key ("k:<hash>"). Can't be validated without
 *   the DB, so a made-up key gets its own bucket; auth still rejects it, and a 190-bit
 *   key can't be guessed. (ponytail: if forged-key DB load matters, add an IP cap on /v1.)
 * - Everything else, `/api/auth/*` (sign-in/up brute force) and routes with their own
 *   stricter `rateLimit` config -> client IP.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const sha = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 22);
const BEARER_KEY_RE = /^Bearer (hrv_(?:live|test)_[A-Za-z0-9]{32})$/;
const SESSION_COOKIE_RE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/;

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
  if (key) return `k:${sha(key)}`;
  return `ip:${request.ip}`;
}
