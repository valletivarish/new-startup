import { describe, expect, it } from 'vitest';

import {
  SKIP_REASON,
  connectResultMessage,
  connectionProblem,
  linksChanged,
  noteProblem,
  type ZohoLink,
} from './connected-systems';
import { plainServerText } from './errors';

const CODES = ['connected', 'denied', 'expired', 'no_applications_module', 'no_refresh_token', 'failed', 'something_new'];

describe('connected systems wording', () => {
  it('every sign-in result is a plain sentence a recruiter can act on', () => {
    expect(connectResultMessage(null)).toBeNull();
    for (const code of CODES) {
      const m = connectResultMessage(code)!;
      expect(m.title).toBeTruthy();
      // Our own words pass the same filter that hides server jargon.
      expect(plainServerText(m.detail), code).not.toBeNull();
      expect(`${m.title} ${m.detail}`).not.toMatch(/token|oauth|scope|webhook|api|_/i);
    }
    expect(connectResultMessage('connected')!.kind).toBe('success');
    expect(connectResultMessage('something_new')!.kind).toBe('error');
  });

  it('says why a connection is stuck, and nothing when it is fine', () => {
    const t = () => '4:10 pm';
    expect(connectionProblem({ status: 'connected', reason: null, pausedUntil: null }, t)).toBeNull();
    expect(connectionProblem({ status: 'paused', reason: 'rate_limited', pausedUntil: '2026-10-21T10:40:00Z' }, t)).toContain('4:10 pm');
    for (const reason of ['consent_revoked', 'connected_by_left', 'no_applications_module', 'other']) {
      const text = connectionProblem({ status: 'needs_attention', reason, pausedUntil: null }, t)!;
      expect(text).not.toMatch(/token|consent_revoked|_/);
    }
    expect(connectionProblem({ status: 'connected', reason: 'zoho_unreachable', pausedUntil: null }, t)).toContain('next check');
  });

  it('skip reasons and note problems count people and never show codes', () => {
    for (const fn of Object.values(SKIP_REASON)) {
      expect(fn(1)).toMatch(/^1 person/);
      expect(fn(3)).toMatch(/^3 people/);
      expect(fn(3)).not.toMatch(/_/);
    }
    for (const code of ['expired', 'not_connected', 'zoho_rejected', 'rate_limited', null]) {
      expect(noteProblem(code)).not.toMatch(/_|token/);
    }
  });

  it('knows when the picked jobs differ from what is saved', () => {
    const saved: ZohoLink[] = [{ zohoJobId: 'z1', zohoJobTitle: 'Picker', jobId: 'j1', jobTitle: 'Picker', autoCall: false, imported: 2 }];
    expect(linksChanged(saved, [{ zohoJobId: 'z1', zohoJobTitle: 'Picker', jobId: 'j1', autoCall: false }])).toBe(false);
    expect(linksChanged(saved, [{ zohoJobId: 'z1', zohoJobTitle: 'Picker', jobId: 'j1', autoCall: true }])).toBe(true);
    expect(linksChanged(saved, [{ zohoJobId: 'z1', zohoJobTitle: 'Picker', autoCall: false }])).toBe(true);
    expect(linksChanged(saved, [])).toBe(true);
  });
});
