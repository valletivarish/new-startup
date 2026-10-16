'use client';

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  Archive,
  Ban,
  CalendarX,
  Circle,
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  CircleX,
  Clock,
  Ear,
  FileCheckCorner,
  FileClock,
  Flag,
  Hourglass,
  Info,
  Mail,
  PenLine,
  PhoneForwarded,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Radio,
  RefreshCw,
  TriangleAlert,
  Unplug,
  UserCheck,
  Voicemail,
  type LucideIcon,
} from 'lucide-react';
import {
  callStateKey,
  getStateMeta,
  type CallStateInput,
  type StateDomain,
  type StateFamily,
  type StateGlyph,
  type StateMeta,
} from '../../lib/status-labels';
import { useUseCase } from '../../lib/use-cases';
import { cn } from './cn';
import { STATUS_TONE, type StatusTone } from './notice';

/** Strip Board families, still used by lib/status-labels. StatusTone is the new vocabulary. */
export type { StateFamily, StatusTone };

// Server components import STATE_EDGE from './state-classes'; this re-export is for client code.
export { STATE_EDGE } from './state-classes';

/**
 * The live dot of spec 2: 6px, in the badge's colour. Its ring pulses three times after each
 * mount (a badge remounts on every `stamped` change), then rests. Still under reduced motion.
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-1.5 shrink-0', className)}>
      <span className="absolute inset-0 rounded-pill bg-current opacity-60 motion-safe:animate-[ping_1s_var(--ease-out)_3]" />
      <span className="relative size-1.5 rounded-pill bg-current" />
    </span>
  );
}

/** @deprecated Strip Board name of the live glyph. Draws the live dot. */
export const LiveBars = LiveDot;

// Every state shows an icon and a word. A badge given no icon takes its tone's.
const TONE_ICON: Record<StatusTone, LucideIcon> = {
  neutral: Circle,
  info: Info,
  success: CircleCheck,
  warning: Flag,
  danger: TriangleAlert,
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** A Lucide icon, or 'live' for the pulsing dot while something is live right now. Defaults to the tone's icon. */
  icon?: LucideIcon | 'live';
  /** Each change of this value replays the entrance and the live dot's pulses: pass the state itself. Never on first render. */
  stamped?: boolean | string | number;
  /** The word. Colour never carries the state alone. */
  children: ReactNode;
}

/** Tag with soft 6px corners (D2's and the website's tags): status tint, 1px border, 12px icon or live dot, and the word. */
export function StatusBadge({ tone, icon, stamped, className, children, ...rest }: StatusBadgeProps) {
  // Count changes of `stamped` while rendering (React's "adjust state when a prop changes"
  // pattern) and remount the pill on each one, so the entrance and the pulses replay.
  const [last, setLast] = useState(stamped);
  const [stamps, setStamps] = useState(0);
  if (stamped !== last) {
    setLast(stamped);
    setStamps((n) => n + 1);
  }
  const Icon = icon ?? TONE_ICON[tone];

  return (
    <span
      key={stamps}
      {...rest}
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xs border px-2 text-caption font-medium',
        STATUS_TONE[tone],
        stamps > 0 && 'motion-safe:animate-fade-in',
        className,
      )}
    >
      {Icon === 'live' ? <LiveDot /> : <Icon aria-hidden strokeWidth={2} className="size-3 shrink-0" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

// Glyph names in lib/status-labels onto icons. 'LiveBars' is the live dot, not an icon.
export const STATE_GLYPHS: Record<StateGlyph, LucideIcon | 'live'> = {
  Clock,
  CirclePause,
  CircleCheck,
  CircleX,
  PhoneOutgoing,
  LiveBars: 'live',
  PhoneForwarded,
  FileClock,
  FileCheckCorner,
  PhoneMissed,
  PhoneOff,
  Voicemail,
  TriangleAlert,
  PenLine,
  Radio,
  Archive,
  Mail,
  UserCheck,
  CalendarX,
  Ban,
  CircleQuestionMark,
  Unplug,
  Ear,
  Hourglass,
  RefreshCw,
};

const GLYPH_NAME = new Map(
  Object.entries(STATE_GLYPHS).map(([name, icon]) => [icon, name as StateGlyph] as const),
);

// lib/status-labels still speaks in Strip Board families. Spec 2 splits two of them, and the
// glyph settles which way: a call being placed, handed over or written up (and an invite
// waiting) is info, any other live state success; a decided state is neutral unless it moved
// forward (success) or is on hold (warning).
const INFO_GLYPHS = new Set<StateGlyph>(['PhoneOutgoing', 'PhoneForwarded', 'FileClock', 'Mail']);
// Spec 2 draws a live dot instead of an icon for a call ringing out and a call connected now.
const LIVE_GLYPHS = new Set<StateGlyph>(['PhoneOutgoing', 'LiveBars']);

/** The status tone of a Strip Board family, given the state's glyph when known. */
export function toneOf(family: StateFamily, glyph?: StateGlyph): StatusTone {
  if (family === 'failed') return 'danger';
  // Ready for review is new work waiting for a person: blue, like Home's review card. Not green,
  // which would read as approved; not amber, which is on hold and the other review states.
  if (glyph === 'FileCheckCorner') return 'info';
  if (family === 'review') return 'warning';
  if (glyph && INFO_GLYPHS.has(glyph)) return 'info';
  if (family === 'live' || glyph === 'CircleCheck') return 'success';
  return glyph === 'CirclePause' ? 'warning' : 'neutral';
}

/** A state from the one map as StatusBadge props: its tone, and its icon or the live dot. */
export function stateBadge({ family, glyph }: Pick<StateMeta, 'family' | 'glyph'>) {
  return {
    tone: toneOf(family, glyph),
    icon: LIVE_GLYPHS.has(glyph) ? ('live' as const) : STATE_GLYPHS[glyph],
  };
}

export interface StateTagProps extends Omit<StatusBadgeProps, 'tone' | 'icon'> {
  family: StateFamily;
  /** A Lucide icon, or 'live' for the live dot. Use 'live' only while a call is live right now. */
  glyph?: LucideIcon | 'live';
}

/** @deprecated Use StatusBadge (tone and icon) or StatusTag (a domain state from the one map). */
export function StateTag({ family, glyph, ...rest }: StateTagProps) {
  return <StatusBadge tone={toneOf(family, glyph && GLYPH_NAME.get(glyph))} icon={glyph} {...rest} />;
}

export interface StatusTagProps
  extends Omit<StatusBadgeProps, 'tone' | 'icon' | 'children'>,
    Omit<CallStateInput, 'callStatus'> {
  domain: StateDomain;
  /** The raw value from the API. Unknown or missing values show "Unknown", never the raw value. */
  value: string | null | undefined;
}

/**
 * A domain state from the one map, as word, tone and icon. For calls, pass what you know
 * and it picks the word (callStateKey): a failed call shows its reason, a finished one shows
 * "Ready for review" while the candidate is still new or on hold.
 * <StatusTag domain="call" value={row.callStatus} stage={row.status} failureReason={row.failureReason} />
 * Stages: use StageTag, which follows the use case's words.
 */
export function StatusTag({ domain, value, stage, hasResults, failureReason, ...rest }: StatusTagProps) {
  const key = domain === 'call' ? callStateKey({ callStatus: value, stage, hasResults, failureReason }) : value;
  const meta = getStateMeta(domain, key);
  return (
    <StatusBadge {...stateBadge(meta)} {...rest}>
      {meta.label}
    </StatusBadge>
  );
}

export interface StageTagProps extends Omit<StatusBadgeProps, 'tone' | 'icon' | 'children'> {
  /** The raw stage: new, screening, reviewed, declined. */
  value: string | null | undefined;
}

/**
 * A contact's stage in the use case's own words (spec 9), the same words as the stage
 * filters built from useUseCase().stages. Falls back to the state map.
 */
export function StageTag({ value, ...rest }: StageTagProps) {
  const meta = useUseCase().stages.find((s) => s.value === value) ?? getStateMeta('candidate', value);
  return (
    <StatusBadge {...stateBadge(meta)} {...rest}>
      {meta.label}
    </StatusBadge>
  );
}
