/**
 * Inbound email → ticket, provider-agnostic. Any mail provider that can POST
 * JSON {from, to, subject, text, inReplyTo?} to /webhooks/inbound-email with
 * our signature works (setup: docs/support-email.md).
 *
 * Signature: header `HRVoice-Signature: t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`,
 * the same scheme as our outbound webhooks, within 5 minutes of now.
 */

import { timingSafeEqual } from 'node:crypto';

import { signPayload } from '../integrations/deliver.js';

const REF_IN_ADDRESS = /\+([a-z0-9]{12})@/i;
const REF_IN_SUBJECT = /\[#([a-z0-9]{12})\]/i;
const TOLERANCE_S = 300;

/** The ticket ref from support+<ref>@…, then "[#<ref>]" in the subject, then In-Reply-To. */
export function ticketRefIn(mail: { to: string | string[]; subject: string; inReplyTo?: string | undefined }): string | null {
  for (const to of Array.isArray(mail.to) ? mail.to : mail.to.split(',')) {
    const m = REF_IN_ADDRESS.exec(to);
    if (m) return m[1]!.toLowerCase();
  }
  const s = REF_IN_SUBJECT.exec(mail.subject) ?? (mail.inReplyTo ? REF_IN_ADDRESS.exec(mail.inReplyTo) ?? REF_IN_SUBJECT.exec(mail.inReplyTo) : null);
  return s ? s[1]!.toLowerCase() : null;
}

/** The new part of a reply: everything above the quoted thread. */
export function visibleReply(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^>/.test(line)) break;
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From: .+/.test(line) && out.some((l) => l.trim() === '')) break;
    out.push(line);
  }
  return out.join('\n').trim().slice(0, 20_000);
}

export function verifyInboundSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  nowS: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts['t']);
  if (!Number.isInteger(t) || Math.abs(nowS - t) > TOLERANCE_S || !parts['v1']) return false;
  const expected = Buffer.from(signPayload(secret, t, rawBody), 'hex');
  const given = Buffer.from(parts['v1'], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
