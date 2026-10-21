/** HRVoice /v1 client: fetch-based, no runtime dependencies. */

import type {
  Call, Candidate, CandidateBatchCreated, CandidateCreate, CandidateCreated, ErrorBody, Job, JobCreate,
  JobPatch, Operations, Result, Usage, WebhookDelivery, WebhookEndpoint, WebhookEndpointCreate,
  WebhookEndpointCreated,
} from './generated.ts';

export type ErrorCode = ErrorBody['code'] | 'http_error' | 'network_error';

/** Any non-2xx answer, carrying the API's error envelope. */
export class HRVoiceError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string | undefined;
  /** Per-field problems on `validation_failed`. */
  readonly fields: { field: string; message: string }[];
  readonly details: Record<string, unknown>;

  constructor(status: number, body: Partial<ErrorBody> | undefined, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'HRVoiceError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'network_error' : 'http_error');
    this.requestId = body?.request_id;
    this.fields = body?.errors ?? [];
    this.details = body?.details ?? {};
  }

  /** When a rate or call limit lifts (`details.resetsAt`), if the API said. */
  get resetsAt(): Date | undefined {
    const r = this.details['resetsAt'];
    return typeof r === 'string' ? new Date(r) : undefined;
  }
}

export interface HRVoiceOptions {
  /** `hrv_live_...` or `hrv_test_...` (test keys place free calls on a fake line). */
  apiKey: string;
  /** Your HRVoice API origin, e.g. https://hiring.example.com. */
  baseUrl: string;
  /** Retries after a 429, 5xx, in-flight idempotent duplicate or network error. Default 2. */
  maxRetries?: number;
  /** A wait longer than this (e.g. a daily call limit) fails at once instead. Default 30 s. */
  maxRetryDelayMs?: number;
  /** Per attempt. Default 30 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Writes send an Idempotency-Key (a fresh UUID unless you pass one), reused across retries. */
export interface WriteOptions {
  idempotencyKey?: string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type OpKey = keyof Operations;
type Res<K extends OpKey> = Operations[K]['response'];

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

export class HRVoice {
  readonly #key: string;
  readonly #base: string;
  readonly #retries: number;
  readonly #maxDelay: number;
  readonly #timeout: number;
  readonly #fetch: typeof fetch;

  constructor(opts: HRVoiceOptions) {
    if (!opts?.apiKey) throw new TypeError('HRVoice: apiKey is required');
    if (!opts.baseUrl) throw new TypeError('HRVoice: baseUrl is required');
    this.#key = opts.apiKey;
    this.#base = opts.baseUrl.replace(/\/+$/, '');
    this.#retries = opts.maxRetries ?? 2;
    this.#maxDelay = opts.maxRetryDelayMs ?? 30_000;
    this.#timeout = opts.timeoutMs ?? 30_000;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** True for a `hrv_test_` key. */
  get isTest(): boolean {
    return this.#key.startsWith('hrv_test_');
  }

  // ---- Account ----

  /** Checks the key; returns its company and key mode. */
  ping(): Promise<Res<'GET /v1/ping'>> {
    return this.#json('GET', '/v1/ping');
  }

  /** The OpenAPI 3.1 document these types come from. */
  openApi(): Promise<Record<string, unknown>> {
    return this.#json('GET', '/v1/openapi.json');
  }

  // ---- Jobs ----

  async listJobs(): Promise<Job[]> {
    return (await this.#json<Res<'GET /v1/jobs'>>('GET', '/v1/jobs')).jobs;
  }

  /** `mustAskQuestions` are asked on every screen for this job. */
  createJob(job: JobCreate, opts?: WriteOptions): Promise<Job> {
    return this.#json('POST', '/v1/jobs', { body: job, ...opts });
  }

  getJob(id: string): Promise<Job> {
    return this.#json('GET', `/v1/jobs/${enc(id)}`);
  }

  updateJob(id: string, patch: JobPatch, opts?: WriteOptions): Promise<Job> {
    return this.#json('PATCH', `/v1/jobs/${enc(id)}`, { body: patch, ...opts });
  }

  // ---- Candidates ----

  /** One page; pass `nextCursor` back as `cursor` for the next. */
  listCandidates(jobId: string, query: Operations['GET /v1/jobs/{jobId}/candidates']['query'] = {}) {
    return this.#json<Res<'GET /v1/jobs/{jobId}/candidates'>>('GET', `/v1/jobs/${enc(jobId)}/candidates`, { query });
  }

  /**
   * Adds a candidate (`consent: true` is required). With an `externalId` already
   * on this job the candidate is updated in place and `created` is false.
   */
  addCandidate(jobId: string, candidate: CandidateCreate, opts?: WriteOptions): Promise<CandidateCreated> {
    return this.#json('POST', `/v1/jobs/${enc(jobId)}/candidates`, { body: candidate, ...opts });
  }

  /** 1-100 candidates in one request; same externalId rules as addCandidate. */
  async addCandidates(jobId: string, candidates: CandidateCreate[], opts?: WriteOptions): Promise<CandidateCreated[]> {
    const out = await this.#json<CandidateBatchCreated>('POST', `/v1/jobs/${enc(jobId)}/candidates`, {
      body: { candidates }, ...opts,
    });
    return out.candidates;
  }

  getCandidate(jobId: string, id: string): Promise<Candidate> {
    return this.#json('GET', `/v1/jobs/${enc(jobId)}/candidates/${enc(id)}`);
  }

  // ---- Calls and results ----

  /** Queues a screening call (202). Poll getCall or listen for call.completed / call.failed. */
  startCall(jobId: string, candidateId: string, opts?: WriteOptions): Promise<Call> {
    return this.#json('POST', `/v1/jobs/${enc(jobId)}/candidates/${enc(candidateId)}/calls`, { ...opts });
  }

  getCall(id: string): Promise<Call> {
    return this.#json('GET', `/v1/calls/${enc(id)}`);
  }

  /** The candidate's latest screen: answers, summary, transcript. Never a score. */
  getResults(jobId: string, candidateId: string): Promise<Result> {
    return this.#json('GET', `/v1/jobs/${enc(jobId)}/candidates/${enc(candidateId)}/results`);
  }

  /** Where the recording streams from (needs this key as a Bearer token). */
  recordingUrl(callId: string): string {
    return `${this.#base}/v1/calls/${enc(callId)}/recording`;
  }

  async getRecording(callId: string): Promise<{ contentType: string; data: ArrayBuffer }> {
    const res = await this.#send('GET', `/v1/calls/${enc(callId)}/recording`, {});
    return { contentType: res.headers.get('content-type') ?? 'application/octet-stream', data: await res.arrayBuffer() };
  }

  // ---- Usage ----

  /** Calls placed and billable screens for `month` (YYYY-MM, default this month IST). */
  getUsage(query: { month?: string } = {}): Promise<Usage> {
    return this.#json('GET', '/v1/usage', { query });
  }

  // ---- Candidate links ----

  /** A personal link for a candidate with no number: they consent and pick a time. */
  createCandidateLink(
    jobId: string,
    body: Operations['POST /v1/jobs/{jobId}/candidate-links']['body'] = {},
    opts?: WriteOptions,
  ): Promise<Res<'POST /v1/jobs/{jobId}/candidate-links'>> {
    return this.#json('POST', `/v1/jobs/${enc(jobId)}/candidate-links`, { body, ...opts });
  }

  // ---- Webhooks ----

  /** The returned `secret` is shown only here; keep it for verifyWebhook. */
  createWebhookEndpoint(body: WebhookEndpointCreate, opts?: WriteOptions): Promise<WebhookEndpointCreated> {
    return this.#json('POST', '/v1/webhook-endpoints', { body, ...opts });
  }

  async listWebhookEndpoints(): Promise<WebhookEndpoint[]> {
    return (await this.#json<Res<'GET /v1/webhook-endpoints'>>('GET', '/v1/webhook-endpoints')).endpoints;
  }

  deleteWebhookEndpoint(id: string, opts?: WriteOptions): Promise<{ deleted?: boolean }> {
    return this.#json('DELETE', `/v1/webhook-endpoints/${enc(id)}`, { ...opts });
  }

  async listWebhookDeliveries(query: Operations['GET /v1/webhook-deliveries']['query'] = {}): Promise<WebhookDelivery[]> {
    return (await this.#json<Res<'GET /v1/webhook-deliveries'>>('GET', '/v1/webhook-deliveries', { query })).deliveries;
  }

  resendWebhookDelivery(id: string, opts?: WriteOptions): Promise<WebhookDelivery> {
    return this.#json('POST', `/v1/webhook-deliveries/${enc(id)}/resend`, { ...opts });
  }

  // ---- Transport ----

  async #json<T>(method: Method, path: string, init: Req = {}): Promise<T> {
    const res = await this.#send(method, path, init);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async #send(method: Method, path: string, init: Req): Promise<Response> {
    const qs = new URLSearchParams(
      Object.entries(init.query ?? {}).filter((e): e is [string, string | number] => e[1] != null)
        .map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();
    const url = `${this.#base}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#key}`,
      accept: 'application/json',
    };
    if (method !== 'GET') headers['idempotency-key'] = init.idempotencyKey ?? crypto.randomUUID();
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method, headers, ...(body !== undefined ? { body } : {}),
          signal: AbortSignal.timeout(this.#timeout),
        });
      } catch (e) {
        if (attempt < this.#retries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new HRVoiceError(0, undefined, `HRVoice request failed: ${(e as Error).message}`);
      }
      if (res.ok) return res;

      const text = await res.text();
      let envelope: Partial<ErrorBody> | undefined;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object' && 'code' in parsed) envelope = parsed as ErrorBody;
      } catch {
        /* not JSON (a proxy page): keep the status only */
      }
      const err = new HRVoiceError(res.status, envelope, `HTTP ${res.status}`);
      const retryable = RETRY_STATUS.has(res.status) || err.code === 'idempotency_in_progress';
      if (!retryable || attempt >= this.#retries) throw err;
      const wait = retryDelay(res, err, attempt);
      if (wait > this.#maxDelay) throw err;
      await sleep(wait);
    }
  }
}

interface Req extends WriteOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/** 0.5 s, 1 s, 2 s ... capped at 8 s, with jitter. */
function backoff(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}

/** Honours `details.resetsAt` and `Retry-After`, never sooner than the backoff. */
function retryDelay(res: Response, err: HRVoiceError, attempt: number): number {
  let wait = backoff(attempt);
  const reset = err.resetsAt?.getTime();
  if (reset && Number.isFinite(reset)) wait = Math.max(wait, reset - Date.now());
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) wait = Math.max(wait, after * 1000);
  return wait;
}
