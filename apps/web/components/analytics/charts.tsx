'use client';

import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { UseCaseStage } from '@/lib/use-cases';
import type { DayCalls } from '@/lib/usage';
import { cn } from '@/components/ui/cn';

/*
  Analytics charts, drawn in plain HTML so they take the app's tokens and read without a library.
  Thin marks with 4px rounded data ends, hairline grid, one sky-blue series per chart; the
  numbers are always in words too (labels, captions, a table for screen readers), so no value
  hides behind a hover or a colour.
*/

const UTC_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
const dayLabel = (start: number) => new Date(start).toLocaleDateString('en-IN', UTC_DAY);
const longDayLabel = (start: number) =>
  new Date(start).toLocaleDateString('en-IN', { ...UTC_DAY, weekday: 'short' });

/** The smallest of 1, 2, 3, 5 times a power of ten that is at least `x`: the axis step. */
function niceStep(x: number): number {
  if (x <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(x));
  const step = [1, 2, 3, 5, 10].find((m) => m * power >= x) ?? 10;
  return step * power;
}

const calls = (n: number) => (n === 1 ? '1 call' : `${n} calls`);

/** What a day reads as: its count, or why there is none to show. */
function dayValue(day: DayCalls, loadedFrom: number | null): string {
  if (day.calls !== null) return calls(day.calls);
  return loadedFrom !== null && day.start < loadedFrom ? 'Not loaded' : 'Still to come';
}

/**
 * Calls per day as columns. The pointer, a tap, or the arrow keys once focused show one day's
 * count; screen readers get the same as a table. Days to come and days not loaded stay empty.
 */
export function DayChart({ days, loadedFrom }: { days: DayCalls[]; loadedFrom: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const [byKeys, setByKeys] = useState(false);
  const counts = days.map((day) => day.calls ?? 0);
  const max = Math.max(...counts);
  const step = niceStep(max / 2);
  const top = step * 2;
  const peak = counts.lastIndexOf(max);
  const known = days.map((day, index) => (day.calls === null ? -1 : index)).filter((index) => index >= 0);
  const pct = (n: number) => `${(n / top) * 100}%`;
  const centre = (index: number) => `${((index + 0.5) / days.length) * 100}%`;
  const shown = active === null ? undefined : days[active];

  function onPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * days.length);
    setActive(Math.min(days.length - 1, Math.max(0, index)));
    setByKeys(false);
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = active ?? known.at(-1) ?? 0;
    const next =
      event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActive(Math.min(days.length - 1, Math.max(0, next)));
    setByKeys(true);
  }

  return (
    <figure className="m-0">
      <div className="flex gap-3">
        {/* Y axis: the three gridline values. */}
        <div aria-hidden className="relative h-36 w-5 shrink-0 text-right text-caption tabular-nums text-text-3 sm:h-44">
          {[top, step, 0].map((value) => (
            <span key={value} className="absolute right-0 -translate-y-1/2" style={{ top: `calc(100% - ${pct(value)})` }}>
              {value}
            </span>
          ))}
        </div>
        <div
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label="Calls per day. Left and right arrow keys read each day."
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          // A finger lifting is a pointerleave too: keep a tapped day's count up until the next tap.
          onPointerLeave={(event) => (event.pointerType === 'touch' ? undefined : setActive(null))}
          onFocus={() => setActive((current) => current ?? known.at(-1) ?? null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          className="relative h-36 min-w-0 flex-1 touch-pan-y rounded-xs sm:h-44"
        >
          {[top, step, 0].map((value) => (
            <span
              key={value}
              aria-hidden
              className="absolute inset-x-0 border-t border-border"
              style={{ bottom: pct(value) }}
            />
          ))}
          {/* The day being read, as a quiet band: it shows on days with no bar too. */}
          {active !== null ? (
            <span
              aria-hidden
              className="absolute inset-y-0 rounded-xs bg-subtle"
              style={{ left: `${(active / days.length) * 100}%`, width: `${100 / days.length}%` }}
            />
          ) : null}
          <div aria-hidden className="absolute inset-0 flex items-end">
            {days.map((day, index) => (
              <div key={day.start} className="flex h-full min-w-0 flex-1 items-end justify-center">
                {day.calls ? (
                  <span
                    className={cn(
                      'relative w-3/5 max-w-6 rounded-t-[4px] transition-colors duration-fast forced-colors:bg-[CanvasText]',
                      index === active ? 'bg-chart-series-active' : 'bg-chart-series',
                    )}
                    style={{ height: pct(day.calls) }}
                  >
                    {/* The one direct label: the busiest day. */}
                    {index === peak && active === null ? (
                      <span className="absolute inset-x-[-1rem] bottom-full mb-1 text-center text-caption font-medium tabular-nums text-text-2">
                        {day.calls}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {shown && active !== null ? (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute z-10 mb-2 whitespace-nowrap rounded-input border border-border bg-canvas px-2.5 py-1.5 text-caption shadow-float',
                active < 3 ? '' : active > days.length - 4 ? '-translate-x-full' : '-translate-x-1/2',
              )}
              style={{
                left: active < 3 ? `calc(${centre(active)} - 0.75rem)` : active > days.length - 4 ? `calc(${centre(active)} + 0.75rem)` : centre(active),
                bottom: shown.calls ? pct(shown.calls) : 0,
              }}
            >
              <span className="block font-semibold tabular-nums text-text">{dayValue(shown, loadedFrom)}</span>
              <span className="block text-text-3">{longDayLabel(shown.start)}</span>
            </div>
          ) : null}
        </div>
      </div>
      {/* X axis: weekly ticks from the 1st. */}
      <div aria-hidden className="relative ml-8 mt-2 h-4 text-caption tabular-nums text-text-3">
        {days.map((day, index) =>
          index % 7 === 0 ? (
            <span key={day.start} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: centre(index) }}>
              {index === 0 ? dayLabel(day.start) : day.day}
            </span>
          ) : null,
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {byKeys && shown ? `${longDayLabel(shown.start)}: ${dayValue(shown, loadedFrom)}` : ''}
      </p>
      <table className="sr-only">
        <caption>Calls per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Calls</th>
          </tr>
        </thead>
        <tbody>
          {days
            .filter((day) => day.calls !== null)
            .map((day) => (
              <tr key={day.start}>
                <th scope="row">{longDayLabel(day.start)}</th>
                <td>{day.calls}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface ShareRow {
  key: string;
  label: ReactNode;
  count: number;
}

/**
 * Rows of label, bar and count, each bar its share of `total` on a quiet track. Phones put the
 * bar under its label.
 */
export function ShareBars({ rows, total, label }: { rows: ShareRow[]; total: number; label: string }) {
  return (
    <ul role="list" aria-label={label} className="m-0 list-none space-y-3 p-0">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem]"
        >
          <span className="order-1 min-w-0">{row.label}</span>
          <span aria-hidden className="order-3 col-span-2 h-2 rounded-r-[4px] bg-subtle sm:order-2 sm:col-span-1">
            <span
              className="block h-full rounded-r-[4px] bg-chart-series forced-colors:bg-[CanvasText]"
              style={{ width: total > 0 ? `${(row.count / total) * 100}%` : 0 }}
            />
          </span>
          <span className="order-2 text-right font-medium tabular-nums text-text sm:order-3">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

export interface StageCounts {
  all: number;
  new: number;
  screening: number;
  reviewed: number;
  declined?: number;
}

/*
  Stage fills, in stage order (the --chart-stage tokens): blue, amber, green, slate. Adjacent pairs
  pass colour-blind separation; light marks under 3:1 are why every count is in words.
*/
const STAGE_FILL: Record<string, string> = {
  new: 'bg-chart-stage-1',
  screening: 'bg-chart-stage-2',
  reviewed: 'bg-chart-stage-3',
  declined: 'bg-chart-stage-4',
};

const stageCount = (counts: StageCounts, stage: string) =>
  (counts[stage as keyof StageCounts] as number | undefined) ?? 0;

export interface StageRow {
  id: string;
  title: string;
  counts: StageCounts;
}

/** One stacked bar per job, scaled to the busiest job, with a legend of totals and a caption of counts under each bar. */
export function StageBars({ rows, stages, emptyLabel }: { rows: StageRow[]; stages: UseCaseStage[]; emptyLabel: string }) {
  const max = Math.max(1, ...rows.map((row) => row.counts.all));
  return (
    <div>
      <ul role="list" aria-label="Stages" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        {stages.map((stage) => (
          <li key={stage.value} className="flex items-center gap-2 text-meta text-text-2">
            <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px] forced-colors:[forced-color-adjust:none]', STAGE_FILL[stage.value])} />
            {stage.label}
            <span className="font-medium tabular-nums text-text">
              {rows.reduce((n, row) => n + stageCount(row.counts, stage.value), 0)}
            </span>
          </li>
        ))}
      </ul>
      <ul role="list" className="m-0 mt-5 list-none space-y-4 p-0">
        {rows.map((row) => {
          const parts = stages
            .map((stage) => ({ stage, count: stageCount(row.counts, stage.value) }))
            .filter((part) => part.count > 0);
          return (
            <li key={row.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-text">{row.title}</span>
                <span className="shrink-0 tabular-nums text-text-2">{row.counts.all}</span>
              </div>
              {parts.length > 0 ? (
                <span
                  aria-hidden
                  className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-r-[4px] forced-colors:[forced-color-adjust:none]"
                  style={{ width: `${(row.counts.all / max) * 100}%` }}
                >
                  {parts.map(({ stage, count }) => (
                    <span key={stage.value} className={STAGE_FILL[stage.value]} style={{ flexGrow: count, flexBasis: 0 }} />
                  ))}
                </span>
              ) : null}
              <p className="mb-0 mt-1.5 text-meta text-text-3">
                {parts.length > 0
                  ? parts.map(({ stage, count }) => `${count} ${stage.label.toLowerCase()}`).join(' · ')
                  : emptyLabel}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
