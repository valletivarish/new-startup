/** Verifying HRVoice webhook deliveries (Web Crypto, so it runs on Node, Deno, Bun and workers). */

import type { WebhookEvent } from './generated.ts';

export type CallCompletedEvent = WebhookEvent & { type: 'call.completed' };
export type CallFailedEvent = WebhookEvent & { type: 'call.failed' };
/** Every event HRVoice sends; switch on `type`. */
export type HRVoiceEvent = CallCompletedEvent | CallFailedEvent;

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

const utf8 = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Checks `HRVoice-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`
 * against the raw request body (before any JSON parsing) and returns the event.
 * Throws WebhookVerificationError on a bad signature or a timestamp more than
 * `toleranceSec` away from now (replay protection). The comparison is constant-time.
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  toleranceSec = 300,
  nowMs = Date.now(),
): Promise<HRVoiceEvent> {
  if (!header) throw new WebhookVerificationError('missing HRVoice-Signature header');
  const parts = new Map(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = parts.get('t') ?? '';
  const sig = hexToBytes(parts.get('v1') ?? '');
  if (!/^\d+$/.test(t) || !sig) throw new WebhookVerificationError('malformed HRVoice-Signature header');
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) {
    throw new WebhookVerificationError('HRVoice-Signature timestamp outside the tolerance');
  }
  const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // subtle.verify compares in constant time.
  if (!(await crypto.subtle.verify('HMAC', key, sig, utf8.encode(`${t}.${body}`)))) {
    throw new WebhookVerificationError('HRVoice-Signature does not match');
  }
  return JSON.parse(body) as HRVoiceEvent;
}
