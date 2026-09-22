/**
 * Maps provider/carrier dial failures to plain recruiter-facing copy.
 * Never returns vendor product names.
 */

const CARRIER_BLOCK =
  /whitelist|not verified|not allowed|forbidden|kyc|trial|403|exotel_connect_failed|failed_dependency|connect api returned|upstream_service_error/i;

const LINE_MISSING =
  /document_not_found|phone.?number.*not found|agentPhoneNumberId|phnum_/i;

export function publicOutboundDialMessage(input: {
  success: boolean;
  rawMessage?: string;
}): string {
  if (input.success) return 'Call started.';
  const raw = input.rawMessage ?? '';
  if (LINE_MISSING.test(raw)) {
    return (
      'The phone line on this workspace is not valid anymore. ' +
      'Ask an admin to reconnect the company phone number, then try Call phone again.'
    );
  }
  if (CARRIER_BLOCK.test(raw)) {
    return (
      'The company phone line rejected this dial. ' +
      'Finish business verification on the phone account, then try Call phone again.'
    );
  }
  return 'Could not start the phone call. Try again in a moment.';
}
