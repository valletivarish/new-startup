/**
 * Settings → Developers (API keys, webhooks, delivery log, usage) and the pure helpers the
 * public /developers page shares: scope wording, plain delivery errors, and the API
 * reference model read from /v1/openapi.json.
 */

import { call } from './api';

// --- API keys -----------------------------------------------------------------------

export const API_SCOPES = ['jobs', 'candidates', 'calls', 'results', 'webhooks', 'usage', 'support'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** What each scope lets a key do, in a recruiter's words. Order matches API_SCOPES. */
export const SCOPE_INFO: Record<ApiScope, { label: string; description: string }> = {
  jobs: { label: 'Jobs', description: 'Create, change and list jobs and their must-ask questions.' },
  candidates: { label: 'Candidates', description: 'Add and read candidates, including their phone numbers.' },
  calls: { label: 'Calls', description: 'Start screening calls and check how they went.' },
  results: { label: 'Results', description: 'Read answers, summaries, transcripts and recordings.' },
  webhooks: { label: 'Webhooks', description: 'Add and remove webhook endpoints and read the delivery log.' },
  usage: { label: 'Usage', description: 'Read calls placed and completed screens for a month.' },
  support: { label: 'Support', description: 'Raise support tickets with us, read them and reply.' },
};

/** "Jobs, Calls" for a key's scopes; unknown scopes keep their raw name. */
export function scopeList(scopes: readonly string[]): string {
  return scopes.map((s) => (Object.hasOwn(SCOPE_INFO, s) ? SCOPE_INFO[s as ApiScope].label : s)).join(', ');
}

export type ApiKeyMode = 'live' | 'test';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  mode: ApiKeyMode;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const listApiKeys = () => call<{ keys: ApiKey[] }>('/backend/organization/api-keys');

/** The raw key is in this answer only. */
export const createApiKey = (input: { name: string; mode: ApiKeyMode; scopes: ApiScope[] }) =>
  call<{ id: string; key: string; prefix: string }>('/backend/organization/api-keys', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const revokeApiKey = (id: string) =>
  call<null>(`/backend/organization/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });

// --- Webhooks -------------------------------------------------------------------------

export const WEBHOOK_EVENTS = ['call.completed', 'call.failed', 'ticket.updated'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_INFO: Record<WebhookEvent, string> = {
  'call.completed': 'A screen finished: answers, summary and transcript.',
  'call.failed': 'A call could not go ahead: no answer, voicemail, skipped or an error.',
  'ticket.updated': 'A support ticket you raised got a reply or changed status.',
};

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export const listWebhooks = () => call<{ endpoints: WebhookEndpoint[] }>('/backend/organization/webhooks');

/** The signing secret is in this answer only. */
export const createWebhook = (input: { url: string; events: WebhookEvent[] }) =>
  call<{ id: string; secret: string }>('/backend/organization/webhooks', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const deleteWebhook = (id: string) =>
  call<null>(`/backend/organization/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listDeliveries = () =>
  call<{ deliveries: WebhookDelivery[] }>('/backend/organization/webhooks/deliveries');

export const resendDelivery = (id: string) =>
  call<WebhookDelivery>(`/backend/organization/webhooks/deliveries/${encodeURIComponent(id)}/resend`, {
    method: 'POST',
  });

/** Why the last attempt failed, in plain words. Empty when nothing went wrong. */
export function deliveryProblem(d: Pick<WebhookDelivery, 'lastError' | 'lastStatusCode'>): string {
  const error = d.lastError?.trim();
  if (!error) return '';
  if (error === 'expired') return 'We stopped trying after 24 hours.';
  if (error === 'endpoint_deleted') return 'The endpoint was deleted before it could be sent.';
  const code = d.lastStatusCode ?? Number(/^HTTP (\d{3})$/.exec(error)?.[1] ?? NaN);
  if (Number.isFinite(code)) {
    if (code >= 300 && code < 400) return `Your server answered with a redirect (${code}). We don’t follow redirects.`;
    if (code === 401 || code === 403) return `Your server turned it away (${code}). Check its sign-in or firewall rules.`;
    if (code === 404) return 'Your server answered 404. Check the endpoint URL.';
    if (code >= 500) return `Your server had an error (${code}).`;
    return `Your server answered ${code} instead of a 2xx.`;
  }
  if (/timeout|timed out|aborted/i.test(error)) return 'Your server took longer than 10 seconds to answer.';
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNRESET|socket/i.test(error)) {
    return 'We couldn’t reach your server.';
  }
  return `It couldn’t be delivered: ${error}`;
}

/** Delivered and failed deliveries can be sent again; pending ones are still being tried. */
export const canResend = (d: Pick<WebhookDelivery, 'status'>) => d.status !== 'pending';

// --- Usage ----------------------------------------------------------------------------

export interface MonthUsage {
  month: string;
  callsPlaced: number;
  completedScreens: number;
  pricePerScreenInr: number | null;
  amountInr: number | null;
}

export const getMonthUsage = (month: string) =>
  call<MonthUsage>(`/backend/organization/usage?month=${encodeURIComponent(month)}`);

const IST_OFFSET_MS = 330 * 60_000;

/** The last `count` months, newest first, as YYYY-MM in India time. */
export function recentMonths(count: number, now: Date = new Date()): string[] {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** "October 2026" for "2026-10". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// --- API reference (from the OpenAPI document) ----------------------------------------

type Json = Record<string, unknown>;

export interface RefField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

/** A body or response: a schema name (when it is one), and its fields when it is an object. */
export interface RefShape {
  name?: string;
  type: string;
  fields: RefField[];
  /** For a body that is one of several shapes ("one candidate, or a batch"). */
  variants?: RefShape[];
}

export interface RefOperation {
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  auth: boolean;
  idempotent: boolean;
  params: RefField[];
  body?: RefShape;
  responses: { status: string; description: string; shape?: RefShape }[];
}

export interface RefGroup {
  tag: string;
  operations: RefOperation[];
}

export interface ApiReference {
  title: string;
  version: string;
  groups: RefGroup[];
  errorCodes: string[];
}

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const refName = (ref: unknown) => (typeof ref === 'string' ? ref.split('/').pop() : undefined);

/** A short type for a JSON schema: "string", "string | null", "Job[]", "\"en\" | \"hi\"". */
export function typeLabel(schema: unknown): string {
  if (!isObj(schema)) return 'any';
  const name = refName(schema['$ref']);
  if (name) return name;
  if ('const' in schema) return JSON.stringify(schema['const']);
  if (Array.isArray(schema['enum'])) return schema['enum'].map((v) => JSON.stringify(v)).join(' | ');
  const union = (schema['anyOf'] ?? schema['oneOf']) as unknown;
  if (Array.isArray(union)) return union.map(typeLabel).join(' | ');
  const type = schema['type'];
  if (Array.isArray(type)) return type.join(' | ');
  if (type === 'array') {
    const inner = typeLabel(schema['items']);
    return inner.includes(' ') ? `(${inner})[]` : `${inner}[]`;
  }
  if (type === 'string' && typeof schema['format'] === 'string' && schema['format'] !== 'email') {
    return `string (${schema['format']})`;
  }
  if (typeof type === 'string') return type;
  return 'any';
}

function shapeOf(schema: unknown, components: Json, depth = 0): RefShape | undefined {
  if (!isObj(schema)) return undefined;
  const name = refName(schema['$ref']);
  const resolved = name && isObj(components[name]) ? (components[name] as Json) : schema;
  const union = schema['oneOf'] ?? schema['anyOf'];
  if (!name && Array.isArray(union) && depth === 0) {
    return {
      type: typeLabel(schema),
      fields: [],
      variants: union.map((s) => shapeOf(s, components, 1)).filter((s): s is RefShape => Boolean(s)),
    };
  }
  const props = isObj(resolved['properties']) ? (resolved['properties'] as Json) : {};
  const required = new Set(Array.isArray(resolved['required']) ? (resolved['required'] as string[]) : []);
  return {
    ...(name ? { name } : {}),
    type: name ?? typeLabel(resolved),
    fields: Object.entries(props).map(([field, s]) => ({
      name: field,
      type: typeLabel(s),
      required: required.has(field),
      ...(isObj(s) && typeof s['description'] === 'string' ? { description: s['description'] } : {}),
    })),
  };
}

/** The OpenAPI document as groups of readable operations, in the document's tag order. */
export function referenceFromOpenApi(doc: unknown): ApiReference {
  const d = isObj(doc) ? doc : {};
  const info = isObj(d['info']) ? d['info'] : {};
  const components = isObj(d['components']) ? d['components'] : {};
  const schemas = isObj(components['schemas']) ? (components['schemas'] as Json) : {};
  const sharedParams = isObj(components['parameters']) ? (components['parameters'] as Json) : {};
  const paths = isObj(d['paths']) ? d['paths'] : {};
  const defaultAuth = Array.isArray(d['security']) && d['security'].length > 0;

  const byTag = new Map<string, RefOperation[]>();
  const tagOrder = Array.isArray(d['tags']) ? d['tags'].map((t) => (isObj(t) ? String(t['name']) : '')) : [];
  for (const t of tagOrder) byTag.set(t, []);

  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const rawParams = Array.isArray(op['parameters']) ? op['parameters'] : [];
      let idempotent = false;
      const params: RefField[] = [];
      for (const p of rawParams) {
        const param = isObj(p) && refName(p['$ref']) ? sharedParams[refName(p['$ref'])!] : p;
        if (!isObj(param)) continue;
        if (param['name'] === 'Idempotency-Key') {
          idempotent = true;
          continue;
        }
        params.push({
          name: String(param['name']),
          type: `${typeLabel(param['schema'])}, ${String(param['in'])}`,
          required: param['required'] === true,
          ...(typeof param['description'] === 'string' ? { description: param['description'] } : {}),
        });
      }
      const reqBody = isObj(op['requestBody']) ? op['requestBody'] : null;
      const reqContent = reqBody && isObj(reqBody['content']) ? (reqBody['content'] as Json) : {};
      const reqJson = isObj(reqContent['application/json']) ? (reqContent['application/json'] as Json) : null;
      const body = reqJson ? shapeOf(reqJson['schema'], schemas) : undefined;

      const responses = Object.entries(isObj(op['responses']) ? op['responses'] : {})
        .filter(([status]) => status.startsWith('2'))
        .map(([status, r]) => {
          const res = isObj(r) ? r : {};
          const content = isObj(res['content']) ? (res['content'] as Json) : {};
          const first = Object.values(content)[0];
          const shape = isObj(first) ? shapeOf(first['schema'], schemas) : undefined;
          return { status, description: String(res['description'] ?? ''), ...(shape ? { shape } : {}) };
        });

      const tag = Array.isArray(op['tags']) && typeof op['tags'][0] === 'string' ? op['tags'][0] : 'Other';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({
        id: `${method}-${path}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase(),
        method: method.toUpperCase(),
        path,
        summary: String(op['summary'] ?? ''),
        ...(typeof op['description'] === 'string' ? { description: op['description'] } : {}),
        auth: Array.isArray(op['security']) ? op['security'].length > 0 : defaultAuth,
        idempotent,
        params,
        ...(body ? { body } : {}),
        responses,
      });
    }
  }

  const error = isObj(schemas['Error']) ? (schemas['Error'] as Json) : {};
  const errorProps = isObj(error['properties']) ? (error['properties'] as Json) : {};
  const code = isObj(errorProps['code']) ? errorProps['code'] : {};
  return {
    title: String(info['title'] ?? 'API'),
    version: String(info['version'] ?? ''),
    groups: [...byTag].filter(([, ops]) => ops.length > 0).map(([tag, operations]) => ({ tag, operations })),
    errorCodes: Array.isArray(code['enum']) ? code['enum'].map(String) : [],
  };
}

/** HTTP status and meaning of each error code in the API's Error schema. */
export const ERROR_INFO: Record<string, { status: number; meaning: string }> = {
  unauthorized: { status: 401, meaning: 'The key is missing, wrong or revoked.' },
  forbidden: { status: 403, meaning: 'The key doesn’t have the scope for this, or its creator lost access.' },
  not_found: { status: 404, meaning: 'No such job, candidate, call or endpoint in your company.' },
  conflict: { status: 409, meaning: 'The request clashes with the current state, such as a call already running.' },
  link_phone_conflict: { status: 409, meaning: 'That phone number already belongs to another candidate on this job.' },
  gone: { status: 410, meaning: 'The candidate link was used or has expired.' },
  validation_failed: { status: 422, meaning: 'A field is missing or wrong; errors[] names each one.' },
  consent_required: { status: 422, meaning: 'Candidates need "consent": true before they can be added.' },
  agent_required: { status: 409, meaning: 'Your company needs one published hiring voice before jobs can be created.' },
  idempotency_in_progress: { status: 409, meaning: 'A request with the same Idempotency-Key is still running. Retry shortly.' },
  delivery_in_progress: { status: 409, meaning: 'That webhook delivery is still being retried.' },
  rate_limited: { status: 429, meaning: 'Too many requests for this key. Wait and retry.' },
  call_limit_reached: { status: 429, meaning: 'Your daily, concurrent or monthly call limit is reached. details.resetsAt says when it lifts.' },
  test_call_limit_reached: { status: 429, meaning: 'The test line’s limit (100 a day, 3 at once) is reached. details.resetsAt says when it lifts.' },
  service_unavailable: { status: 503, meaning: 'The call couldn’t be queued just now. Retry shortly.' },
  internal: { status: 500, meaning: 'Something failed on our side. Quote request_id if you contact us.' },
};
