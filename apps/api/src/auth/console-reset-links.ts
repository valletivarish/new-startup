/**
 * Staging aid: when NOTIFICATION_TRANSPORT=console, password-reset URLs are
 * not delivered by mail. Remember the latest link per email so the forgot
 * password UI can show a copyable URL (invite acceptUrl pattern).
 *
 * Production forbids console transport — this store stays empty there.
 */

type Entry = { readonly url: string; readonly at: number };

const TTL_MS = 15 * 60 * 1000;
const byEmail = new Map<string, Entry>();

export function rememberConsoleResetLink(email: string, url: string): void {
  byEmail.set(email.trim().toLowerCase(), { url, at: Date.now() });
}

export function takeConsoleResetLink(email: string): string | null {
  const key = email.trim().toLowerCase();
  const entry = byEmail.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    byEmail.delete(key);
    return null;
  }
  byEmail.delete(key);
  return entry.url;
}
