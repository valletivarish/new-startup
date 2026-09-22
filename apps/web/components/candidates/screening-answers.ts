export function formatAnswerValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatAnswerValue).filter((v) => v !== '—').join(', ') || '—';
  }
  if (typeof value === 'object') {
    return (
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${formatAnswerValue(v)}`)
        .join('; ') || '—'
    );
  }
  return String(value);
}

export function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function labelForAnswerKey(
  key: string,
  questions: readonly { id: string; label: string }[],
): string {
  const exact = questions.find(
    (q) => q.id === key || q.id.replace(/-/g, '_') === key,
  );
  if (exact?.label.trim()) return exact.label.trim();
  const normalized = key.replace(/_/g, ' ').trim().toLowerCase();
  const byLabel = questions.find(
    (q) => q.label.trim().toLowerCase() === normalized,
  );
  if (byLabel?.label.trim()) return byLabel.label.trim();
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function scorecardRows(
  answers: Record<string, unknown> | null | undefined,
  questions: readonly { id: string; label: string }[],
): { label: string; value: string; answered: boolean }[] {
  const entries = answers ? Object.entries(answers) : [];
  if (questions.length > 0) {
    const used = new Set<string>();
    const rows = questions.map((q) => {
      const hit = entries.find(
        ([k]) =>
          k === q.id ||
          k.replace(/-/g, '_') === q.id.replace(/-/g, '_') ||
          k.replace(/_/g, ' ').toLowerCase() === q.label.trim().toLowerCase(),
      );
      if (hit) used.add(hit[0]);
      return {
        label: q.label.trim() || labelForAnswerKey(q.id, questions),
        value: hit ? formatAnswerValue(hit[1]) : 'No answer recorded',
        answered: Boolean(hit),
      };
    });
    for (const [k, v] of entries) {
      if (used.has(k)) continue;
      rows.push({
        label: labelForAnswerKey(k, questions),
        value: formatAnswerValue(v),
        answered: true,
      });
    }
    return rows;
  }
  return entries.map(([k, v]) => ({
    label: labelForAnswerKey(k, questions),
    value: formatAnswerValue(v),
    answered: true,
  }));
}
