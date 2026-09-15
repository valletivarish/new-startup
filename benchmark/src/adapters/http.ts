/**
 * HTTP helper for benchmark adapters.
 *
 * `fetch` only — no provider SDKs anywhere in this repository, which keeps the
 * dependency surface at zero and makes the "no SDK in production" boundary
 * trivially true rather than merely enforced.
 *
 * Errors carry the HTTP status so `classify()` can distinguish a rate limit
 * from a bad key from an exhausted quota, and a redacted body so a failure is
 * debuggable without printing a credential.
 */

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string, body: string) {
    // 2000, not 400. The field that distinguishes a transient rate limit from
    // an exhausted daily quota can sit past the 500th character of a real error
    // envelope, and truncating it away turned a spend wall into a retry loop.
    super(`HTTP ${status} ${statusText}: ${redact(body).slice(0, 2000)}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Strip anything credential-shaped before it can reach a log or a stored result.
 *
 * Benchmark output is committed and shared; a key leaking into `errors.json`
 * would be a real incident.
 */
export function redact(text: string): string {
  return (
    text
      // ORDER MATTERS. The scheme-prefixed forms must go first: a generic
      // `authorization:\s*<word>` pattern would otherwise consume the word
      // "Bearer" as if it were the value and leave the actual token exposed.
      // That was a real bug, caught by a test, and it would have written live
      // credentials into stored run output.
      .replace(/\b(Bearer|Token|Basic)\s+[\w.\-+/=]+/gi, '$1 [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
      // Named credentials in PROSE, not just as `name: value`. An error body or
      // a log line saying "your api key abc123 is invalid" matched none of the
      // structured patterns, and the value went to disk in clear text.
      .replace(
        /\b((?:api|subscription|secret|access|auth|private)[\s_-]?(?:key|token)|apikey|api_key)\b([\s:=]+)["']?([\w.\-+/=]{8,})["']?/gi,
        '$1$2[REDACTED]',
      )
      // Provider key prefixes that are recognisable on their own.
      .replace(/\b(dg|xi|cs|sk|pk|rk)_[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
      // Google API keys have their own recognisable prefix and match none of
      // the patterns above.
      .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
      // A bare `key=` or `key:` label, which the named-field list above misses.
      .replace(/\b(key)\b([\s:=]+)["']?([\w.\-+/=]{16,})["']?/gi, '$1$2[REDACTED]')
      .replace(
        /("?(?:api[_-]?key|api[_-]?subscription[_-]?key|authorization|token|secret|subscription[_-]?key|x-api-key)"?\s*[:=]\s*)"?[\w.\-+/=]+"?/gi,
        '$1"[REDACTED]"',
      )
  );
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Malformed JSON response: ${redact(text).slice(0, 200)}`);
  }
}

/**
 * What we actually send as a request body.
 *
 * Spelled out rather than using the DOM's `BodyInit`, because this package
 * compiles with node types only and pulling in the DOM lib to name one type
 * would widen the global surface for no benefit.
 */
export type FetchBody = string | Uint8Array | FormData | Blob;

export async function postBinary(
  url: string,
  body: FetchBody,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(response.status, response.statusText, text);
  }
  return response;
}

/** Collect an async iterable of frames into one buffer, for batch APIs. */
export async function collect(audio: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of audio) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Stream a fetch Response body as chunks.
 *
 * The `finally` is load-bearing. The TTS runner stops at the first byte by
 * breaking out of its loop, which calls `return()` on this generator. Without
 * cancelling the reader the response body stays locked and un-consumed: the
 * request is never torn down, the socket is held until undici's body timeout,
 * and the process can hang for minutes after the last measurement.
 */
export async function* streamBody(response: Response): AsyncIterable<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response has no readable body');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    await reader.cancel().catch(() => { /* already closed */ });
  }
}
