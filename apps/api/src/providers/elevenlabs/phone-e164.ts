/**
 * Normalize candidate phones to E.164 for outbound dialing (India-first).
 */

export function toE164Phone(raw: string, defaultCountry = 'IN'): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && /^\+[1-9]\d{7,14}$/.test(digits)) {
    return digits;
  }

  const only = digits.replace(/\D/g, '');
  if (defaultCountry === 'IN') {
    if (only.length === 10 && /^[6-9]/.test(only)) return `+91${only}`;
    if (only.length === 12 && only.startsWith('91')) return `+${only}`;
    if (only.length === 11 && only.startsWith('0') && /^[6-9]/.test(only.slice(1))) {
      return `+91${only.slice(1)}`;
    }
  }

  if (only.length >= 8 && only.length <= 15) return `+${only}`;
  return null;
}
