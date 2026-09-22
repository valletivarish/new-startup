import { describe, expect, it } from 'vitest';
import {
  mapSessionStatus,
  resolveOutboundMonitorStatus,
} from './outbound-monitor-status';

describe('mapSessionStatus', () => {
  it('maps provider session statuses', () => {
    expect(mapSessionStatus('pending')).toBe('connecting');
    expect(mapSessionStatus('active')).toBe('connected');
    expect(mapSessionStatus('ended')).toBe('completed');
    expect(mapSessionStatus('failed')).toBe('failed');
  });
});

describe('resolveOutboundMonitorStatus', () => {
  it('shows connecting while dial request is in flight', () => {
    expect(
      resolveOutboundMonitorStatus({
        dialing: true,
        noticeKind: null,
        sessionApiStatus: null,
      }),
    ).toBe('connecting');
  });

  it('never fakes Connected after dial success without a session', () => {
    expect(
      resolveOutboundMonitorStatus({
        dialing: false,
        noticeKind: 'ok',
        sessionApiStatus: null,
      }),
    ).toBe('connecting');
  });

  it('tracks live session status including hangup', () => {
    expect(
      resolveOutboundMonitorStatus({
        dialing: false,
        noticeKind: 'ok',
        sessionApiStatus: 'active',
      }),
    ).toBe('connected');
    expect(
      resolveOutboundMonitorStatus({
        dialing: false,
        noticeKind: 'ok',
        sessionApiStatus: 'ended',
      }),
    ).toBe('completed');
  });

  it('surfaces dial failures', () => {
    expect(
      resolveOutboundMonitorStatus({
        dialing: false,
        noticeKind: 'err',
        sessionApiStatus: null,
      }),
    ).toBe('failed');
  });
});
