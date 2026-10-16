import * as lucide from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_STATUS_LABEL,
  CALL_STATUS_LABEL,
  JOB_STATUS_LABEL,
  PIPELINE_STATUS_LABEL,
  STATE_MAP,
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
  ['call', 'dialing', 'Calling', 'live', 'PhoneOutgoing'],
  ['call', 'ringing', 'Calling', 'live', 'PhoneOutgoing'],
  ['call', 'active', 'On call', 'live', 'LiveBars'],
  ['call', 'transferring', 'Handing to your team', 'live', 'PhoneForwarded'],
  ['call', 'results_pending', 'Writing up the call', 'live', 'FileClock'],
  ['call', 'ready_for_review', 'Ready for review', 'review', 'FileCheckCorner'],
  ['call', 'no_answer', 'No answer', 'failed', 'PhoneMissed'],
  ['call', 'busy', 'Line busy', 'failed', 'PhoneMissed'],
  ['call', 'voicemail', 'Reached voicemail', 'failed', 'Voicemail'],
  ['call', 'failed', 'Call didn’t connect', 'failed', 'TriangleAlert'],
  ['call', 'line_not_connected', 'Calling number not set up', 'failed', 'Unplug'],
  ['call', 'invalid_number', 'Number not valid', 'failed', 'TriangleAlert'],
  ['call', 'carrier_blocked', 'Call didn’t connect', 'failed', 'TriangleAlert'],
  ['call', 'network', 'Call didn’t connect', 'failed', 'TriangleAlert'],
  ['call', 'unknown', 'Call didn’t connect', 'failed', 'TriangleAlert'],
  ['voice', 'connecting', 'Connecting', 'live', 'PhoneOutgoing'],
  ['voice', 'listening', 'Listening', 'live', 'Ear'],
  ['voice', 'speaking', 'Agent speaking', 'live', 'LiveBars'],
  ['voice', 'completed', 'Call ended', 'decided', 'PhoneOff'],
  ['voice', 'failed', 'Call didn’t connect', 'failed', 'TriangleAlert'],
  ['job', 'draft', 'Draft', 'decided', 'PenLine'],
  ['job', 'open', 'Open for calls', 'live', 'Radio'],
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
      expect(meta.label).toMatch(/^[A-Z][^A-Z–—]*$/);
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
      calling: 'Calling',
      completed: 'Call ended',
      failed: 'Call didn’t connect',
    });
    expect(JOB_STATUS_LABEL.open).toBe('Open for calls');
    expect(AGENT_STATUS_LABEL.paused).toBe('Paused');
  });
});

describe('labelStatus', () => {
  it('never returns "None" or a raw value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(labelStatus(JOB_STATUS_LABEL, 'open')).toBe('Open for calls');
    expect(labelStatus(JOB_STATUS_LABEL, null)).toBe('Unknown');
    expect(labelStatus(JOB_STATUS_LABEL, undefined)).toBe('Unknown');
    expect(labelStatus(JOB_STATUS_LABEL, 'weird_value')).toBe('Unknown');
    expect(labelStatus(JOB_STATUS_LABEL, 'constructor')).toBe('Unknown');
  });
});
