import { describe, expect, it } from 'vitest';
import { toPublicId } from './public-id';
import {
  latestMessageAt,
  looksLikeEmail,
  newCustomerMessages,
  overallState,
  relatedFromLocation,
  type AdminTicket,
} from './support';

const JOB = '2f1c7b9e-4a3d-4c1b-9e2f-1a2b3c4d5e6f';
const CAND = '7d6e5f4a-3b2c-4d1e-8f9a-0b1c2d3e4f5a';

describe('relatedFromLocation', () => {
  it('reads the job from /jobs/<id> and the candidate from ?c=', () => {
    expect(relatedFromLocation(`/jobs/${toPublicId(JOB)}/candidates`, `?c=${toPublicId(CAND)}&tab=answers`)).toEqual({
      jobId: JOB,
      candidateId: CAND,
    });
    expect(relatedFromLocation(`/jobs/${JOB}`, '')).toEqual({ jobId: JOB });
  });
  it('attaches nothing elsewhere or for junk ids', () => {
    expect(relatedFromLocation('/dashboard', '')).toEqual({});
    expect(relatedFromLocation('/jobs/new', '')).toEqual({});
    expect(relatedFromLocation('/jobs/not-an-id', '?c=nope')).toEqual({});
  });
});

const ticket = (id: string, kind: 'customer' | 'staff' | null, at: string): AdminTicket => ({
  id,
  ref: 'abcdefabcdef',
  subject: 's',
  status: 'open',
  channel: 'chat',
  jobId: null,
  candidateId: null,
  callId: null,
  createdAt: at,
  updatedAt: at,
  lastMessageAt: at,
  organizationId: null,
  organizationName: null,
  requesterEmail: 'a@b.c',
  requesterName: null,
  unanswered: 1,
  lastMessage: kind ? { id: `m-${id}`, authorKind: kind, body: 'hi', createdAt: at } : null,
});

describe('inbox notifications', () => {
  const list = [
    ticket('a', 'customer', '2026-10-21T10:00:05Z'),
    ticket('b', 'staff', '2026-10-21T10:00:06Z'),
    ticket('c', 'customer', '2026-10-21T09:00:00Z'),
    ticket('d', null, '2026-10-21T11:00:00Z'),
  ];
  it('announces nothing on the first load', () => {
    expect(newCustomerMessages(list, null)).toEqual([]);
  });
  it('announces only customer messages newer than the last look', () => {
    expect(newCustomerMessages(list, '2026-10-21T10:00:00Z').map((t) => t.id)).toEqual(['a']);
  });
  it('moves the mark to the newest message', () => {
    expect(latestMessageAt(list, null)).toBe('2026-10-21T10:00:06.000Z');
    expect(latestMessageAt([], '2026-10-21T10:00:00Z')).toBe('2026-10-21T10:00:00.000Z');
  });
});

describe('status and email', () => {
  it('the worst part sets the headline', () => {
    const c = (state: 'operational' | 'degraded' | 'down') => ({ id: 'api' as const, name: 'x', note: '', state });
    expect(overallState([c('operational'), c('operational')])).toBe('operational');
    expect(overallState([c('operational'), c('degraded')])).toBe('degraded');
    expect(overallState([c('degraded'), c('down')])).toBe('down');
  });
  it('checks an email loosely', () => {
    expect(looksLikeEmail(' a@b.co ')).toBe(true);
    expect(looksLikeEmail('a@b')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });
});
