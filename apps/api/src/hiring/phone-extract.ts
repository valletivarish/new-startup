const MAX_PHONES = 5;

const PLUS91_PATTERN = /\+91[\s\-.]?([6-9](?:[\s\-.]?\d){9})(?!\d)/g;
const ZERO_MOBILE_PATTERN = /(?<!\d)0[\s\-.]?([6-9](?:[\s\-.]?\d){9})(?!\d)/g;
/** Bare or spaced 10-digit mobiles (e.g. 98765 43210). */
const MOBILE_PATTERN = /(?<!\d)([6-9](?:[\s\-.]?\d){9})(?!\d)/g;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Resume PDF text often wraps country codes: (+91), 91-, etc. Normalize those
 * before matching so Call phone can prefill from common India formats.
 */
function preprocessResumeText(text: string): string {
  return text
    .replace(/\(\s*\+?\s*91\s*\)/gi, '+91')
    .replace(/(?<![\d+])91(?=[\s\-.]?[6-9])/g, '+91');
}

function normalizeIndianMobile(raw: string): string | null {
  const digits = digitsOnly(raw);
  if (digits.length === 12 && digits.startsWith('91')) {
    const mobile = digits.slice(2);
    return mobile.length === 10 && /^[6-9]/.test(mobile) ? `+91${mobile}` : null;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    const mobile = digits.slice(1);
    return mobile.length === 10 && /^[6-9]/.test(mobile) ? `+91${mobile}` : null;
  }
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return digits;
  }
  return null;
}

function canonicalKey(normalized: string): string {
  return normalized.startsWith('+91') ? normalized.slice(3) : normalized;
}

function preferPlus91(existing: string, candidate: string): string {
  if (candidate.startsWith('+91')) return candidate;
  return existing.startsWith('+91') ? existing : candidate;
}

export function extractPhonesFromText(text: string): string[] {
  if (!text.trim()) return [];

  const prepared = preprocessResumeText(text);
  const seen = new Map<string, string>();

  const consider = (match: string) => {
    const normalized = normalizeIndianMobile(match);
    if (!normalized) return;
    const key = canonicalKey(normalized);
    const existing = seen.get(key);
    seen.set(key, existing ? preferPlus91(existing, normalized) : normalized);
  };

  for (const match of prepared.matchAll(PLUS91_PATTERN)) {
    consider(match[0]);
  }
  for (const match of prepared.matchAll(ZERO_MOBILE_PATTERN)) {
    consider(match[0]);
  }
  for (const match of prepared.matchAll(MOBILE_PATTERN)) {
    consider(match[1] ?? match[0]);
  }

  return [...seen.values()].slice(0, MAX_PHONES);
}
