'use client';

import type { HTMLAttributes } from 'react';
import { CircleCheck, Clock, Flag, Radio, TriangleAlert, type LucideIcon } from 'lucide-react';
import { STATE_MAP, getStateMeta, type StateDomain, type StateMeta } from '../../lib/status-labels';
import { StatusBadge, stateBadge, toneOf, type StateFamily, type StatusTone } from './state-tag';

type LegacyTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export type BadgeTone = LegacyTone | StateFamily;

// Legacy tones onto status tones. Ordinary states never borrow alarm colours: 'warning' was
// used for new and pending, so it is neutral; 'accent' marked calls in progress, so it is info.
const LEGACY: Record<LegacyTone, StatusTone> = {
  neutral: 'neutral',
  accent: 'info',
  success: 'success',
  warning: 'neutral',
  danger: 'danger',
};

// A word from the state map keeps its own tone and icon ("Call ended" stays neutral whatever
// tone the page passed), so a state reads the same in every badge.
const STATE_OF_WORD = new Map<string, StateMeta>([
  ...Object.values(STATE_MAP)
    .flatMap((domain) => Object.values(domain))
    .map((meta): [string, StateMeta] => [meta.label, meta]),
  ['Unknown', getStateMeta('job', null)],
]);

// Any other word takes its family's icon.
const FAMILY_ICON: Record<StateFamily, LucideIcon> = {
  queued: Clock,
  live: Radio,
  review: Flag,
  decided: CircleCheck,
  failed: TriangleAlert,
};

const isLegacy = (tone: BadgeTone): tone is LegacyTone => Object.hasOwn(LEGACY, tone);

/** @deprecated Use StatusTag (a domain state) or StatusBadge (tone and icon). Accepts the legacy tones and the families. */
export function Badge({
  tone,
  glyph,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone | null; glyph?: LucideIcon | 'live' }) {
  const state = typeof children === 'string' ? STATE_OF_WORD.get(children) : undefined;
  const given = tone ?? 'neutral';
  const shown = state
    ? stateBadge(state)
    : isLegacy(given)
      ? { tone: LEGACY[given], icon: undefined }
      : { tone: toneOf(given), icon: FAMILY_ICON[given] };
  return (
    <StatusBadge tone={shown.tone} icon={glyph ?? shown.icon} {...props}>
      {children}
    </StatusBadge>
  );
}

// Without a domain, the first that knows the value. Invites come before calls so 'pending'
// stays queued (invites, documents waiting to index) rather than a call being placed.
const ANY_DOMAIN: StateDomain[] = ['candidate', 'job', 'agent', 'invite', 'call', 'voice'];
// Statuses outside the state map (knowledge documents).
const LEGACY_FAMILY: Record<string, StateFamily> = { processing: 'live', ready: 'live' };

/** @deprecated Use StatusTag. Family of a raw status from the state map; anything unknown is decided. */
export function statusTone(status: string): StateFamily {
  for (const domain of ANY_DOMAIN) {
    const meta = Object.hasOwn(STATE_MAP[domain], status) ? STATE_MAP[domain][status] : undefined;
    if (meta) return meta.family;
  }
  return Object.hasOwn(LEGACY_FAMILY, status) ? (LEGACY_FAMILY[status] ?? 'decided') : 'decided';
}
