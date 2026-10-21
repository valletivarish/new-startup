/** One /v1 request with the HRVoice credential, and the webhook signature check. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IDataObject, IExecuteFunctions, IHookFunctions, IHttpRequestMethods, ILoadOptionsFunctions } from 'n8n-workflow';

type Ctx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export async function hrvoice(
  ctx: Ctx,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<IDataObject> {
  const { baseUrl } = await ctx.getCredentials<{ baseUrl?: string }>('hrVoiceApi');
  return ctx.helpers.httpRequestWithAuthentication.call(ctx, 'hrVoiceApi', {
    method,
    url: `${(baseUrl || 'https://nexstopp.com/backend').replace(/\/$/, '')}${path}`,
    json: true,
    ...(body ? { body } : {}),
    ...(qs ? { qs } : {}),
  }) as Promise<IDataObject>;
}

/** HRVoice-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>. */
export function signatureOk(header: string | undefined, rawBody: string, secret: string, toleranceSec = 300, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = parts['t'] ?? '';
  const v1 = parts['v1'] ?? '';
  if (!/^\d+$/.test(t) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return false;
  const want = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(want, Buffer.from(v1, 'hex'));
}

export const LANGUAGES = [
  ['English', 'en'], ['Hindi', 'hi'], ['Bengali', 'bn'], ['Marathi', 'mr'], ['Telugu', 'te'], ['Tamil', 'ta'],
  ['Gujarati', 'gu'], ['Urdu', 'ur'], ['Kannada', 'kn'], ['Malayalam', 'ml'], ['Punjabi', 'pa'],
].map(([name, value]) => ({ name: name!, value: value! }));
