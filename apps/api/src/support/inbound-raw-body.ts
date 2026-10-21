/** Keep the exact request bytes of /webhooks/inbound-email for its HMAC check. */

import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';

export function registerInboundEmailRawBody(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if ((request.url ?? '').split('?')[0] !== '/webhooks/inbound-email') return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    const raw = Buffer.concat(chunks);
    (request as { rawBody?: string }).rawBody = raw.toString('utf8');
    return Readable.from(raw);
  });
}
