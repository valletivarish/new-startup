/**
 * Send an expired session back to sign-in, then return to this desk page.
 */
export function loginPathForReturn(pathWithSearch?: string): string {
  if (typeof window === 'undefined') return '/login';
  const next =
    pathWithSearch ??
    `${window.location.pathname}${window.location.search}`;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) {
    return '/login';
  }
  return `/login?next=${encodeURIComponent(next)}`;
}
