/**
 * Status (/status), for signed-in users only: is calling working right now? Green/amber/red per
 * part, from the same checks /health and the worker rely on. Names no vendor
 * and carries no secret, count or error text.
 */

import { Controller, Get, Inject } from '@nestjs/common';
import { sql, withoutTenantContext, type Database } from '@platform/db';

import { Authenticated } from '../authz/decorators.js';
import type { Env } from '../config.js';
import { WEBHOOK_QUEUE } from '../jobs/queue.js';
import { DATABASE, ENV } from '../tokens.js';

export type ComponentState = 'operational' | 'degraded' | 'down';
export interface StatusComponent {
  id: 'api' | 'calls' | 'webhooks';
  name: string;
  state: ComponentState;
  note: string;
}

/** Engines that should be up → one state: all up green, some amber, none red. */
export function combine(up: readonly boolean[]): ComponentState {
  if (up.length === 0 || up.every((u) => !u)) return 'down';
  return up.every(Boolean) ? 'operational' : 'degraded';
}

const NOTES: Record<StatusComponent['id'], Record<ComponentState, string>> = {
  api: {
    operational: 'Dashboard and API are answering.',
    degraded: 'Slower than usual.',
    down: 'The service cannot reach its data. We are on it.',
  },
  calls: {
    operational: 'Calls are being placed.',
    degraded: 'Some calls may fail or be delayed. Retry, or use the browser screen.',
    down: 'Calls cannot be placed right now. Queued calls will go out when this clears.',
  },
  webhooks: {
    operational: 'Results reach your systems within seconds.',
    degraded: 'Results are delayed. Nothing is lost: deliveries retry for 24 hours.',
    down: 'Results are not being sent right now. They will be delivered once this clears.',
  },
};

const CACHE_MS = 15_000;

@Controller()
export class StatusController {
  private cached: { at: number; body: object } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  @Authenticated()
  @Get('status')
  async status() {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.body;

    const db = await withoutTenantContext(this.database.db, (tx) => tx.execute(sql`select 1`))
      .then(() => true)
      .catch(() => false);

    const engines: boolean[] = [];
    if (this.env.VOICE_OWN_LOOP_ENABLED) {
      engines.push(
        await fetch(`${this.env.VOICE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.ok)
          .catch(() => false),
      );
    }
    if (this.env.ELEVENLABS_ENABLED) engines.push(true);

    let webhooks: ComponentState = 'operational';
    if (!this.env.JOBS_ENABLED || !db) webhooks = 'down';
    else {
      // Due deliveries nobody has picked up for 5 minutes: the worker is behind or stopped.
      webhooks = await withoutTenantContext(this.database.db, (tx) =>
        tx.execute<{ n: number }>(sql`
          select count(*)::int as n from pgboss.job
          where name = ${WEBHOOK_QUEUE} and state in ('created', 'retry')
            and start_after < now() - interval '5 minutes'
        `),
      )
        .then((r): ComponentState => ((r[0]?.n ?? 0) > 0 ? 'degraded' : 'operational'))
        .catch((): ComponentState => 'degraded');
    }

    const states: Record<StatusComponent['id'], ComponentState> = {
      api: db ? 'operational' : 'down',
      calls: db ? combine(engines) : 'down',
      webhooks,
    };
    const components: StatusComponent[] = (
      [
        ['api', 'Dashboard and API'],
        ['calls', 'Phone calls'],
        ['webhooks', 'Results to your systems'],
      ] as const
    ).map(([id, name]) => ({ id, name, state: states[id], note: NOTES[id][states[id]] }));

    const body = { checkedAt: new Date().toISOString(), components };
    this.cached = { at: Date.now(), body };
    return body;
  }
}
