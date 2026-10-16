/** Hand-assembled OpenAPI 3.1 document for /v1 and the public candidate-link routes. */

import { z } from 'zod';

import * as S from './v1-schemas.js';

const schemas = {
  Error: S.V1Error, Job: S.V1Job, JobCreate: S.V1JobCreate, JobPatch: S.V1JobPatch,
  Candidate: S.V1Candidate, CandidateCreated: S.V1CandidateCreated,
  CandidateBatchCreated: S.V1CandidateBatchCreated, CandidateCreate: S.V1CandidateCreate, CandidateBatch: S.V1CandidateBatch,
  Result: S.V1Result, Call: S.V1Call, Usage: S.V1Usage,
  WebhookEndpointCreate: S.V1WebhookEndpointCreate, WebhookEndpoint: S.V1WebhookEndpoint,
  WebhookEndpointCreated: S.V1WebhookEndpointCreated, WebhookDelivery: S.V1WebhookDelivery,
  WebhookEvent: S.V1WebhookEvent, CandidateLinkCreate: S.V1CandidateLinkCreate,
  CandidateLinkSubmit: S.V1CandidateLinkSubmit,
};
// Requests are described by what a client may send (defaults optional); responses by what it gets.
const INPUT = new Set(['WebhookEndpointCreate', 'JobCreate', 'JobPatch', 'CandidateCreate', 'CandidateBatch', 'CandidateLinkSubmit']);

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ref('Error')) });
const obj = (properties: Record<string, object>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required });
const str = { type: 'string' };
const nullableStr = { type: ['string', 'null'] };
const uuidParam = (name: string) =>
  ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
const idemKey = { $ref: '#/components/parameters/IdempotencyKey' };

const ERRORS: Record<string, string> = {
  '401': 'unauthorized: missing or invalid API key.',
  '403': 'forbidden: the key lacks the scope for this route.',
  '404': 'not_found.',
  '409': 'conflict, agent_required, idempotency_in_progress, delivery_in_progress or link_phone_conflict.',
  '410': 'gone: the link expired or was already used.',
  '422': 'validation_failed, or consent_required when a candidate is created without "consent": true.',
  '429': 'rate_limited, or call_limit_reached / test_call_limit_reached (details.resetsAt is an ISO time).',
  '500': 'internal.',
};
const errorResponses = (...codes: string[]) =>
  Object.fromEntries(codes.map((c) => [c, err(ERRORS[c]!)]));

interface Op {
  summary: string;
  tag: string;
  params?: object[];
  body?: object;
  ok: Record<string, object>;
  errors?: string[];
  write?: boolean;
  noAuth?: boolean;
}

function op(o: Op) {
  return {
    summary: o.summary,
    tags: [o.tag],
    ...(o.noAuth ? { security: [] } : {}),
    parameters: [...(o.params ?? []), ...(o.write ? [idemKey] : [])],
    ...(o.body ? { requestBody: { required: true, content: json(o.body) } } : {}),
    responses: {
      ...o.ok,
      ...errorResponses(...(o.noAuth ? [] : ['401', '403']), ...(o.errors ?? []), '500'),
    },
  };
}

const ok = (status: string, description: string, schema?: object) =>
  ({ [status]: { description, ...(schema ? { content: json(schema) } : {}) } });
const arrayOf = (n: string) => ({ type: 'array', items: ref(n) });
const page = { name: 'cursor', in: 'query', schema: str };
const limit = { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } };
const token = { name: 'token', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9A-Za-z]{32}$' } };

const webhookOp = (event: string) => ({
  post: {
    summary: `Sent when a call ends (${event}).`,
    description:
      'Header `HRVoice-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. ' +
      'Respond 2xx to acknowledge; failures are retried and can be resent.',
    requestBody: { required: true, content: json(ref('WebhookEvent')) },
    responses: { '200': { description: 'Acknowledged.' } },
  },
});

export function buildOpenApi(): object {
  const components = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      const { $schema: _drop, ...js } = z.toJSONSchema(schema, {
        target: 'draft-2020-12',
        io: INPUT.has(name) ? 'input' : 'output',
      }) as Record<string, unknown>;
      return [name, js];
    }),
  );

  const jobId = uuidParam('jobId');
  const id = uuidParam('id');

  return {
    openapi: '3.1.0',
    info: {
      title: 'HRVoice API',
      version: '1.0.0',
      description:
        'Screen candidates by phone. Results never include scores or hire/reject advice. ' +
        'Calls through the API are placed 09:00-20:00 Asia/Kolkata; outside that they are `scheduled`. ' +
        'Keys starting `hrv_test_` create test data on a fake line: free and excluded from usage. ' +
        'Errors share one envelope (see the Error schema).',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    tags: ['Account', 'Jobs', 'Candidates', 'Calls', 'Usage', 'Webhooks', 'Candidate links'].map((name) => ({ name })),
    paths: {
      '/v1/ping': { get: op({ summary: 'Check the key and name its company.', tag: 'Account',
        ok: ok('200', 'OK', obj({ organizationId: { type: 'string', format: 'uuid' },
          apiKey: { oneOf: [obj({ id: str, mode: { enum: ['live', 'test'] } }), { type: 'null' }] } })) }) },
      '/v1/openapi.json': { get: op({ summary: 'This document.', tag: 'Account', noAuth: true,
        ok: ok('200', 'OpenAPI 3.1 document', { type: 'object' }) }) },
      '/v1/jobs': {
        get: op({ summary: 'List jobs.', tag: 'Jobs', ok: ok('200', 'OK', obj({ jobs: arrayOf('Job') })) }),
        post: op({ summary: 'Create a job.', tag: 'Jobs', write: true, body: ref('JobCreate'),
          ok: ok('201', 'Created', ref('Job')), errors: ['409', '422'] }),
      },
      '/v1/jobs/{id}': {
        get: op({ summary: 'Get a job.', tag: 'Jobs', params: [id], ok: ok('200', 'OK', ref('Job')), errors: ['404'] }),
        patch: op({ summary: 'Update a job.', tag: 'Jobs', params: [id], write: true, body: ref('JobPatch'),
          ok: ok('200', 'OK', ref('Job')), errors: ['404', '409', '422'] }),
      },
      '/v1/jobs/{jobId}/candidates': {
        get: op({ summary: 'List a job\'s candidates.', tag: 'Candidates', params: [jobId, limit, page],
          ok: ok('200', 'OK', obj({ candidates: arrayOf('Candidate'), nextCursor: nullableStr })), errors: ['404'] }),
        post: op({
          summary: 'Add one candidate, or {"candidates": [...]} (1-100). Same externalId updates in place.',
          tag: 'Candidates', params: [jobId], write: true,
          body: { oneOf: [ref('CandidateCreate'), ref('CandidateBatch')] },
          ok: {
            ...ok('201', 'Created (single candidate, or a batch)', {
              oneOf: [ref('CandidateCreated'), ref('CandidateBatchCreated')] }),
            ...ok('200', 'Existing candidate updated by externalId', ref('CandidateCreated')),
          },
          errors: ['404', '409', '422'] }),
      },
      '/v1/jobs/{jobId}/candidates/{id}': {
        get: op({ summary: 'Get a candidate.', tag: 'Candidates', params: [jobId, id],
          ok: ok('200', 'OK', ref('Candidate')), errors: ['404'] }),
      },
      '/v1/jobs/{jobId}/candidates/{id}/results': {
        get: op({ summary: 'Latest screen result.', tag: 'Candidates', params: [jobId, id],
          ok: ok('200', 'OK', ref('Result')), errors: ['404'] }),
      },
      '/v1/jobs/{jobId}/candidates/{id}/calls': {
        post: op({ summary: 'Queue a screening call.', tag: 'Calls', params: [jobId, id], write: true,
          ok: ok('202', 'Accepted; poll GET /v1/calls/{id} or use webhooks', ref('Call')),
          errors: ['404', '409', '422', '429'] }),
      },
      '/v1/calls/{id}': {
        get: op({ summary: 'Get a call and its result.', tag: 'Calls', params: [id],
          ok: ok('200', 'OK', ref('Call')), errors: ['404'] }),
      },
      '/v1/calls/{id}/recording': {
        get: op({ summary: 'Recording audio.', tag: 'Calls', params: [id],
          ok: { '200': { description: 'Audio', content: { 'audio/*': { schema: { type: 'string', format: 'binary' } } } } },
          errors: ['404'] }),
      },
      '/v1/usage': {
        get: op({ summary: 'Calls placed and billable screens for a month.', tag: 'Usage',
          params: [{ name: 'month', in: 'query', schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } }],
          ok: ok('200', 'OK', ref('Usage')), errors: ['422'] }),
      },
      '/v1/webhook-endpoints': {
        get: op({ summary: 'List webhook endpoints.', tag: 'Webhooks',
          ok: ok('200', 'OK', obj({ endpoints: arrayOf('WebhookEndpoint') })) }),
        post: op({ summary: 'Create an endpoint. The secret is returned only here.', tag: 'Webhooks', write: true,
          body: ref('WebhookEndpointCreate'), ok: ok('201', 'Created', ref('WebhookEndpointCreated')),
          errors: ['409', '422'] }),
      },
      '/v1/webhook-endpoints/{id}': {
        delete: op({ summary: 'Delete an endpoint.', tag: 'Webhooks', params: [id], write: true,
          ok: ok('200', 'Deleted', obj({ deleted: { type: 'boolean' } })), errors: ['404', '409'] }),
      },
      '/v1/webhook-deliveries': {
        get: op({ summary: 'Delivery log.', tag: 'Webhooks',
          params: [{ name: 'status', in: 'query', schema: { enum: ['pending', 'delivered', 'failed'] } }],
          ok: ok('200', 'OK', obj({ deliveries: arrayOf('WebhookDelivery') })), errors: ['422'] }),
      },
      '/v1/webhook-deliveries/{id}/resend': {
        post: op({ summary: 'Send a delivery again as a new delivery.', tag: 'Webhooks', params: [id], write: true,
          ok: ok('201', 'Queued', ref('WebhookDelivery')), errors: ['404', '409'] }),
      },
      '/v1/jobs/{jobId}/candidate-links': {
        post: op({ summary: 'Mint a link the candidate opens to consent and give their number.',
          tag: 'Candidate links', params: [jobId], body: ref('CandidateLinkCreate'),
          ok: ok('201', 'Created', obj({ url: str, expiresAt: str })), errors: ['404', '409', '422'] }),
      },
      '/public/candidate-links/{token}': {
        get: op({ summary: 'Describe a link (no auth, rate limited).', tag: 'Candidate links', noAuth: true,
          params: [token], ok: ok('200', 'OK', obj({ companyName: str, jobTitle: str, fullName: nullableStr, expiresAt: str })),
          errors: ['404', '410', '429'] }),
        post: op({ summary: 'Candidate submits number and consent; a call is queued (no auth, rate limited).',
          tag: 'Candidate links', noAuth: true, params: [token], body: ref('CandidateLinkSubmit'),
          ok: ok('201', 'Accepted', obj({ scheduledFor: nullableStr })),
          errors: ['404', '409', '410', '422', '429'] }),
      },
    },
    webhooks: { 'call.completed': webhookOp('call.completed'), 'call.failed': webhookOp('call.failed') },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'hrv_live_... or hrv_test_...' } },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 },
          description: 'Same key, method and path within 24 h replays the stored status and body.',
        },
      },
      schemas: components,
    },
  };
}
