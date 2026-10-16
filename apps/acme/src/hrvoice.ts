/** A thin fetch client over HR Voice /v1. ponytail: replaced by the SDK in the next plan. */

// Untyped JSON until the SDK brings the OpenAPI types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface HrvoiceResponse<T = Json> {
  status: number;
  body: T;
}

export interface HrvoiceClient {
  request<T = Json>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string },
  ): Promise<HrvoiceResponse<T>>;
}

export function createHrvoiceClient(baseUrl: string, apiKey: string): HrvoiceClient {
  const base = baseUrl.replace(/\/$/, '');
  return {
    async request(method, path, body, opts = {}) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON: keep the text */
      }
      return { status: res.status, body: parsed as Json };
    },
  };
}
