/**
 * Exotel REST client — only what the own voice loop needs.
 *
 *   connectCall  dial a candidate and, when they answer, hand the call to a
 *                Voicebot app whose media stream points at apps/voice.
 *   getCall      authoritative status, duration and billed price for a call.
 *
 * No SDK: two form-encoded HTTPS calls with basic auth.
 */

import type { Env } from '../../config.js';

export interface ExotelCall {
  sid: string;
  status: string;
  durationSeconds: number | null;
  priceInr: number | null;
  recordingUrl: string | null;
}

export interface ExotelClient {
  isConfigured(): boolean;
  connectCall(input: { to: string; statusCallbackUrl: string; timeLimitSeconds: number }): Promise<ExotelCall>;
  getCall(callSid: string): Promise<ExotelCall>;
}

function toCall(raw: unknown): ExotelCall {
  const call = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['Call'] : null) as
    | Record<string, unknown>
    | null;
  if (!call || typeof call['Sid'] !== 'string') {
    throw new Error('Exotel returned no call');
  }
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    sid: call['Sid'],
    status: String(call['Status'] ?? 'unknown'),
    durationSeconds: n(call['Duration']),
    priceInr: n(call['Price']),
    recordingUrl: typeof call['RecordingUrl'] === 'string' && call['RecordingUrl'] ? call['RecordingUrl'] : null,
  };
}

export function createExotelClient(env: Env, fetchFn: typeof fetch = fetch): ExotelClient {
  const base = () =>
    `https://${env.EXOTEL_API_SUBDOMAIN}/v1/Accounts/${encodeURIComponent(env.EXOTEL_ACCOUNT_SID)}`;
  const auth = () =>
    `Basic ${Buffer.from(`${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}`).toString('base64')}`;

  return {
    isConfigured() {
      return Boolean(
        env.EXOTEL_ACCOUNT_SID &&
          env.EXOTEL_API_KEY &&
          env.EXOTEL_API_TOKEN &&
          env.EXOTEL_PHONE_NUMBER &&
          env.EXOTEL_OWN_LOOP_APP_ID,
      );
    },

    async connectCall({ to, statusCallbackUrl, timeLimitSeconds }) {
      const form = new URLSearchParams({
        From: to,
        CallerId: env.EXOTEL_PHONE_NUMBER,
        Url: `http://my.exotel.com/${env.EXOTEL_ACCOUNT_SID}/exoml/start_voice/${env.EXOTEL_OWN_LOOP_APP_ID}`,
        CallType: 'trans',
        TimeLimit: String(timeLimitSeconds),
        TimeOut: '40',
        Record: 'true',
        StatusCallback: statusCallbackUrl,
        'StatusCallbackEvents[0]': 'terminal',
        StatusCallbackContentType: 'application/json',
      });
      const res = await fetchFn(`${base()}/Calls/connect.json`, {
        method: 'POST',
        headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const message =
          body && typeof body === 'object'
            ? String(
                ((body as Record<string, unknown>)['RestException'] as Record<string, unknown> | undefined)?.[
                  'Message'
                ] ?? `HTTP ${res.status}`,
              )
            : `HTTP ${res.status}`;
        throw new Error(`Exotel could not place the call: ${message}`);
      }
      return toCall(body);
    },

    async getCall(callSid) {
      const res = await fetchFn(`${base()}/Calls/${encodeURIComponent(callSid)}.json`, {
        headers: { authorization: auth() },
      });
      if (!res.ok) throw new Error(`Exotel call lookup failed: HTTP ${res.status}`);
      return toCall(await res.json());
    },
  };
}

/** Exotel terminal statuses → our failure reasons (null = the call connected). */
export function exotelFailureReason(status: string): 'no_answer' | 'busy' | 'network' | null {
  switch (status) {
    case 'no-answer':
      return 'no_answer';
    case 'busy':
      return 'busy';
    case 'failed':
    case 'canceled':
      return 'network';
    default:
      return null;
  }
}

/** The own loop's carrier view of an Exotel call. */
export function exotelCarrier(client: ExotelClient) {
  return {
    async getCallOutcome(callId: string) {
      const call = await client.getCall(callId);
      const final = ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(call.status);
      return {
        final,
        failureReason: exotelFailureReason(call.status),
        durationSeconds: call.durationSeconds,
        priceInr: call.priceInr,
      };
    },
  };
}
