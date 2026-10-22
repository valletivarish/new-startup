'use client';

import { useState } from 'react';
import { Queues } from '../../components/home/queues';
import { Button } from '../../components/ui/button';
import type { HomeSnapshot } from '../../lib/hiring-people';

const ROWS = 3;

/** The snapshot with each queue's list cut to `rows`; the totals are untouched, so "Showing 3 of 9" stays true. */
export function limitQueues(snapshot: HomeSnapshot, rows: number): HomeSnapshot {
  const q = snapshot.queues;
  if (!q) return snapshot;
  const cut = <T extends { items: unknown[] }>(queue: T): T => ({ ...queue, items: queue.items.slice(0, rows) });
  return {
    ...snapshot,
    queues: {
      readyForReview: cut(q.readyForReview),
      notConnected: cut(q.notConnected),
      notCalled: cut(q.notCalled),
      onHold: cut(q.onHold),
    },
  };
}

/** "Needs you": Home's queues at the top of Jobs, three rows each until the person asks for all. */
export function NeedsYou({ snapshot, can }: { snapshot: HomeSnapshot; can: (permission: string) => boolean }) {
  const [all, setAll] = useState(false);
  const q = snapshot.queues;
  if (!q || Object.values(q).every((queue) => queue.total === 0)) return null;
  const more = Object.values(q).some((queue) => queue.items.length > ROWS);
  return (
    <section aria-labelledby="needs-you" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="needs-you" className="m-0 text-section text-text">
          Needs you
        </h2>
        {more ? (
          <Button type="button" variant="tertiary" size="sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : 'Show all'}
          </Button>
        ) : null}
      </div>
      <Queues snapshot={all ? snapshot : limitQueues(snapshot, ROWS)} can={can} />
    </section>
  );
}
