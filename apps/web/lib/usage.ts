/**
 * Workspace usage meters, and the call counts Analytics draws from the same list.
 *
 * Membership plans will cap these same keys (screens, minutes) on a billing
 * period. Limits are null until a plan is attached. Do not invent a second
 * counting model later.
 */

import { timeOf } from './format';
import { callStateKey, getStateMeta } from './status-labels';

export { timeOf };

export type UsageMeterKey = 'screens' | 'minutes';

export interface PlanLimits {
  screens: number | null;
  minutes: number | null;
}

/** Open workspace: meters exist, no cap. Plans fill these later. */
export const OPEN_PLAN_LIMITS: PlanLimits = {
  screens: null,
  minutes: null,
};

export interface UsageMeter {
  key: UsageMeterKey;
  used: number;
  limit: number | null;
}

export interface JobUsage {
  jobId: string;
  title: string;
  jobStatus: string;
  people: number;
  screens: number;
  completed: number;
  failed: number;
  minutes: number;
}

export interface UsagePeriod {
  start: Date;
  end: Date;
  label: string;
}

export interface WorkspaceUsage {
  period: UsagePeriod;
  meters: UsageMeter[];
  jobs: JobUsage[];
  unassigned: { screens: number; minutes: number; failed: number };
}

export interface UsageSession {
  jobId?: string | null;
  status: string;
  startedAt?: string | null;
  durationSeconds?: number | null;
  failureReason?: string | null;
}

/** Billable minutes: whole minutes, rounded up. Plans should use this. */
export function sessionMinutes(durationSeconds: number | null | undefined): number {
  if (durationSeconds == null || durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / 60);
}

export function calendarMonthPeriod(now = new Date()): UsagePeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = start.toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { start, end, label };
}

/** The calendar month `offset` months from now's: 0 this month, -1 last month. */
export function monthPeriod(offset: number, now = new Date()): UsagePeriod {
  return calendarMonthPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
}

export function inPeriod(iso: string | null | undefined, period: UsagePeriod): boolean {
  const t = timeOf(iso);
  return t >= period.start.getTime() && t < period.end.getTime();
}

export function formatMeter(meter: UsageMeter): string {
  const unit = meter.key === 'minutes' ? 'min' : 'screens';
  if (meter.limit == null) {
    return meter.key === 'minutes'
      ? `${meter.used} min used`
      : `${meter.used} ${unit}`;
  }
  return `${meter.used} of ${meter.limit} ${unit}`;
}

export function buildWorkspaceUsage(input: {
  jobs: readonly { id: string; title: string; status: string }[];
  peopleByJob: Readonly<Record<string, number>>;
  sessions: readonly UsageSession[];
  now?: Date;
  limits?: PlanLimits;
}): WorkspaceUsage {
  const period = calendarMonthPeriod(input.now);
  const limits = input.limits ?? OPEN_PLAN_LIMITS;
  const inMonth = input.sessions.filter((s) => inPeriod(s.startedAt, period));

  const jobs: JobUsage[] = input.jobs.map((job) => {
    const rows = inMonth.filter((s) => s.jobId === job.id);
    return {
      jobId: job.id,
      title: job.title,
      jobStatus: job.status,
      people: input.peopleByJob[job.id] ?? 0,
      screens: rows.length,
      completed: rows.filter((s) => s.status === 'ended').length,
      failed: rows.filter((s) => s.status === 'failed').length,
      minutes: rows.reduce((n, s) => n + sessionMinutes(s.durationSeconds), 0),
    };
  });

  const unassignedRows = inMonth.filter((s) => !s.jobId);
  const unassigned = {
    screens: unassignedRows.length,
    minutes: unassignedRows.reduce(
      (n, s) => n + sessionMinutes(s.durationSeconds),
      0,
    ),
    failed: unassignedRows.filter((s) => s.status === 'failed').length,
  };

  const screens =
    jobs.reduce((n, j) => n + j.screens, 0) + unassigned.screens;
  const minutes =
    jobs.reduce((n, j) => n + j.minutes, 0) + unassigned.minutes;

  return {
    period,
    meters: [
      { key: 'screens', used: screens, limit: limits.screens },
      { key: 'minutes', used: minutes, limit: limits.minutes },
    ],
    jobs,
    unassigned,
  };
}

// --- Analytics ------------------------------------------------------------------------------

/** GET /voice-sessions sends the latest 50 calls at most, newest first. */
export const SESSION_LIST_LIMIT = 50;

/**
 * Where the loaded calls begin: null when the list holds every call, else the oldest loaded
 * call's start. Older calls exist but weren't sent, so a period starting earlier is partial.
 */
export function loadedFrom(sessions: readonly UsageSession[]): number | null {
  if (sessions.length < SESSION_LIST_LIMIT) return null;
  const times = sessions.map((s) => timeOf(s.startedAt)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

const DAY_MS = 86_400_000;

export interface DayCalls {
  /** Midnight UTC that starts the day, like the period. */
  start: number;
  /** Day of the month, from 1. */
  day: number;
  /** null: the day hasn't come yet, or its calls weren't loaded. Never a made-up 0. */
  calls: number | null;
}

/** Calls started on each day of the period. */
export function callsByDay(
  sessions: readonly UsageSession[],
  period: UsagePeriod,
  { now = Date.now(), from = null }: { now?: number; from?: number | null } = {},
): DayCalls[] {
  const first = period.start.getTime();
  const days: DayCalls[] = [];
  for (let start = first; start < period.end.getTime(); start += DAY_MS) {
    const unknown = start > now || (from !== null && start + DAY_MS <= from);
    days.push({ start, day: days.length + 1, calls: unknown ? null : 0 });
  }
  for (const s of sessions) {
    const t = timeOf(s.startedAt);
    const slot = t >= first ? days[Math.floor((t - first) / DAY_MS)] : undefined;
    if (slot && slot.calls !== null) slot.calls += 1;
  }
  return days;
}

export interface CallReason {
  /** The STATE_MAP.call key StatusTag shows for it. */
  key: string;
  label: string;
  count: number;
}

export interface CallOutcomes {
  total: number;
  /** Ended normally. */
  connected: number;
  notConnected: number;
  /** Ringing or on a call right now. */
  inProgress: number;
  /** Why calls didn't connect, in StatusTag's words (reasons with the same words merge), most first. */
  reasons: CallReason[];
}

/** How the given calls ended. Pass them already narrowed to a period and a job. */
export function callOutcomes(sessions: readonly UsageSession[]): CallOutcomes {
  const reasons = new Map<string, CallReason>();
  let connected = 0;
  let notConnected = 0;
  let inProgress = 0;
  for (const s of sessions) {
    if (s.status === 'ended') connected += 1;
    else if (s.status === 'pending' || s.status === 'active') inProgress += 1;
    else if (s.status === 'failed') {
      notConnected += 1;
      const key = callStateKey({ callStatus: 'failed', failureReason: s.failureReason }) ?? 'failed';
      const { label } = getStateMeta('call', key);
      const reason = reasons.get(label) ?? { key, label, count: 0 };
      reason.count += 1;
      reasons.set(label, reason);
    }
  }
  return {
    total: sessions.length,
    connected,
    notConnected,
    inProgress,
    reasons: [...reasons.values()].sort((a, b) => b.count - a.count),
  };
}
