import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  ERROR_INFO,
  SCOPE_INFO,
  canResend,
  deliveryProblem,
  monthLabel,
  recentMonths,
  referenceFromOpenApi,
  scopeList,
  typeLabel,
} from './developers';

describe('scopes', () => {
  it('describes every scope the API knows', () => {
    for (const s of API_SCOPES) {
      expect(SCOPE_INFO[s].label).toBeTruthy();
      expect(SCOPE_INFO[s].description).toMatch(/\.$/);
    }
  });
  it('lists scopes by label and keeps unknown ones', () => {
    expect(scopeList(['jobs', 'results', 'tickets'])).toBe('Jobs, Results, tickets');
  });
});

describe('deliveryProblem', () => {
  const p = (lastError: string | null, lastStatusCode: number | null = null) =>
    deliveryProblem({ lastError, lastStatusCode });
  it('is empty when nothing failed', () => {
    expect(p(null)).toBe('');
    expect(p('  ')).toBe('');
  });
  it('names status codes in plain words', () => {
    expect(p('HTTP 500', 500)).toBe('Your server had an error (500).');
    expect(p('HTTP 404', 404)).toMatch(/Check the endpoint URL/);
    expect(p('HTTP 401', 401)).toMatch(/turned it away \(401\)/);
    expect(p('HTTP 302', 302)).toMatch(/redirect/);
    expect(p('HTTP 418')).toBe('Your server answered 418 instead of a 2xx.');
  });
  it('explains network failures, timeouts and our own reasons', () => {
    expect(p('fetch failed')).toBe('We couldn’t reach your server.');
    expect(p('The operation was aborted due to timeout')).toMatch(/10 seconds/);
    expect(p('expired')).toMatch(/24 hours/);
    expect(p('endpoint_deleted')).toMatch(/deleted/);
    expect(p('something odd')).toBe('It couldn’t be delivered: something odd');
  });
  it('lets finished deliveries be sent again', () => {
    expect(canResend({ status: 'failed' })).toBe(true);
    expect(canResend({ status: 'delivered' })).toBe(true);
    expect(canResend({ status: 'pending' })).toBe(false);
  });
});

describe('months', () => {
  it('counts back in India time, newest first', () => {
    // 31 Oct 2026 20:00 UTC is already 1 Nov in India.
    expect(recentMonths(3, new Date('2026-10-31T20:00:00Z'))).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(recentMonths(2, new Date('2026-01-15T00:00:00Z'))).toEqual(['2026-01', '2025-12']);
  });
  it('labels a month', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('typeLabel', () => {
  it('reads refs, unions, arrays, enums and formats', () => {
    expect(typeLabel({ $ref: '#/components/schemas/Job' })).toBe('Job');
    expect(typeLabel({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null');
    expect(typeLabel({ type: ['string', 'null'] })).toBe('string | null');
    expect(typeLabel({ type: 'array', items: { $ref: '#/components/schemas/Job' } })).toBe('Job[]');
    expect(typeLabel({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } })).toBe(
      '(string | null)[]',
    );
    expect(typeLabel({ enum: ['live', 'test'] })).toBe('"live" | "test"');
    expect(typeLabel({ type: 'boolean', const: true })).toBe('true');
    expect(typeLabel({ type: 'string', format: 'uuid' })).toBe('string (uuid)');
    expect(typeLabel({})).toBe('any');
  });
});

const DOC = {
  openapi: '3.1.0',
  info: { title: 'HRVoice API', version: '1.0.0' },
  security: [{ bearerAuth: [] }],
  tags: [{ name: 'Account' }, { name: 'Jobs' }, { name: 'Empty' }],
  paths: {
    '/v1/openapi.json': { get: { summary: 'This document.', tags: ['Account'], security: [], responses: {} } },
    '/v1/jobs': {
      get: {
        summary: 'List jobs.',
        tags: ['Jobs'],
        parameters: [],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { jobs: { type: 'array', items: { $ref: '#/components/schemas/Job' } } }, required: ['jobs'] },
              },
            },
          },
          '401': { description: 'unauthorized' },
        },
      },
      post: {
        summary: 'Create a job.',
        tags: ['Jobs'],
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/JobCreate' } } } },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } } } },
      },
    },
    '/v1/jobs/{jobId}/candidates': {
      post: {
        summary: 'Add candidates.',
        tags: ['Jobs'],
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { oneOf: [{ $ref: '#/components/schemas/JobCreate' }, { $ref: '#/components/schemas/Job' }] },
            },
          },
        },
        responses: {},
      },
    },
  },
  components: {
    parameters: { IdempotencyKey: { name: 'Idempotency-Key', in: 'header' } },
    schemas: {
      Error: { type: 'object', properties: { code: { enum: ['unauthorized', 'rate_limited'] } } },
      Job: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' } }, required: ['id', 'title'] },
      JobCreate: {
        type: 'object',
        properties: { title: { type: 'string', description: 'Shown to candidates.' }, language: { type: 'string', enum: ['en', 'hi'] } },
        required: ['title'],
      },
    },
  },
};

describe('referenceFromOpenApi', () => {
  const ref = referenceFromOpenApi(DOC);

  it('groups operations by tag in document order and drops empty tags', () => {
    expect(ref.title).toBe('HRVoice API');
    expect(ref.groups.map((g) => g.tag)).toEqual(['Account', 'Jobs']);
    expect(ref.groups[1]!.operations.map((o) => `${o.method} ${o.path}`)).toEqual([
      'GET /v1/jobs',
      'POST /v1/jobs',
      'POST /v1/jobs/{jobId}/candidates',
    ]);
  });

  it('marks public routes and idempotent writes', () => {
    const [openapi] = ref.groups[0]!.operations;
    expect(openapi!.auth).toBe(false);
    const [list, create] = ref.groups[1]!.operations;
    expect(list!.auth).toBe(true);
    expect(list!.idempotent).toBe(false);
    expect(create!.idempotent).toBe(true);
    expect(create!.params).toEqual([]);
  });

  it('resolves bodies and 2xx responses into fields', () => {
    const [list, create, add] = ref.groups[1]!.operations;
    expect(list!.responses).toEqual([
      { status: '200', description: 'OK', shape: { type: 'object', fields: [{ name: 'jobs', type: 'Job[]', required: true }] } },
    ]);
    expect(create!.body).toEqual({
      name: 'JobCreate',
      type: 'JobCreate',
      fields: [
        { name: 'title', type: 'string', required: true, description: 'Shown to candidates.' },
        { name: 'language', type: '"en" | "hi"', required: false },
      ],
    });
    expect(create!.responses[0]!.shape?.name).toBe('Job');
    expect(add!.params).toEqual([{ name: 'jobId', type: 'string (uuid), path', required: true }]);
    expect(add!.body?.variants?.map((v) => v.name)).toEqual(['JobCreate', 'Job']);
  });

  it('gives stable anchors and the error codes', () => {
    expect(ref.groups[1]!.operations[2]!.id).toBe('post-v1-jobs-jobid-candidates');
    expect(ref.errorCodes).toEqual(['unauthorized', 'rate_limited']);
  });

  it('survives a missing or broken document', () => {
    expect(referenceFromOpenApi(null)).toEqual({ title: 'API', version: '', groups: [], errorCodes: [] });
  });
});

describe('ERROR_INFO', () => {
  it('explains every error code with a 4xx or 5xx status', () => {
    for (const [code, info] of Object.entries(ERROR_INFO)) {
      expect(info.status, code).toBeGreaterThanOrEqual(400);
      expect(info.meaning, code).toMatch(/\.$/);
    }
    expect(ERROR_INFO['call_limit_reached']!.status).toBe(429);
  });
});
