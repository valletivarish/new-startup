import * as React from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { STATE_MAP, type StateDomain } from '../../lib/status-labels';
import { HIRING_USE_CASE, mergeUseCase } from '../../lib/use-cases';
import { Badge, statusTone } from './badge';
import { Bay, BoardColumn } from './bay';
import { Breadcrumb } from './breadcrumb';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { DataList, DataListBody, DataListHeader, DataListRow, DataListTitle } from './list';
import { Alert, Notice } from './notice';
import { OfflineBanner } from './offline-banner';
import { Notice as LegacyNotice } from './page';
import { PageHeader } from './page-header';
import { SkeletonRows, skeletonHoldMs } from './skeleton';
import { StageTag, StateTag, StatusBadge, StatusTag, stateBadge } from './state-tag';
import { StatusIndicator } from './status-indicator';
import { ListRow, ListRowPrimary, ListRows, Strip, StripList, StripPrimary } from './strip';

// ponytail: vitest compiles TSX with the classic runtime (tsconfig jsx: preserve), so the
// components need React in scope. Drop this once vitest.config sets esbuild.jsx = 'automatic'.
Object.assign(globalThis, { React });

const tone = (domain: StateDomain, value: string) => stateBadge(STATE_MAP[domain][value]!);

describe('feedback', () => {
  it('announces errors at once and everything else politely, tinted by kind', () => {
    const error = html(h(Alert, { kind: 'error', title: 'Couldn’t save.' }));
    expect(error).toContain('role="alert"');
    expect(error).toContain('bg-status-danger-bg');
    expect(error).toContain('rounded-card-sm');
    expect(html(h(Notice, { kind: 'info', children: 'Saved.' }))).toContain('role="status"');
    expect(html(h(LegacyNotice, { kind: 'err', children: 'x' }))).toContain('role="alert"');
    expect(html(h(LegacyNotice, { kind: 'ok', children: 'x' }))).toContain('bg-status-success-bg');
  });

  it('marks loading regions busy, hides the bars and keeps a status line', () => {
    const out = html(h(SkeletonRows, { rows: 2 }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('role="status"');
    expect(out).toContain('motion-safe:animate-pulse');
  });

  it('holds placeholders 500ms once shown, and never shows them for a load under 300ms', () => {
    expect(skeletonHoldMs(120)).toBe(0);
    expect(skeletonHoldMs(300)).toBe(0);
    expect(skeletonHoldMs(350)).toBe(450);
    expect(skeletonHoldMs(800)).toBe(0);
    expect(skeletonHoldMs(5000)).toBe(0);
  });

  it('centres empty and error states on a soft icon tile, with Retry on errors', () => {
    const empty = html(h(EmptyState, { title: 'No calls yet', headingLevel: 3 }));
    expect(empty).toContain('text-center');
    expect(empty).toContain('lucide-inbox');
    expect(empty).toContain('<h3');
    const error = html(h(ErrorState, { title: 'Couldn’t load calls.', onRetry: () => {} }));
    expect(error).toContain('role="alert"');
    expect(error).toContain('bg-status-danger-bg');
    expect(error).toContain('Retry');
    const offline = html(h(ErrorState, { variant: 'offline' }));
    expect(offline).toContain('role="status"');
    expect(offline).toContain('You’re offline');
  });

  it('keeps the offline region mounted, and shows icon and words when offline', () => {
    expect(html(h(OfflineBanner, { online: true }))).toContain('class="sr-only"');
    const off = html(h(OfflineBanner, { online: false }));
    expect(off).toContain('lucide-wifi-off');
    expect(off).toContain('bg-status-warning-bg');
  });
});

describe('page header', () => {
  it('sets the accent inside the h1 as plain text: no serif flourish in the app', () => {
    const out = html(h(PageHeader, { title: 'Good evening,', accent: 'Priya', description: 'Two calls are ready.' }));
    expect(out).toMatch(/<h1[^>]*>Good evening, Priya<\/h1>/);
    expect(out).not.toContain('serif-accent');
  });

  it('marks the current crumb and keeps chevrons out of the accessibility tree', () => {
    const out = html(h(Breadcrumb, { items: [{ label: 'Jobs', href: '/jobs' }, { label: 'Java developer' }] }));
    expect(out).toContain('aria-current="page"');
    expect(out).toMatch(/<svg(?=[^>]*aria-hidden="true")(?=[^>]*lucide-chevron-right)/);
  });
});

describe('status badges', () => {
  it('maps every state of spec 2 onto its family', () => {
    expect(tone('candidate', 'new').tone).toBe('neutral');
    expect(tone('candidate', 'screening').tone).toBe('warning');
    expect(tone('candidate', 'reviewed').tone).toBe('success');
    expect(tone('candidate', 'declined').tone).toBe('neutral');
    expect(tone('call', 'dialing')).toEqual({ tone: 'info', icon: 'live' });
    expect(tone('call', 'active')).toEqual({ tone: 'success', icon: 'live' });
    expect(tone('call', 'transferring').tone).toBe('info');
    expect(tone('call', 'results_pending').tone).toBe('info');
    expect(tone('call', 'ready_for_review').tone).toBe('info');
    expect(tone('call', 'no_answer').tone).toBe('danger');
    expect(tone('call', 'voicemail').tone).toBe('danger');
    expect(tone('job', 'draft').tone).toBe('neutral');
    expect(tone('job', 'open').tone).toBe('success');
    expect(tone('job', 'closed').tone).toBe('neutral');
    expect(tone('agent', 'published').tone).toBe('success');
    expect(tone('agent', 'paused').tone).toBe('warning');
    expect(tone('invite', 'pending').tone).toBe('info');
    expect(tone('invite', 'accepted').tone).toBe('success');
    expect(tone('invite', 'expired').tone).toBe('warning');
    expect(tone('invite', 'revoked').tone).toBe('neutral');
  });

  it('draws a soft-cornered tag with an icon and the word, never colour alone', () => {
    const out = html(h(StatusBadge, { tone: 'info', children: 'Ready for review' }));
    expect(out).toContain('rounded-xs');
    expect(out).toContain('bg-status-info-bg');
    expect(out).toContain('<svg');
    expect(out).toContain('Ready for review');
  });

  it('pulses the live dot three times, only when motion is allowed', () => {
    const out = html(h(StateTag, { family: 'live', glyph: 'live', children: 'On call' }));
    expect(out).toContain('motion-safe:animate-[ping_1s_var(--ease-out)_3]');
    expect(out).toContain('bg-status-success-bg');
  });

  it('keeps the legacy badge tones off alarm colours', () => {
    expect(statusTone('new')).toBe('queued');
    expect(statusTone('closed')).toBe('decided');
    expect(statusTone('failed')).toBe('failed');
    expect(statusTone('toString')).toBe('decided');
    expect(statusTone('completed')).toBe('decided');
    expect(statusTone('no_answer')).toBe('failed');
    expect(statusTone('calling')).toBe('live');
    expect(statusTone('pending')).toBe('queued');
    const tag = html(h(Badge, { tone: 'warning', children: 'New' }));
    expect(tag).toContain('bg-status-neutral-bg');
    expect(tag).not.toContain('capitalize');
  });

  it('reads a state-map word the same in every badge, and gives every badge an icon', () => {
    expect(html(h(Badge, { tone: 'success', children: 'Call ended' }))).toContain('bg-status-neutral-bg');
    expect(html(h(Badge, { tone: 'accent', children: 'Calling' }))).toContain('animate-[ping');
    expect(html(h(Badge, { tone: 'neutral', children: 'Not called yet' }))).toContain('lucide-clock');
    expect(html(h(Badge, { tone: 'success', children: 'Answered' }))).toContain('lucide-circle-check');
    expect(html(h(Badge, { tone: 'neutral', children: 'Unknown' }))).toContain('lucide-circle-question-mark');
    expect(html(h(Badge, { tone: 'neutral', children: 'Neutral' }))).toContain('bg-status-neutral-bg');
  });

  it('renders domain states from the one map', () => {
    const live = html(h(StatusTag, { domain: 'call', value: 'active' }));
    expect(live).toContain('On call');
    expect(live).toContain('animate-[ping');
    expect(html(h(StatusTag, { domain: 'job', value: null }))).toContain('Unknown');
  });

  it('words a call from what is known about it', () => {
    expect(html(h(StatusTag, { domain: 'call', value: 'completed', stage: 'new' }))).toContain('Ready for review');
    expect(html(h(StatusTag, { domain: 'call', value: 'completed', stage: 'new', hasResults: false }))).toContain(
      'Writing up the call',
    );
    expect(html(h(StatusTag, { domain: 'call', value: 'completed', stage: 'reviewed' }))).toContain('Call ended');
    expect(html(h(StatusTag, { domain: 'call', value: 'failed', failureReason: 'voicemail' }))).toContain(
      'Reached voicemail',
    );
  });

  it('names a stage in the use case words, the same ones the stage filters use', () => {
    const client = new QueryClient();
    const stage = (value: string) => html(h(QueryClientProvider, { client }, h(StageTag, { value })));
    expect(stage('screening')).toContain('On hold');
    expect(stage('screening')).toContain('lucide-circle-pause');
    expect(stage('screening')).toContain('bg-status-warning-bg');
    client.setQueryData(
      ['use-cases'],
      [mergeUseCase(HIRING_USE_CASE, { id: 'hiring', stages: [{ key: 'screening', label: 'Paused' }] })],
    );
    expect(stage('screening')).toContain('Paused');
    expect(stage('mystery')).toContain('Unknown');
  });

  it('words a test call from the one map', () => {
    const out = html(h(StatusIndicator, { status: 'speaking' }));
    expect(out).toContain('Agent speaking');
    expect(out).toContain('aria-live="polite"');
  });
});

describe('list rows', () => {
  it('opens rows through a real button or link, never a div', () => {
    const button = html(
      h(DataListRow, {
        onClick: () => {},
        selected: true,
        children: h(DataListTitle, { children: 'Priya' }),
      }),
    );
    expect(button).toContain('<button type="button"');
    expect(button).toContain('aria-current="true"');
    expect(button).not.toContain('role="button"');
    const link = html(h(DataListRow, { href: '/jobs/1', children: h(DataListTitle, { children: 'Java' }) }));
    expect(link).toContain('href="/jobs/1"');
  });

  it('marks the open row current, with a tint and a bar, not colour alone', () => {
    const out = html(h(Strip, { selected: true, children: h(StripPrimary, { title: 'Priya', href: '/c/1' }) }));
    expect(out).toContain('aria-current="true"');
    expect(out).toContain('bg-accent-soft');
    expect(out).toContain('before:border-accent');
  });

  it('marks every row, legacy rows included, so its controls sit above the title overlay', () => {
    // A checkbox outside the title, as the board rows have: globals.css lifts it over the
    // overlay through [data-strip], so a click checks it instead of opening the row.
    const row = html(
      h(DataListRow, {
        onClick: () => {},
        children: [
          h('input', { key: 'c', type: 'checkbox', 'aria-label': 'Select Priya' }),
          h(DataListTitle, { key: 't', children: 'Priya' }),
        ],
      }),
    );
    expect(row).toMatch(/<div data-strip="" class="[^"]*\bisolate\b/);
    expect(row).toContain('data-strip-open');
  });

  it('draws rows in a 20px card under a subtle header row, lined up on one column template', () => {
    const out = html(
      h(ListRows, {
        'aria-label': 'Candidates',
        columns: 'minmax(0,1fr) auto',
        header: [h('span', { key: 'n' }, 'Name'), h('span', { key: 's' }, 'Status')],
        children: [
          h(ListRow, { key: 'a', children: h(ListRowPrimary, { title: 'A', avatar: h('span', null, 'AA') }) }),
          h(ListRow, { key: 'b', children: 'B' }),
        ],
      }),
    );
    expect(out).toContain('rounded-card ');
    expect(out).toContain('bg-subtle');
    expect(out).toContain('--list-cols:minmax(0,1fr) auto');
    expect(out).toContain('aria-label="Candidates"');
    expect(out).toContain('min-h-14');
    // Header, list, two items and two rows share the card's tracks.
    expect(out.match(/md:grid-cols-subgrid/g)).toHaveLength(6);
  });

  it('draws the legacy DataList as the same card', () => {
    const out = html(
      h(DataList, {
        children: [
          h(DataListHeader, { key: 'h', className: 'grid-cols-[minmax(0,1fr)_auto]', children: 'Name' }),
          h(DataListBody, { key: 'b', children: h(DataListRow, { children: 'Row' }) }),
        ],
      }),
    );
    expect(out).toContain('rounded-card ');
    expect(out).toContain('bg-subtle');
    expect(out).toContain('divide-y');
    expect(out).toContain('px-4 py-2');
  });

  it('draws rows in a board column as white 16px cards, the name on its own line', () => {
    const out = html(
      h(BoardColumn, {
        title: 'Ready for review',
        count: 4,
        children: h(StripList, null, h(ListRow, null, h(ListRowPrimary, { title: 'Priya' }))),
      }),
    );
    expect(out).toContain('bg-subtle');
    expect(out).toContain('rounded-card-sm');
    expect(out).toContain('class="order-2 h-0 basis-full"');
    expect(out).not.toContain('divide-y');
    expect(html(h(Bay, { title: 'Count not known yet' }))).not.toContain('tabular-nums text-text-2');
  });
});
