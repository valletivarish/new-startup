/** Home's words that depend on data. No hooks, so they test in node. */

/** Morning from 5 to 12, afternoon to 17, evening after that and through the night. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The first word of a name: "Priya Raman" gives "Priya". '' when there is no name. */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Up to two names, then how many more of the true total: "Priya Sharma and Ravi Kumar",
 * "Priya Sharma, Ravi Kumar and 4 more". '' when there are no names to show.
 */
export function namesLine(names: readonly string[], total: number): string {
  const shown = names.slice(0, 2);
  if (shown.length === 0) return '';
  const more = total - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(' and ');
}

/**
 * Whether Home's Call now and Call again can place a phone call: hidden without the permission,
 * waiting while the calling number is checked, blocked (with the reason) until it is connected.
 * A check that failed leaves them on: the call itself then says what went wrong.
 */
export function callGate(
  canCall: boolean,
  telephony: { outboundPhone: boolean } | undefined,
  failed: boolean,
): 'hidden' | 'checking' | 'no-line' | 'ready' {
  if (!canCall) return 'hidden';
  if (failed) return 'ready';
  if (!telephony) return 'checking';
  return telephony.outboundPhone ? 'ready' : 'no-line';
}

export const NO_LINE_REASON = 'Phone calls start once your calling number is connected.';
