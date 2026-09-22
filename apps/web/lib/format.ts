/** Human-readable local date/time from an ISO timestamp. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Short public reference from a UUID — enough to tell same-titled jobs apart.
 * Full id stays in the URL / detail page.
 */
export function shortRef(id: string | null | undefined): string {
  if (!id) return '';
  const compact = id.replace(/-/g, '');
  return compact.slice(0, 8).toUpperCase();
}
