/** Webhook endpoints and the delivery log for /v1. */

import { isIP } from 'node:net';
import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { JobQueue } from '../jobs/queue.js';
import { randomBase62 } from './api-keys.service.js';
import type { WebhookEvent } from './events.js';

export interface WebhookActor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface V1WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

export interface V1WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhooksService {
  create(a: WebhookActor, input: { url: string; events: WebhookEvent[] }): Promise<{ id: string; secret: string }>;
  list(a: WebhookActor): Promise<V1WebhookEndpoint[]>;
  remove(a: WebhookActor, id: string): Promise<void>;
  deliveries(a: WebhookActor, status?: string): Promise<V1WebhookDelivery[]>;
  resend(a: WebhookActor, id: string): Promise<V1WebhookDelivery>;
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Private, loopback and link-local literals, including IPv4 embedded in IPv6. */
function privateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v = isIP(h);
  if (v === 4) return privateV4(h);
  if (v !== 6) return false;
  if (h === '::' || h === '::1') return true;
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true; // fc00::/7, fe80::/10
  // IPv4-compatible / -mapped (::a.b.c.d, ::ffff:a.b.c.d; URL turns them into hex)
  // and NAT64 64:ff9b::/96 can wrap any IPv4 address, so block them outright.
  if (h.startsWith('::') || h.startsWith('64:ff9b:')) return true;
  return false;
}

/** https only in production (and no private IP literals); http to localhost elsewhere. */
export function assertWebhookUrl(raw: string, production: boolean): void {
  const bad = (message: string) => ApiError.validation([{ field: 'url', message }]);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad('url must be a valid URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1';
  if (url.protocol === 'https:') {
    if (production && privateHost(host)) throw bad('url must not point to a private address');
    return;
  }
  if (url.protocol === 'http:' && local && !production) return;
  throw bad('url must use https');
}

const DELIVERY_COLUMNS = sql`id, endpoint_id, event, status, attempts, last_status_code,
  last_error, created_at, delivered_at`;

type DeliveryRecord = {
  id: string;
  endpoint_id: string;
  event: string;
  status: string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string | Date;
  delivered_at: string | Date | null;
};

const iso = (v: string | Date) => new Date(v).toISOString();

function toDelivery(r: DeliveryRecord): V1WebhookDelivery {
  return {
    id: r.id,
    endpointId: r.endpoint_id,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    lastStatusCode: r.last_status_code,
    lastError: r.last_error,
    createdAt: iso(r.created_at),
    deliveredAt: r.delivered_at ? iso(r.delivered_at) : null,
  };
}

export function createWebhooksService(deps: {
  database: Database;
  queue: Pick<JobQueue, 'enqueueWebhook'> | null;
  production: boolean;
}): WebhooksService {
  const tenant = <T>(a: WebhookActor, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(deps.database.db, a, fn);

  return {
    async create(a, input) {
      assertWebhookUrl(input.url, deps.production);
      const secret = `whsec_${randomBase62(32)}`;
      const rows = await tenant(a, (tx) =>
        tx.execute<{ id: string }>(sql`
          insert into webhook_endpoints (organization_id, url, secret, events)
          values (${a.organizationId}, ${input.url}, ${secret},
                  string_to_array(${input.events.join(',')}, ','))
          returning id
        `),
      );
      return { id: rows[0]!.id, secret };
    },

    async list(a) {
      const rows = await tenant(a, (tx) =>
        tx.execute<{ id: string; url: string; events: string[]; created_at: string | Date }>(sql`
          select id, url, events, created_at from webhook_endpoints
          where organization_id = ${a.organizationId} and disabled_at is null
          order by created_at desc
        `),
      );
      return rows.map((r) => ({ id: r.id, url: r.url, events: r.events, createdAt: iso(r.created_at) }));
    },

    async remove(a, id) {
      // Soft delete keeps the delivery log; pending deliveries fail on their next attempt.
      const rows = await tenant(a, (tx) =>
        tx.execute(sql`
          update webhook_endpoints set disabled_at = now()
          where id = ${id} and organization_id = ${a.organizationId} and disabled_at is null
          returning id
        `),
      );
      if (rows.length === 0) throw ApiError.notFound('Webhook endpoint');
    },

    async deliveries(a, status) {
      const rows = await tenant(a, (tx) =>
        tx.execute<DeliveryRecord>(sql`
          select ${DELIVERY_COLUMNS} from webhook_deliveries
          where organization_id = ${a.organizationId}
            ${status ? sql`and status = ${status}` : sql``}
          order by created_at desc
          limit 100
        `),
      );
      return rows.map(toDelivery);
    },

    async resend(a, id) {
      // Only a finished row is re-queued; a pending one already has a job. A
      // resend starts a fresh 24 h retry window.
      const row = await tenant(a, async (tx) => {
        const found = await tx.execute<{ status: string; live: boolean }>(sql`
          select d.status, e.disabled_at is null as live
          from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
          where d.id = ${id} and d.organization_id = ${a.organizationId}
          for update of d
        `);
        const cur = found[0];
        if (!cur || !cur.live) throw ApiError.notFound('Webhook delivery');
        if (cur.status === 'pending') {
          throw new ApiError('delivery_in_progress', 'This delivery is still being retried');
        }
        const rows = await tx.execute<DeliveryRecord>(sql`
          update webhook_deliveries set
            status = 'pending', attempts = 0, last_status_code = null, last_error = null,
            created_at = now(), next_attempt_at = now(), delivered_at = null
          where id = ${id} and organization_id = ${a.organizationId}
          returning ${DELIVERY_COLUMNS}
        `);
        return rows[0]!;
      });
      await deps.queue?.enqueueWebhook({ organizationId: a.organizationId, deliveryId: row.id });
      return toDelivery(row);
    },
  };
}
