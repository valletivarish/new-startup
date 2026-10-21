/**
 * Writes apiDefinition.swagger.json (Swagger 2.0 with x-ms-* extensions) for the
 * Power Automate / Power Apps custom connector from the API's own OpenAPI 3.1
 * document, so the connector cannot drift from /v1.
 *
 *   pnpm --filter @hrvoice/power-automate generate                 # from the source (same doc /v1/openapi.json serves)
 *   pnpm --filter @hrvoice/power-automate generate -- https://nexstopp.com/backend/v1/openapi.json
 *
 * ponytail: converts only the JSON Schema that z.toJSONSchema emits for /v1
 * (nullable unions, const, $ref, oneOf); extend `schema2` if the document grows.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildOpenApi } from '../../../apps/api/src/integrations/openapi.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The connector's operations: [method, /v1 path, operationId, summary, description, visibility, extra]. */
export const OPERATIONS: [string, string, string, string, string, 'important' | 'advanced' | 'internal'][] = [
  ['post', '/v1/jobs/{jobId}/candidates', 'AddCandidate', 'Add candidate',
    'Adds a candidate to a job. The candidate must have agreed to a screening call (consent = true). The same external ID updates the existing candidate.', 'important'],
  ['post', '/v1/jobs/{jobId}/candidates/{id}/calls', 'StartCall', 'Start screening call',
    'Queues a screening call. Calls are placed between 9:00 and 20:00 India time; outside those hours the call waits until 9:00.', 'important'],
  ['post', '/v1/tickets', 'RaiseTicket', 'Raise support ticket', 'Asks HRVoice support for help.', 'important'],
  ['post', '/v1/jobs', 'CreateJob', 'Create job', 'Creates a job with the questions every candidate must be asked.', 'important'],
  ['get', '/v1/jobs/{jobId}/candidates', 'FindCandidates', 'Find candidates',
    'Lists a job\'s candidates, or only those matching your external ID or a phone number.', 'advanced'],
  ['get', '/v1/calls/{id}', 'GetCall', 'Get call', 'A call\'s status, and its result once it has ended.', 'advanced'],
  ['get', '/v1/jobs/{jobId}/candidates/{id}/results', 'GetResults', 'Get results', 'The latest screening answers and summary for a candidate.', 'advanced'],
  ['get', '/v1/jobs', 'ListJobs', 'List jobs', 'Lists the company\'s jobs.', 'internal'],
  ['post', '/v1/webhook-endpoints', 'WhenCallEnds', 'When a screening call ends',
    'Triggers when a screening call completes (answers, summary, transcript) or fails (no answer, busy, voicemail, too short, skipped).', 'important'],
  ['delete', '/v1/webhook-endpoints/{id}', 'DeleteWebhook', 'Delete webhook', 'Removes the trigger\'s subscription.', 'internal'],
];

const DEFS = '#/definitions/';

/** OpenAPI 3.1 / JSON Schema 2020-12 node -> Swagger 2.0 schema. */
function schema2(s: Json): Json {
  if (!s || typeof s !== 'object') return s;
  if (s['$ref']) return { $ref: String(s['$ref']).replace('#/components/schemas/', DEFS) };
  const out: Json = {};
  let nullable = false;
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type' && Array.isArray(v)) {
      const t = v.filter((x) => x !== 'null');
      nullable = t.length < v.length;
      out['type'] = t[0];
    } else if (k === 'const') out['enum'] = [v];
    else if (k === 'oneOf' || k === 'anyOf') {
      const alts = (v as Json[]).filter((a) => a['type'] !== 'null');
      nullable ||= alts.length < (v as Json[]).length;
      Object.assign(out, schema2(alts[0]!));
    } else if (k === 'properties') {
      out[k] = Object.fromEntries(Object.entries(v as Json).map(([p, ps]) => [p, schema2(ps as Json)]));
    } else if (k === 'items') out[k] = schema2(v as Json);
    else if (k === 'additionalProperties') out[k] = typeof v === 'object' ? schema2(v as Json) : v;
    else if (['propertyNames', '$schema', 'exclusiveMinimum', 'exclusiveMaximum'].includes(k)) continue;
    else out[k] = v;
  }
  // Zod's email and uuid regexes (lookaheads, alternations) are noise to the designer; format says enough.
  if (out['format'] === 'email' || out['format'] === 'uuid') delete out['pattern'];
  if (out['enum'] && !out['type']) out['type'] = typeof out['enum'][0] === 'boolean' ? 'boolean' : 'string';
  if (nullable) out['x-nullable'] = true;
  return out;
}

const resolveParam = (doc: Json, p: Json): Json =>
  p['$ref'] ? doc['components']['parameters'][String(p['$ref']).split('/').pop()!] : p;

function param2(doc: Json, p: Json): Json {
  const q = resolveParam(doc, p);
  const s = schema2(q['schema'] ?? { type: 'string' });
  const { $ref: _r, ...flat } = s;
  return {
    name: q['name'],
    in: q['in'],
    required: q['in'] === 'path' ? true : Boolean(q['required']),
    ...(q['description'] ? { description: q['description'] } : {}),
    type: flat['type'] ?? 'string',
    ...Object.fromEntries(Object.entries(flat).filter(([k]) => ['format', 'enum', 'minimum', 'maximum', 'default', 'pattern', 'maxLength'].includes(k))),
  };
}

/** Swagger 2.0 for the connector; `host`/`basePath` locate the public API. */
export function buildSwagger(doc: Json, host = 'nexstopp.com', basePath = '/backend'): Json {
  const paths: Json = {};
  for (const [method, path, operationId, summary, description, visibility] of OPERATIONS) {
    const src = doc['paths'][path]?.[method];
    if (!src) throw new Error(`${method.toUpperCase()} ${path} is not in /v1/openapi.json`);
    const parameters: Json[] = (src['parameters'] ?? [])
      .map((p: Json) => param2(doc, p))
      // Power Automate retries on its own; an Idempotency-Key field would only confuse.
      .filter((p: Json) => p['name'] !== 'Idempotency-Key');
    for (const p of parameters) {
      if (p['name'] === 'jobId') Object.assign(p, {
        'x-ms-summary': 'Job',
        'x-ms-dynamic-values': { operationId: 'ListJobs', 'value-collection': 'jobs', 'value-path': 'id', 'value-title': 'title' },
      });
      else if (p['name'] === 'id') p['x-ms-summary'] = path.includes('candidates') ? 'Candidate ID' : path.includes('calls') ? 'Call ID' : 'ID';
      else p['x-ms-summary'] ??= p['name'];
    }
    const body = src['requestBody']?.['content']?.['application/json']?.['schema'];
    if (body) {
      // AddCandidate takes one candidate here; batches are for code.
      const one = body['oneOf'] ? body['oneOf'][0] : body;
      parameters.push({ name: 'body', in: 'body', required: true, schema: schema2(one) });
    }
    const responses: Json = {};
    for (const [status, r] of Object.entries(src['responses'] as Json)) {
      const s = (r as Json)['content']?.['application/json']?.['schema'];
      responses[status] = {
        description: (r as Json)['description'],
        ...(s ? { schema: schema2(s['oneOf'] ? s['oneOf'][0] : s) } : {}),
        ...((r as Json)['headers'] ? { headers: Object.fromEntries(Object.keys((r as Json)['headers']).map((h) => [h, { type: 'string' }])) } : {}),
      };
    }
    const op: Json = { operationId, summary, description, 'x-ms-visibility': visibility, parameters, responses };
    if (operationId === 'WhenCallEnds') {
      // A webhook trigger: Power Automate posts its callback URL here, then DELETEs the Location header to unsubscribe.
      op['x-ms-trigger'] = 'single';
      op['parameters'] = [{
        name: 'body', in: 'body', required: true,
        schema: {
          type: 'object', required: ['url', 'events'],
          properties: {
            url: { type: 'string', 'x-ms-notification-url': true, 'x-ms-visibility': 'internal', title: 'Callback URL' },
            events: {
              type: 'array', title: 'Events', description: 'Which call outcomes start the flow.',
              items: { type: 'string', enum: ['call.completed', 'call.failed'] },
              default: ['call.completed', 'call.failed'],
            },
          },
        },
      }];
      op['x-ms-notification-content'] = { description: 'The call event', schema: { $ref: `${DEFS}WebhookEvent` } };
    }
    (paths[path] ??= {})[method] = op;
  }

  // Only the definitions the chosen operations reach.
  const all = doc['components']['schemas'] as Json;
  const used = new Set<string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (k === '$ref' && typeof v === 'string' && v.startsWith(DEFS)) {
          const name = v.slice(DEFS.length);
          if (!used.has(name)) {
            used.add(name);
            walk(schema2(all[name]));
          }
        } else walk(v);
      }
    }
  };
  walk(paths);

  return {
    swagger: '2.0',
    info: {
      title: 'HRVoice',
      description: 'Phone-screen candidates and get their answers when the call ends. Results never include scores or hire/reject advice.',
      version: String(doc['info']['version']),
    },
    host,
    basePath,
    schemes: ['https'],
    consumes: ['application/json'],
    produces: ['application/json'],
    paths,
    definitions: Object.fromEntries([...used].sort().map((n) => [n, schema2(all[n])])),
    securityDefinitions: { api_key: { type: 'apiKey', in: 'header', name: 'Authorization' } },
    security: [{ api_key: [] }],
    'x-ms-connector-metadata': [
      { propertyName: 'Website', propertyValue: 'https://nexstopp.com' },
      { propertyName: 'Categories', propertyValue: 'Human Resources;Productivity' },
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const from = process.argv[2];
  const doc = from ? ((await (await fetch(from)).json()) as Json) : (buildOpenApi() as Json);
  const out = join(import.meta.dirname, '..', 'apiDefinition.swagger.json');
  writeFileSync(out, `${JSON.stringify(buildSwagger(doc), null, 2)}\n`);
  console.log(`wrote ${out}`);
}
