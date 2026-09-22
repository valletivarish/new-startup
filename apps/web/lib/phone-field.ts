/**
 * Country-code + national number helpers for the hiring desk.
 * Stored/API value is always E.164 (e.g. +918919504427). UI never forces
 * recruiters to type "+91" by hand — they pick the dial from a dropdown.
 */

export interface CountryDial {
  readonly iso: string;
  readonly dial: string;
  readonly label: string;
}

/** India-first list; dial codes used in compose/split. */
export const COUNTRY_DIALS: readonly CountryDial[] = [
  { iso: 'IN', dial: '91', label: 'India (+91)' },
  { iso: 'AE', dial: '971', label: 'UAE (+971)' },
  { iso: 'SG', dial: '65', label: 'Singapore (+65)' },
  { iso: 'GB', dial: '44', label: 'United Kingdom (+44)' },
  { iso: 'US', dial: '1', label: 'United States (+1)' },
  { iso: 'CA', dial: '1', label: 'Canada (+1)' },
  { iso: 'AU', dial: '61', label: 'Australia (+61)' },
  { iso: 'DE', dial: '49', label: 'Germany (+49)' },
  { iso: 'PH', dial: '63', label: 'Philippines (+63)' },
  { iso: 'BD', dial: '880', label: 'Bangladesh (+880)' },
  { iso: 'NP', dial: '977', label: 'Nepal (+977)' },
  { iso: 'LK', dial: '94', label: 'Sri Lanka (+94)' },
] as const;

export const DEFAULT_COUNTRY_ISO = 'IN';

export function defaultDial(): string {
  return COUNTRY_DIALS.find((c) => c.iso === DEFAULT_COUNTRY_ISO)?.dial ?? '91';
}

/** Longest dial match first so +971 wins over +9…. */
const DIALS_BY_LENGTH = [...COUNTRY_DIALS]
  .map((c) => c.dial)
  .filter((d, i, arr) => arr.indexOf(d) === i)
  .sort((a, b) => b.length - a.length);

export function splitE164(raw: string | null | undefined): {
  dial: string;
  national: string;
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { dial: defaultDial(), national: '' };
  }

  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    const rest = digits.slice(1);
    for (const dial of DIALS_BY_LENGTH) {
      if (rest.startsWith(dial) && rest.length > dial.length) {
        return { dial, national: rest.slice(dial.length) };
      }
    }
    // Unknown country: keep first 1–3 as dial guess, rest national.
    const guess = rest.slice(0, Math.min(3, Math.max(1, rest.length - 6)));
    return { dial: guess || defaultDial(), national: rest.slice(guess.length) };
  }

  const only = digits.replace(/\D/g, '');
  // Bare 10-digit Indian mobile → India.
  if (only.length === 10 && /^[6-9]/.test(only)) {
    return { dial: '91', national: only };
  }
  if (only.length === 12 && only.startsWith('91')) {
    return { dial: '91', national: only.slice(2) };
  }
  if (only.length === 11 && only.startsWith('0') && /^[6-9]/.test(only.slice(1))) {
    return { dial: '91', national: only.slice(1) };
  }

  return { dial: defaultDial(), national: only };
}

/**
 * Build E.164 from selected dial + national digits.
 * Returns '' when national is empty so optional fields stay clearable.
 */
export function composeE164(dial: string, national: string): string {
  const d = dial.replace(/\D/g, '');
  let n = national.replace(/\D/g, '');
  if (!n) return '';
  // Drop a single leading 0 (trunk prefix) for common formats.
  if (n.startsWith('0') && n.length > 1) n = n.slice(1);
  // Avoid double country code if paste included it.
  if (d && n.startsWith(d) && n.length > d.length + 5) {
    n = n.slice(d.length);
  }
  if (!d || !n) return '';
  return `+${d}${n}`;
}
