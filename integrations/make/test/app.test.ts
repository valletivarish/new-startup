/** The Make app files: parseable, every request is a real /v1 route, consent required, no score. */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOpenApi } from '../../../apps/api/src/integrations/openapi.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const root = join(import.meta.dirname, '..');
const files = (readdirSync(root, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.json') && !f.startsWith('node_modules') && f !== 'package.json');
const read = (f: string): Json => JSON.parse(readFileSync(join(root, f), 'utf8'));
const doc = buildOpenApi() as Json;

/** "/v1/jobs/{{parameters.jobId}}/candidates" -> "/v1/jobs/{}/candidates" */
const shape = (p: string) => p.replace(/\{\{[^}]+\}\}|\{\w+\}/g, '{}');
const documented = new Set(
  Object.entries(doc['paths'] as Json).flatMap(([p, ops]) => Object.keys(ops as Json).map((m) => `${m.toUpperCase()} ${shape(p)}`)),
);

describe('Make app', () => {
  it('every file is valid JSON', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(() => read(f), f).not.toThrow();
  });

  it('every request goes to a documented /v1 route', () => {
    const requests = files
      .filter((f) => /(api|attach|detach)\.json$/.test(f) && !f.startsWith('webhooks/call-events/api') && !f.startsWith('modules/watchCallEvents'))
      .map((f) => [f, read(f)] as const);
    expect(requests.length).toBeGreaterThanOrEqual(9);
    for (const [f, r] of requests) {
      const url = String(r['url']).replace(/^\{\{ifempty\(parameters\.baseUrl, '[^']+'\)\}\}/, '');
      expect(documented, relative(root, f)).toContain(`${r['method'] ?? 'GET'} ${shape(url)}`);
    }
  });

  it('the trigger subscribes the Make webhook URL and unsubscribes by id', () => {
    expect(read('webhooks/call-events/attach.json')).toMatchObject({
      method: 'POST', body: { url: '{{webhook.url}}' }, response: { data: { externalHookId: '{{body.id}}' } },
    });
    expect(read('webhooks/call-events/detach.json')['url']).toContain('{{webhook.externalHookId}}');
    expect(read('modules/watchCallEvents/meta.json')).toMatchObject({ type: 'instant_trigger', webhook: 'call-events' });
  });

  it('adding a candidate requires consent and sends it', () => {
    const consent = (read('modules/addCandidate/expect.json') as unknown as Json[]).find((p) => p['name'] === 'consent')!;
    expect(consent).toMatchObject({ type: 'boolean', required: true, default: false });
    expect(read('modules/addCandidate/api.json')['body']['consent']).toBe('{{parameters.consent}}');
  });

  it('sends the key as a Bearer header and keeps it out of logs', () => {
    expect(read('base.json')['headers']['Authorization']).toBe('Bearer {{connection.apiKey}}');
    expect(read('base.json')['log']['sanitize']).toContain('request.headers.authorization');
  });

  it('no field anywhere names a score, fit or recommendation', () => {
    const all = files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
    expect(all).not.toMatch(/fitPercent|score|recommend/i);
  });
});
