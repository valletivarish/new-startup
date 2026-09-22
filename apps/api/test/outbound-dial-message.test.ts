import { describe, expect, it } from 'vitest';
import { publicOutboundDialMessage } from '../src/providers/elevenlabs/outbound-dial-message.js';

describe('publicOutboundDialMessage', () => {
  it('returns success copy when accepted', () => {
    expect(publicOutboundDialMessage({ success: true })).toBe('Call started.');
  });

  it('maps Exotel Connect 403 dump to business-verification copy without vendor names', () => {
    const msg = publicOutboundDialMessage({
      success: false,
      rawMessage:
        "424: {'type': 'failed_dependency', 'code': 'upstream_service_error', 'message': 'Exotel Connect API returned HTTP 403', 'status': 'exotel_connect_failed'}",
    });
    expect(msg).toMatch(/business verification/i);
    expect(msg.toLowerCase()).not.toMatch(/verified number|verified mobile|whitelist/);
    expect(msg.toLowerCase()).not.toContain('exotel');
    expect(msg.toLowerCase()).not.toContain('elevenlabs');
    expect(msg.toLowerCase()).not.toContain('kyc');
    expect(msg.toLowerCase()).not.toContain('carrier');
  });

  it('maps missing company phone id to reconnect copy, never candidate-verify blame', () => {
    const msg = publicOutboundDialMessage({
      success: false,
      rawMessage: 'document_not_found for phone number phnum_dead',
    });
    expect(msg).toMatch(/phone line on this workspace is not valid anymore/i);
    expect(msg.toLowerCase()).not.toMatch(/verified|whitelist|candidate/);
  });

  it('returns generic fail for unknown errors', () => {
    expect(
      publicOutboundDialMessage({ success: false, rawMessage: 'timeout waiting for SIP' }),
    ).toMatch(/could not start the phone call/i);
    expect(
      publicOutboundDialMessage({
        success: false,
        rawMessage: 'timeout waiting for SIP',
      }).toLowerCase(),
    ).not.toMatch(/verified|whitelist/);
  });
});
