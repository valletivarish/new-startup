import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';

import { buildOpenApi } from '../../../apps/api/src/integrations/openapi.ts';
import { OPERATIONS, buildSwagger } from '../scripts/generate.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const root = join(import.meta.dirname, '..');
const committed = JSON.parse(readFileSync(join(root, 'apiDefinition.swagger.json'), 'utf8')) as Json;
const ops = Object.values(committed['paths'] as Json).flatMap((p) => Object.values(p as Json)) as Json[];
const byId = (id: string) => ops.find((o) => o['operationId'] === id)!;

describe('Power Automate connector', () => {
  it('is exactly what the generator makes from /v1/openapi.json (run `pnpm --filter @hrvoice/power-automate generate`)', () => {
    expect(committed).toEqual(buildSwagger(buildOpenApi() as Json));
  });

  it('is valid Swagger 2.0', async () => {
    await SwaggerParser.validate(structuredClone(committed) as never);
    expect(committed['swagger']).toBe('2.0');
  });

  it('covers the same operations as the Zapier and n8n connectors', () => {
    expect(ops.map((o) => o['operationId']).sort()).toEqual(
      ['AddCandidate', 'CreateJob', 'DeleteWebhook', 'FindCandidates', 'GetCall', 'GetResults', 'ListJobs', 'RaiseTicket', 'StartCall', 'WhenCallEnds'],
    );
    expect(OPERATIONS).toHaveLength(ops.length);
  });

  it('has a webhook trigger that subscribes the flow URL and describes the event', () => {
    const t = byId('WhenCallEnds');
    expect(t['x-ms-trigger']).toBe('single');
    const body = t['parameters'][0]['schema'];
    expect(body['properties']['url']['x-ms-notification-url']).toBe(true);
    expect(body['properties']['events']['items']['enum']).toEqual(['call.completed', 'call.failed']);
    expect(t['x-ms-notification-content']['schema']).toEqual({ $ref: '#/definitions/WebhookEvent' });
    // Unsubscribing is a DELETE on the Location header the subscribe returns.
    expect(t['responses']['201']['headers']).toHaveProperty('Location');
    expect(committed['paths']['/v1/webhook-endpoints/{id}']['delete']['x-ms-visibility']).toBe('internal');
  });

  it('requires consent to add a candidate, and picks the job from a list', () => {
    const def = committed['definitions']['CandidateCreate'];
    expect(def['required']).toContain('consent');
    expect(def['properties']['consent']).toEqual({ type: 'boolean', enum: [true] });
    const jobId = byId('AddCandidate')['parameters'].find((p: Json) => p['name'] === 'jobId');
    expect(jobId['x-ms-dynamic-values']['operationId']).toBe('ListJobs');
  });

  it('has no score, fit or recommendation field anywhere', () => {
    const keys: string[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { keys.push(k); walk(v); }
    };
    walk(committed);
    expect(keys.filter((k) => /fitpercent|fit_percent|score|recommend/i.test(k))).toEqual([]);
    expect(JSON.stringify(committed)).not.toMatch(/fitPercent/i);
  });

  it('apiProperties asks for the key as a secure string', () => {
    const props = JSON.parse(readFileSync(join(root, 'apiProperties.json'), 'utf8')) as Json;
    expect(props['properties']['connectionParameters']['api_key']['type']).toBe('securestring');
  });
});
