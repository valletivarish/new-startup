import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type ApiHarness } from './setup/api-harness.js';

let api: ApiHarness;
type Doc = { paths: Record<string, Record<string, unknown>>; webhooks: object; components: { schemas: object } };
let doc: Doc;

beforeAll(async () => {
  api = await startApi();
  const res = await api.request({ method: 'GET', url: '/v1/openapi.json' });
  expect(res.statusCode, res.body).toBe(200);
  doc = JSON.parse(res.body) as Doc;
});
afterAll(async () => {
  await api.close();
});

/** Param names are merged in the radix tree (":id|:jobId"), so compare shapes: every param is "{}". */
const shape = (path: string) => path.replace(/:\w+(\|:\w+)*|\{\w+\}/g, '{}');

/** [METHOD, path] for every registered route, rebuilt from the Fastify radix-tree dump. */
function registeredRoutes(): [string, string][] {
  const fastify = api.built.app.getHttpAdapter().getInstance();
  const out: [string, string][] = [];
  const stack: string[] = [];
  for (const line of fastify.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^((?:[│ ]   )*)[├└]── (\S*) \(([A-Z, ]+)\)/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack[depth] = m[2]!;
    for (const method of m[3]!.split(', ')) if (method !== 'HEAD') out.push([method, stack.join('')]);
  }
  return out;
}

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 with bearer auth, webhooks and Idempotency-Key', () => {
    expect((doc as unknown as { openapi: string }).openapi).toBe('3.1.0');
    expect(Object.keys(doc.webhooks)).toEqual(['call.completed', 'call.failed']);
    expect(JSON.stringify(doc)).toContain('bearerAuth');
    expect(JSON.stringify(doc)).toContain('Idempotency-Key');
  });

  it('matches the code: links answer 404 (never 410), queuing a call can be 503, resend re-queues', () => {
    const responses = (path: string, method: string) =>
      Object.keys((doc.paths[path]![method] as { responses: object }).responses);
    for (const method of ['get', 'post']) {
      expect(responses('/public/candidate-links/{token}', method)).not.toContain('410');
    }
    expect(JSON.stringify(doc)).not.toContain('"410"');
    expect(responses('/v1/jobs/{jobId}/candidates/{id}/calls', 'post')).toContain('503');
    const resend = doc.paths['/v1/webhook-deliveries/{id}/resend']!['post'] as { summary: string };
    expect(resend.summary).toMatch(/same delivery/);
  });

  it('documents every /v1 and /public/candidate-links route', () => {
    const routes = registeredRoutes().filter(([, p]) => /^\/(v1\/|public\/candidate-links)/.test(p));
    expect(routes.length).toBeGreaterThanOrEqual(15);
    const documented = new Map(Object.entries(doc.paths).map(([p, ops]) => [shape(p), ops]));
    const missing = routes.filter(([method, path]) => !documented.get(shape(path))?.[method.toLowerCase()]);
    expect(missing).toEqual([]);
  });

  it('gives every response a non-empty description and every $ref a target', () => {
    const bad: string[] = [];
    const schemas = doc.components.schemas as Record<string, unknown>;
    const walkRefs = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walkRefs);
      if (n && typeof n === 'object') {
        for (const [k, v] of Object.entries(n)) {
          if (k === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/') && !(v.slice(21) in schemas)) bad.push(v);
          walkRefs(v);
        }
      }
    };
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, o] of Object.entries(ops)) {
        const responses = (o as { responses: Record<string, { description?: unknown }> }).responses;
        for (const [status, r] of Object.entries(responses)) {
          if (typeof r.description !== 'string' || r.description === '') bad.push(`${method} ${path} ${status}`);
        }
      }
    }
    walkRefs(doc);
    expect(bad).toEqual([]);
  });

  it('never mentions fitPercent as a property', () => {
    const found: string[] = [];
    const walk = (node: unknown, at: string) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${at}[${i}]`));
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === 'fitPercent') found.push(at);
          walk(v, `${at}.${k}`);
        }
      }
    };
    walk(doc, '$');
    expect(found).toEqual([]);
  });
});
