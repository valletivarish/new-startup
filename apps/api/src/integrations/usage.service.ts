/**
 * Billing usage and per-company limits/price. Completed screens are ledger
 * rows with outcome 'completed' (written by recordCallCost via callOutcome:
 * candidate spoke and 20 s+). Test sessions are never counted.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const IST_OFFSET_MS = 330 * 60_000;

export interface MonthUsage {
  month: string;
  callsPlaced: number;
  completedScreens: number;
  pricePerScreenInr: number | null;
  amountInr: number | null;
}

export interface OrgLimits {
  callsPerDay: number;
  maxConcurrent: number;
  monthlyCap: number | null;
  pricePerScreenInr: number | null;
}

export interface UsageService {
  month(organizationId: string, month: string): Promise<MonthUsage>;
  getLimits(organizationId: string): Promise<OrgLimits>;
  setLimits(organizationId: string, limits: OrgLimits): Promise<OrgLimits>;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function createUsageService(database: Database): UsageService {
  const tenant = <T>(organizationId: string, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, { organizationId, userId: SYSTEM_USER }, fn);

  const readLimits = (organizationId: string) =>
    tenant(organizationId, (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select calls_per_day, max_concurrent, monthly_cap, price_per_screen_inr::text as price
        from org_call_limits where organization_id = ${organizationId}
      `),
    ).then((rows): OrgLimits => {
      const r = rows[0];
      return {
        callsPerDay: r ? Number(r['calls_per_day']) : 50,
        maxConcurrent: r ? Number(r['max_concurrent']) : 3,
        monthlyCap: r ? num(r['monthly_cap']) : null,
        pricePerScreenInr: r ? num(r['price']) : null,
      };
    });

  return {
    async month(organizationId, month) {
      const [y, m] = month.split('-').map(Number) as [number, number];
      const start = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS).toISOString();
      const end = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS).toISOString();
      const rows = await tenant(organizationId, (tx) =>
        tx.execute<{ placed: number; completed: number }>(sql`
          select count(*)::int as placed,
                 (count(*) filter (where l.outcome = 'completed'))::int as completed
          from voice_sessions vs
          join agent_sessions s on s.id = vs.session_id and s.channel = 'phone'
          left join call_cost_ledger l on l.voice_session_id = vs.id
          where vs.organization_id = ${organizationId} and vs.is_test = false
            and vs.started_at >= ${start}::timestamptz and vs.started_at < ${end}::timestamptz
        `),
      );
      const { pricePerScreenInr } = await readLimits(organizationId);
      const completedScreens = rows[0]?.completed ?? 0;
      return {
        month,
        callsPlaced: rows[0]?.placed ?? 0,
        completedScreens,
        pricePerScreenInr,
        amountInr:
          pricePerScreenInr === null ? null : Math.round(completedScreens * pricePerScreenInr * 100) / 100,
      };
    },

    getLimits: readLimits,

    async setLimits(organizationId, l) {
      try {
        await tenant(organizationId, (tx) =>
          tx.execute(sql`
            insert into org_call_limits
              (organization_id, calls_per_day, max_concurrent, monthly_cap, price_per_screen_inr)
            values (${organizationId}, ${l.callsPerDay}, ${l.maxConcurrent}, ${l.monthlyCap}, ${l.pricePerScreenInr})
            on conflict (organization_id) do update set
              calls_per_day = excluded.calls_per_day, max_concurrent = excluded.max_concurrent,
              monthly_cap = excluded.monthly_cap, price_per_screen_inr = excluded.price_per_screen_inr,
              updated_at = now()
          `),
        );
      } catch (e) {
        // Unknown organization: the foreign key rejects the insert.
        if ((e as { code?: string; cause?: { code?: string } }).cause?.code === '23503' ||
            (e as { code?: string }).code === '23503') throw ApiError.notFound('Organization');
        throw e;
      }
      return readLimits(organizationId);
    },
  };
}
