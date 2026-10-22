import * as lucide from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_STATUS_LABEL,
  CALL_STATUS_LABEL,
  JOB_STATUS_LABEL,
  PIPELINE_STATUS_LABEL,
  JOB_ACTION_LABEL,
  STATE_MAP,
  TEST_ONLY_BANNER,
  callStateKey,
  getStateMeta,
  labelStatus,
  type StateDomain,
} from './status-labels';

afterEach(() => {
  vi.restoreAllMocks();
});

// Spec §2.6, row by row: [domain, value, word, family, glyph]
const SPEC: [StateDomain, string, string, string, string][] = [
  ['candidate', 'new', 'No decision yet', 'queued', 'Clock'],
  ['candidate', 'screening', 'On hold', 'decided', 'CirclePause'],
  ['candidate', 'reviewed', 'Moved forward', 'decided', 'CircleCheck'],
  ['candidate', 'declined', 'Not moving forward', 'decided', 'CircleX'],
  ['call', 'not_called', 'Not called yet', 'queued', 'Clock'],
  ['call', 'dialing', 'On the phone', 'live', 'PhoneOutgoing'],
  ['call', 'ringing', 'On the phone', 'live', 'PhoneOutgoing'],
  ['call', 'active', 'On the phone', 'live', 'LiveBars'],
  ['call', 'transferring', 'Handing to your team', 'live', 'PhoneForwarded'],
  ['call', 'results_pending', 'Writing up the call', 'live', 'FileClock'],
  ['call', 'ready_for_review', 'Ready for review', 'review', 'FileCheckCorner'],
  ['call', 'no_answer', "Didn't connect · Rang out", 'failed', 'PhoneMissed'],
  ['call', 'busy', "Didn't connect", 'failed', 'PhoneMissed'],
  ['call', 'voicemail', "Didn't connect · Voicemail", 'failed', 'Voicemail'],
  ['call', 'failed', "Didn't connect", 'failed', 'TriangleAlert'],
  ['call', 'line_not_connected', "Didn't connect · Number not reachable", 'failed', 'Unplug'],
  ['call', 'invalid_number', "Didn't connect · Number not reachable", 'failed', 'TriangleAlert'],
  ['call', 'carrier_blocked', "Didn't connect", 'failed', 'TriangleAlert'],
  ['call', 'network', "Didn't connect", 'failed', 'TriangleAlert'],
  ['call', 'unknown', "Didn't connect", 'failed', 'TriangleAlert'],
  ['voice', 'connecting', 'Connecting', 'live', 'PhoneOutgoing'],
  ['voice', 'listening', 'Listening', 'live', 'Ear'],
  ['voice', 'speaking', 'Speaking', 'live', 'LiveBars'],
  ['voice', 'completed', 'Call ended', 'decided', 'PhoneOff'],
  ['voice', 'failed', "Didn't connect", 'failed', 'TriangleAlert'],
  ['job', 'draft', 'Draft', 'decided', 'PenLine'],
  ['job', 'open', 'Active', 'live', 'Radio'],
  ['job', 'closed', 'Closed', 'decided', 'Archive'],
  ['agent', 'draft', 'Draft', 'decided', 'PenLine'],
  ['agent', 'published', 'Live', 'live', 'Radio'],
  ['agent', 'paused', 'Paused', 'review', 'CirclePause'],
  ['agent', 'archived', 'Archived', 'decided', 'Archive'],
  ['invite', 'pending', 'Waiting', 'queued', 'Mail'],
  ['invite', 'accepted', 'Joined', 'live', 'UserCheck'],
  ['invite', 'expired', 'Expired', 'review', 'CalendarX'],
  ['invite', 'revoked', 'Revoked', 'decided', 'Ban'],
];

describe('getStateMeta', () => {
  it.each(SPEC)('%s %s → %s', (domain, value, label, family, glyph) => {
    expect(getStateMeta(domain, value)).toEqual({ label, family, glyph });
  });

  it('unknown or missing values read "Unknown" and warn once in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unknown = { label: 'Unknown', family: 'decided', glyph: 'CircleQuestionMark' };
    expect(getStateMeta('call', 'mystery_state')).toEqual(unknown);
    expect(getStateMeta('call', 'mystery_state')).toEqual(unknown);
    expect(getStateMeta('job', 'toString')).toEqual(unknown);
    expect(getStateMeta('candidate', null)).toEqual(unknown);
    expect(getStateMeta('candidate', '')).toEqual(unknown);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('every glyph is an icon in the installed lucide-react (or the live bars)', () => {
    const glyphs = Object.values(STATE_MAP).flatMap((m) => Object.values(m).map((s) => s.glyph));
    for (const glyph of glyphs) {
      if (glyph !== 'LiveBars') expect(lucide, glyph).toHaveProperty(glyph);
    }
    expect(lucide).toHaveProperty('CircleQuestionMark');
  });

  it('words are sentence case with no dashes', () => {
    for (const meta of Object.values(STATE_MAP).flatMap((m) => Object.values(m))) {
      expect(meta.label.replace(/ · [A-Z]/g, ' · x')).toMatch(/^[A-Z][^A-Z–—]*$/);
    }
  });
});

describe('callStateKey', () => {
  it('shows a failed call by its mapped reason, the generic words otherwise', () => {
    expect(callStateKey({ callStatus: 'failed', failureReason: 'no_answer' })).toBe('no_answer');
    expect(callStateKey({ callStatus: 'failed', failureReason: 'line_not_connected' })).toBe('line_not_connected');
    expect(callStateKey({ callStatus: 'failed', failureReason: 'carrier_blocked' })).toBe('carrier_blocked');
    expect(callStateKey({ callStatus: 'failed', failureReason: 'solar_flare' })).toBe('failed');
    expect(callStateKey({ callStatus: 'failed', failureReason: 'completed' })).toBe('failed');
    expect(callStateKey({ callStatus: 'failed' })).toBe('failed');
  });

  it('a finished call waits on a person while the stage is open (backend readyForReview)', () => {
    for (const callStatus of ['completed', 'ended']) {
      expect(callStateKey({ callStatus, stage: 'new' })).toBe('ready_for_review');
      expect(callStateKey({ callStatus, stage: 'screening', hasResults: true })).toBe('ready_for_review');
      expect(callStateKey({ callStatus, stage: 'new', hasResults: false })).toBe('results_pending');
      expect(callStateKey({ callStatus, stage: 'reviewed' })).toBe('completed');
      expect(callStateKey({ callStatus, stage: 'declined' })).toBe('completed');
      expect(callStateKey({ callStatus })).toBe('completed');
    }
    expect(getStateMeta('call', callStateKey({ callStatus: 'completed', stage: 'new' })).label).toBe('Ready for review');
  });

  it('passes every other state through', () => {
    expect(callStateKey({ callStatus: 'active', stage: 'new' })).toBe('active');
    expect(callStateKey({ callStatus: 'not_called' })).toBe('not_called');
    expect(callStateKey({ callStatus: 'ready_for_review' })).toBe('ready_for_review');
    expect(callStateKey({ callStatus: null })).toBeNull();
  });
});

describe('legacy maps follow the state map', () => {
  it('uses the spec words', () => {
    expect(PIPELINE_STATUS_LABEL).toEqual({
      new: 'No decision yet',
      screening: 'On hold',
      reviewed: 'Moved forward',
      declined: 'Not moving forward',
    });
    expect(CALL_STATUS_LABEL).toEqual({
      not_called: 'Not called yet',
      calling: 'On the phone',
      completed: 'Call ended',
      failed: "Didn't connect",
    });
    expect(JOB_STATUS_LABEL.open).toBe('Active');
    expect(AGENT_STATUS_LABEL.paused).toBe('Paused');
  });
});

describe('labelStatus', () => {
  it('never returns "None" or a raw value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(labelStatus(JOB_STATUS_LABEL, 'open')).toBe('Active');
    expect(labelStatus(JOB_STATUS_LABEL, null)).toBe('Unknown');
    expect(labelStatus(JOB_STATUS_LABEL, undefined)).toBe('Unknown');
    expect(labelStatus(JOB_STATUS_LABEL, 'weird_value')).toBe('Unknown');
    expect(labelStatus(JOB_STATUS_LABEL, 'constructor')).toBe('Unknown');
  });
});

describe('one vocabulary (redesign slice 1)', () => {
  it('jobs read Active, with the test-only case a banner rather than a word', () => {
    expect(STATE_MAP.job.open!.label).toBe('Active');
    expect(STATE_MAP.job.open_test_only!.label).toBe('Active');
    expect(TEST_ONLY_BANNER).toBe('Browser test calls only until your calling number is set up');
    expect(JOB_ACTION_LABEL).toEqual({
      open: 'Make active',
      reopen: 'Make active again',
      draft: 'Move to draft',
      close: 'Close job',
    });
  });

  it('a call that did not connect names its reason from stored states only', () => {
    expect(STATE_MAP.call.no_answer!.label).toBe("Didn't connect · Rang out");
    expect(STATE_MAP.call.voicemail!.label).toBe("Didn't connect · Voicemail");
    expect(STATE_MAP.call.line_not_connected!.label).toBe("Didn't connect · Number not reachable");
    expect(STATE_MAP.call.not_called!.label).toBe('Not called yet');
  });

  it('fit lanes read Needs a look, and the old words are gone', async () => {
    const { LANE_LABEL, FIT_LANES, OVERALL } = await import('../components/candidates/fit');
    expect(LANE_LABEL.check).toBe('Needs a look');
    expect(OVERALL.check.label).toBe('Needs a look');
    expect(FIT_LANES).not.toContain('not_screened');
    const all = [
      ...Object.values(STATE_MAP).flatMap((m) => Object.values(m).map((s) => s.label)),
      ...Object.values(JOB_STATUS_LABEL),
      ...Object.values(LANE_LABEL),
      ...Object.values(OVERALL).map((o) => o.label),
    ];
    for (const label of all) {
      expect(label).not.toMatch(/Open for calls|Not screened/);
      expect(label).not.toBe('Check');
    }
    for (const label of Object.values(JOB_STATUS_LABEL)) expect(label).not.toMatch(/Published|Live/);
  });
});
