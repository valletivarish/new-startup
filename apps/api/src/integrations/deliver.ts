/**
 * Webhook delivery: one signed POST per attempt. pg-boss owns the retry
 * schedule; handleWebhookJob throws on a failed attempt so the job retries,
 * and gives up (status `failed`) once the row is 24 h old.
 */

import { createHmac } from 'node:crypto';
import { sql, withTenantContext, type Database } from '@platform/db';

import type { WebhookJob } from '../jobs/queue.js';

export type DeliveryRow = {
  id: string;
  url: string;
  secret: string;
  event: string;
  payload: unknown;
};

export interface DeliveryOutcome {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

type FetchFn = typeof fetch;

/** Hex HMAC-SHA256(secret, "<t>.<raw body>") — the `v1=` part of HRVoice-Signature. */
export function signPayload(secret: string, t: number, body: string): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}

export async function deliverOnce(
  row: DeliveryRow,
  fetchFn: FetchFn = fetch,
  now: Date = new Date(),
): Promise<DeliveryOutcome> {
  const body = JSON.stringify(row.payload);
  const t = Math.floor(now.getTime() / 1000);
  try {
    const res = await fetchFn(row.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'HRVoice-Signature': `t=${t},v1=${signPayload(row.secret, t, body)}`,
        'HRVoice-Event': row.event,
        'HRVoice-Delivery': row.id,
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return res.status >= 200 && res.status < 300
      ? { ok: true, statusCode: res.status }
      : { ok: false, statusCode: res.status, error: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: (error as Error).message.slice(0, 500) };
  }
}

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const MAX_AGE_MS = 24 * 3_600_000;
/** 1 attempt + retryLimit 12. */
const MAX_ATTEMPTS = 13;

/** The WEBHOOK_QUEUE handler. Throws after a failed attempt that should be retried. */
export async function handleWebhookJob(
  database: Database,
  job: WebhookJob,
  opts: { fetchFn?: FetchFn; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const tenant = <T>(fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, { organizationId: job.organizationId, userId: SYSTEM_USER }, fn);
  const rows = await tenant((tx) =>
    tx.execute<DeliveryRow & { status: string; attempts: number; created_at: string; disabled: boolean }>(sql`
      select d.id, d.event, d.payload, d.status, d.attempts, d.created_at::text,
             e.url, e.secret, e.disabled_at is not null as disabled
      from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
      where d.id = ${job.deliveryId} and d.organization_id = ${job.organizationId}
    `),
  );
  const row = rows[0];
  if (!row || row.status !== 'pending') return;

  const fail = (error: string) =>
    tenant((tx) =>
      tx.execute(sql`
        update webhook_deliveries set status = 'failed', last_error = ${error}
        where id = ${row.id} and organization_id = ${job.organizationId}
      `),
    );
  if (row.disabled) return void (await fail('endpoint_deleted'));
  if (now.getTime() - Date.parse(row.created_at) > MAX_AGE_MS) {
    return void (await fail('expired'));
  }

  const out = await deliverOnce(row, opts.fetchFn, now);
  const attempts = row.attempts + 1;
  const giveUp = !out.ok && attempts >= MAX_ATTEMPTS;
  await tenant((tx) =>
    tx.execute(sql`
      update webhook_deliveries set
        status = ${out.ok ? 'delivered' : giveUp ? 'failed' : 'pending'},
        attempts = ${attempts},
        last_status_code = ${out.statusCode ?? null},
        last_error = ${out.error ?? null},
        delivered_at = ${out.ok ? sql`now()` : sql`null`}
      where id = ${row.id} and organization_id = ${job.organizationId}
    `),
  );
  if (!out.ok && !giveUp) throw new Error(`webhook delivery failed: ${out.error ?? 'unknown'}`);
}
