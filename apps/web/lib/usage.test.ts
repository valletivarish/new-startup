import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceUsage,
  callOutcomes,
  callsByDay,
  formatMeter,
  inPeriod,
  loadedFrom,
  monthPeriod,
  OPEN_PLAN_LIMITS,
  SESSION_LIST_LIMIT,
  sessionMinutes,
  timeOf,
} from './usage';

describe('sessionMinutes', () => {
  it('rounds up to whole minutes for later plan caps', () => {
    expect(sessionMinutes(1)).toBe(1);
    expect(sessionMinutes(60)).toBe(1);
    expect(sessionMinutes(61)).toBe(2);
    expect(sessionMinutes(null)).toBe(0);
  });
});

describe('buildWorkspaceUsage', () => {
  it('splits screens by job and does not invent a percent of people', () => {
    const usage = buildWorkspaceUsage({
      now: new Date('2026-09-24T12:00:00.000Z'),
      jobs: [
        { id: 'job-a', title: 'Java Backend Developer', status: 'open' },
        { id: 'job-b', title: 'Sales', status: 'open' },
      ],
      peopleByJob: { 'job-a': 1, 'job-b': 0 },
      sessions: [
        {
          jobId: 'job-a',
          status: 'ended',
          startedAt: '2026-09-18T11:22:00.000Z',
          durationSeconds: 14,
        },
        {
          jobId: 'job-a',
          status: 'ended',
          startedAt: '2026-09-18T11:21:00.000Z',
          durationSeconds: 43,
        },
        {
          jobId: 'job-a',
          status: 'ended',
          startedAt: '2026-09-18T11:17:00.000Z',
          durationSeconds: 40,
        },
        {
          jobId: 'job-a',
          status: 'failed',
          startedAt: '2026-09-18T11:10:00.000Z',
          durationSeconds: 0,
        },
        {
          jobId: 'job-a',
          status: 'ended',
          startedAt: '2026-08-01T10:00:00.000Z',
          durationSeconds: 600,
        },
      ],
    });
    const java = usage.jobs.find((j) => j.jobId === 'job-a');
    expect(java?.people).toBe(1);
    expect(java?.screens).toBe(4);
    expect(java?.completed).toBe(3);
    expect(java?.failed).toBe(1);
    expect(java?.minutes).toBe(3);
    expect(usage.meters.find((m) => m.key === 'screens')?.used).toBe(4);
    expect(usage.period.label).toBe('September 2026');
  });

  it('keeps plan limits null until a membership is attached', () => {
    expect(OPEN_PLAN_LIMITS.screens).toBeNull();
    expect(formatMeter({ key: 'screens', used: 5, limit: null })).toBe(
      '5 screens',
    );
    expect(formatMeter({ key: 'screens', used: 5, limit: 100 })).toBe(
      '5 of 100 screens',
    );
  });
});

describe('timeOf', () => {
  it('reads Postgres text timestamps the way every browser can', () => {
    const iso = Date.parse('2026-10-02T03:12:45.123Z');
    expect(timeOf('2026-10-02 03:12:45.123456+00')).toBe(iso);
    expect(timeOf('2026-10-02 08:42:45.123+05:30')).toBe(iso);
    expect(timeOf('2026-10-02T03:12:45.123Z')).toBe(iso);
    expect(timeOf('2026-10-02')).toBe(Date.parse('2026-10-02T00:00:00Z'));
    expect(timeOf(null)).toBeNaN();
    expect(inPeriod('2026-10-01 00:00:00+00', monthPeriod(0, new Date('2026-10-15T00:00:00Z')))).toBe(true);
  });
});

describe('monthPeriod', () => {
  it('steps back across the year', () => {
    expect(monthPeriod(-1, new Date('2026-01-10T00:00:00Z')).label).toBe('December 2025');
    expect(monthPeriod(0, new Date('2026-10-02T00:00:00Z')).label).toBe('October 2026');
  });
});

describe('callsByDay', () => {
  const october = monthPeriod(0, new Date('2026-10-02T00:00:00Z'));
  const at = (iso: string) => ({ status: 'ended', startedAt: iso });

  it('counts calls per UTC day and leaves days still to come unknown, not 0', () => {
    const days = callsByDay(
      [at('2026-10-01 09:00:00+00'), at('2026-10-01 18:30:00+00'), at('2026-10-02T04:00:00Z'), at('2026-09-30T23:59:00Z')],
      october,
      { now: Date.parse('2026-10-02T12:00:00Z') },
    );
    expect(days).toHaveLength(31);
    expect(days.slice(0, 3).map((d) => d.calls)).toEqual([2, 1, null]);
    expect(days[30]).toMatchObject({ day: 31, calls: null });
  });

  it('marks days before the first loaded call unknown', () => {
    const days = callsByDay([at('2026-10-20T10:00:00Z')], october, {
      now: Date.parse('2026-10-31T12:00:00Z'),
      from: Date.parse('2026-10-20T10:00:00Z'),
    });
    expect(days[18]?.calls).toBeNull();
    expect(days[19]?.calls).toBe(1);
  });
});

describe('loadedFrom', () => {
  it('is null while the list holds every call, else the oldest call loaded', () => {
    const call = (day: number) => ({ status: 'ended', startedAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z` });
    expect(loadedFrom([call(3), call(1)])).toBeNull();
    const full = Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => call((i % 28) + 1));
    expect(loadedFrom(full)).toBe(Date.parse('2026-10-01T10:00:00Z'));
  });
});

describe('callOutcomes', () => {
  it('splits calls by how they ended and merges reasons that read the same', () => {
    const outcomes = callOutcomes([
      { status: 'ended' },
      { status: 'active' },
      { status: 'failed', failureReason: 'no_answer' },
      { status: 'failed', failureReason: 'no_answer' },
      { status: 'failed', failureReason: 'network' },
      { status: 'failed', failureReason: null },
      { status: 'failed', failureReason: 'something_new' },
    ]);
    expect(outcomes).toMatchObject({ total: 7, connected: 1, inProgress: 1, notConnected: 5 });
    expect(outcomes.reasons).toEqual([
      { key: 'network', label: 'Call didn’t connect', count: 3 },
      { key: 'no_answer', label: 'No answer', count: 2 },
    ]);
  });
});
