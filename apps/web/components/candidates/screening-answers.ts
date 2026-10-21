import { answerCoverage, type Answer } from '../shared/answers-list';

export function formatAnswerValue(value: unknown): string {
  if (value == null) return 'None';
  if (typeof value === 'string') return value.trim() || 'None';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatAnswerValue).filter((v) => v !== 'None').join(', ') || 'None';
  }
  if (typeof value === 'object') {
    return (
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${formatAnswerValue(v)}`)
        .join('; ') || 'None'
    );
  }
  return String(value);
}

export function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function callStatusLabel(status: string | null | undefined): string {
  if (status === 'active' || status === 'pending') return 'In progress';
  if (status === 'ended' || status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  const trimmed = status?.trim();
  return trimmed || 'Call';
}

export function sessionListMeta(
  session: {
    status: string | null;
    startedAt?: string | null;
    durationSeconds?: number | null;
    structuredAnswers: Record<string, unknown> | null;
    transcript: readonly unknown[] | null;
    recordingAvailable?: boolean;
    summary?: string | null;
  },
  questions: readonly { id: string; label: string }[],
): {
  when: string;
  statusLabel: string;
  durationLabel: string | null;
  answeredLabel: string | null;
  turnCount: number;
  hasRecording: boolean;
  hasSummary: boolean;
} {
  // One count everywhere: the same rule the Answers list uses.
  const { answered, total } = answerCoverage(answerItems(session.structuredAnswers, questions));
  return {
    when: session.startedAt
      ? new Date(session.startedAt).toLocaleString()
      : 'Screen',
    statusLabel: callStatusLabel(session.status),
    // A call that never connected has no length worth showing: never "0:00".
    durationLabel:
      session.durationSeconds != null && session.durationSeconds > 0 && session.status !== 'failed'
        ? formatCallDuration(session.durationSeconds)
        : null,
    answeredLabel: total > 0 ? `${answered} of ${total} answered` : null,
    turnCount: session.transcript?.length ?? 0,
    hasRecording: Boolean(session.recordingAvailable),
    hasSummary: Boolean(session.summary?.trim()),
  };
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
        answered: hit != null && formatAnswerValue(hit[1]) !== 'None',
      };
    });
    for (const [k, v] of entries) {
      if (used.has(k)) continue;
      rows.push({
        label: labelForAnswerKey(k, questions),
        value: formatAnswerValue(v),
        answered: formatAnswerValue(v) !== 'None',
      });
    }
    return rows;
  }
  return entries.map(([k, v]) => ({
    label: labelForAnswerKey(k, questions),
    value: formatAnswerValue(v),
    answered: formatAnswerValue(v) !== 'None',
  }));
}

/**
 * A call's structured answers as AnswersList rows: the job's questions in order (null when
 * nothing was said), then anything else the call collected, apart as extras. With no
 * questions to match, everything is an extra, so nothing counts as a question it wasn't.
 */
export function answerItems(
  answers: Record<string, unknown> | null | undefined,
  questions: readonly { id: string; label: string }[],
): Answer[] {
  return scorecardRows(answers, questions).map((row, i) => ({
    question: row.label,
    answer: row.answered ? row.value : null,
    extra: i >= questions.length,
  }));
}
