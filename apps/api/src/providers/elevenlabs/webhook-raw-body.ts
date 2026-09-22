/**
 * Capture exact request bytes for the voice webhook HMAC check.
 * Lives in the adapter package so the vendor path string does not leak into
 * generic server wiring (production-boundary invariant).
 */

import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';

const WEBHOOK_PATH_SUFFIX = '/webhooks/elevenlabs';

export function registerVoiceWebhookRawBody(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (!path.endsWith(WEBHOOK_PATH_SUFFIX)) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const raw = Buffer.concat(chunks);
    (request as { rawBody?: string }).rawBody = raw.toString('utf8');
    return Readable.from(raw);
  });
}
