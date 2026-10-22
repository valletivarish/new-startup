'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, FileCheckCorner, PhoneOff, UsersRound, type LucideIcon } from 'lucide-react';
import { Queues } from '../../components/home/queues';
import { callGate } from '../../components/home/copy';
import { Button } from '../../components/ui/button';
import { getTelephonyStatus } from '../../lib/api';
import type { HomeSnapshot } from '../../lib/hiring-people';
import { needsYouTasks, type Task } from './needs-you-tasks';

const ICONS: Record<Task['kind'], LucideIcon> = {
  review: FileCheckCorner,
  retry: PhoneOff,
  'not-called': UsersRound,
  clear: CircleCheck,
  note: PhoneOff,
};

/**
 * "Needs you": one compact card, at most three tasks with one action each. Show all opens the full
 * queues (Home's cards) below it. The numbers come from the snapshot Queues uses; the calling-number
 * check is the same query Queues makes, so it is one request.
 */
export function NeedsYou({ snapshot, can }: { snapshot: HomeSnapshot; can: (permission: string) => boolean }) {
  const [all, setAll] = useState(false);
  const canCall = can('calls.initiate');
  const telephony = useQuery({ queryKey: ['telephony-status'], queryFn: getTelephonyStatus, enabled: canCall });
  // The expanded queues say it themselves, so the card stops repeating it.
  const gate = all ? 'ready' : callGate(canCall, telephony.data, telephony.isError);
  const tasks = needsYouTasks(snapshot, gate);
  if (tasks.length === 0) return null;
  const lines = tasks.filter((t) => t.kind !== 'note');
  const note = tasks.find((t) => t.kind === 'note');
  const caughtUp = lines[0]?.kind === 'clear';
  return (
    <section aria-labelledby="needs-you" className="mb-6">
      <div className="rounded-card border border-border bg-canvas px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="needs-you" className="m-0 text-section text-text">
            Needs you
          </h2>
          {caughtUp ? null : (
            <Button type="button" variant="tertiary" size="sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : 'Show all'}
            </Button>
          )}
        </div>
        <ul className="m-0 list-none divide-y divide-border p-0">
          {lines.map((task) => {
            const Icon = ICONS[task.kind];
            return (
              <li key={task.kind} className="flex min-h-11 items-center gap-3 py-1">
                <Icon aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-text-2" />
                <span className="min-w-0 flex-1 text-text">{task.text}</span>
                {task.href && task.action ? (
                  <Button asChild variant="secondary" size="sm" className="w-24 shrink-0">
                    <Link href={task.href}>{task.action}</Link>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {note?.href ? (
          <p className="m-0 mt-1 border-t border-border pt-2 text-meta text-text-2">
            {note.text}{' '}
            <Link href={note.href} className="font-medium text-text underline underline-offset-4 hover:decoration-2">
              {note.action}
            </Link>
          </p>
        ) : null}
      </div>
      {all ? (
        <div className="mt-4">
          <Queues snapshot={snapshot} can={can} />
        </div>
      ) : null}
    </section>
  );
}
