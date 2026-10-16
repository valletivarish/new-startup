const BASE = 'https://app.invalid';

// A backslash, or a control character (tab, newline, NUL, DEL).
const isUnsafeChar = (c: string) => {
  const code = c.charCodeAt(0);
  return c === '\\' || code < 0x20 || code === 0x7f;
};

/**
 * A `next` path that is safe to send someone to after sign-in, or null. Only a path on this
 * site counts: the URL parser reads `/\evil.example` (and tab or newline variants, which
 * URLSearchParams decodes from %5C, %09, %0A) as another host, so backslashes and control
 * characters are refused before parsing, and the parsed origin must still be ours.
 * /login itself is refused, so sign-in never loops back to sign-in.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || [...raw].some(isUnsafeChar)) return null;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE || url.pathname.startsWith('/login')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Send an expired session back to sign-in, then return to this desk page.
 */
export function loginPathForReturn(pathWithSearch?: string): string {
  if (typeof window === 'undefined') return '/login';
  const next = safeReturnPath(pathWithSearch ?? `${window.location.pathname}${window.location.search}`);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
