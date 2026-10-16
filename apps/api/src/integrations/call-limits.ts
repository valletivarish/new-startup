/**
 * Per-company call limits (org_call_limits; defaults 50/day, 3 concurrent, no
 * monthly cap). Counts non-test phone screens. Shared by /v1 and the dashboard.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import { istMidnight } from './calling-hours.js';

/** No user acts here; the nil uuid is the system-actor sentinel tenant-context accepts. */
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const IST_OFFSET_MS = 330 * 60_000;

/** Midnight IST on the 1st of the IST month containing `t`, shifted by `months`. */
function istMonthStart(t: Date, months = 0): Date {
  const ist = new Date(t.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + months, 1) - IST_OFFSET_MS);
}

function limitReached(message: string, resetsAt: Date): ApiError {
  return new ApiError('call_limit_reached', message, undefined, {
    resetsAt: resetsAt.toISOString(),
  });
}

// ponytail: check-then-insert, so two simultaneous calls can both pass the last slot; lock the org row if that matters.
export async function assertWithinLimits(
  database: Database,
  organizationId: string,
  now: Date,
): Promise<void> {
  const dayStart = istMidnight(now);
  const monthStart = istMonthStart(now);
  const rows = await withTenantContext(
    database.db,
    { organizationId, userId: SYSTEM_USER },
    (tx) =>
      tx.execute<{
        calls_per_day: number;
        max_concurrent: number;
        monthly_cap: number | null;
        today: number;
        live: number;
        month: number;
      }>(sql`
        select
          coalesce(l.calls_per_day, 50) as calls_per_day,
          coalesce(l.max_concurrent, 3) as max_concurrent,
          l.monthly_cap,
          (count(vs.id) filter (where vs.started_at >= ${dayStart.toISOString()}::timestamptz))::int as today,
          (count(vs.id) filter (where vs.status in ('pending', 'active')))::int as live,
          (count(vs.id) filter (where vs.started_at >= ${monthStart.toISOString()}::timestamptz))::int as month
        from (select ${organizationId}::uuid as organization_id) o
        left join org_call_limits l on l.organization_id = o.organization_id
        left join voice_sessions vs
          on vs.organization_id = o.organization_id and vs.is_test = false
          and exists (
            select 1 from agent_sessions s where s.id = vs.session_id and s.channel = 'phone'
          )
        group by l.calls_per_day, l.max_concurrent, l.monthly_cap
      `),
  );
  const r = rows[0]!;
  if (r.today >= r.calls_per_day) {
    throw limitReached(
      `Daily call limit (${r.calls_per_day}) reached.`,
      new Date(dayStart.getTime() + 86_400_000),
    );
  }
  if (r.live >= r.max_concurrent) {
    throw limitReached(
      `${r.max_concurrent} calls are already in progress. Retry when one finishes.`,
      new Date(now.getTime() + 60_000),
    );
  }
  if (r.monthly_cap != null && r.month >= r.monthly_cap) {
    throw limitReached(`Monthly call cap (${r.monthly_cap}) reached.`, istMonthStart(now, 1));
  }
}

/** Test-key calls are free but not unlimited: they still run our STT/LLM/TTS. */
export const TEST_CALLS_MAX_CONCURRENT = 3;
export const TEST_CALLS_PER_DAY = 100;

// ponytail: check-then-insert, like assertWithinLimits.
export async function assertWithinTestLimits(
  database: Database,
  organizationId: string,
  now: Date,
): Promise<void> {
  const dayStart = istMidnight(now);
  const rows = await withTenantContext(
    database.db,
    { organizationId, userId: SYSTEM_USER },
    (tx) =>
      tx.execute<{ today: number; live: number }>(sql`
        select
          (count(*) filter (where started_at >= ${dayStart.toISOString()}::timestamptz))::int as today,
          (count(*) filter (where status in ('pending', 'active')))::int as live
        from voice_sessions
        where organization_id = ${organizationId} and is_test = true
      `),
  );
  const r = rows[0]!;
  const reached = (message: string, resetsAt: Date) =>
    new ApiError('test_call_limit_reached', message, undefined, { resetsAt: resetsAt.toISOString() });
  if (r.today >= TEST_CALLS_PER_DAY) {
    throw reached(
      `Daily test call limit (${TEST_CALLS_PER_DAY}) reached.`,
      new Date(dayStart.getTime() + 86_400_000),
    );
  }
  if (r.live >= TEST_CALLS_MAX_CONCURRENT) {
    throw reached(
      `${TEST_CALLS_MAX_CONCURRENT} test calls are already in progress. Retry when one finishes.`,
      new Date(now.getTime() + 60_000),
    );
  }
}
