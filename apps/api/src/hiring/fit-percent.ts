/**
 * Fit % to the hiring agent's must-ask criteria — facts only, never hire advice.
 *
 * Returns null when the agent has no criteria (nothing fake / no invented score).
 * When criteria exist, scores how many collected a clear non-empty answer.
 */

import { dataCollectionKey } from '../providers/elevenlabs/provision-config.js';

export interface FitCriterion {
  readonly id: string;
  readonly label: string;
}

function answerPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return answerPresent(row['value'] ?? row['result'] ?? row['answer']);
  }
  return false;
}

/**
 * Compute fit percent for one screening session.
 * null = no criteria on the agent, OR answers have not landed yet
 * (structuredAnswers still null — do not show a fake 0% fail score).
 */
export function computeFitPercent(
  criteria: readonly FitCriterion[],
  structuredAnswers: Readonly<Record<string, unknown>> | null | undefined,
): number | null {
  const list = criteria.filter((c) => c.label.trim().length > 0);
  if (list.length === 0) return null;
  // Answers not collected yet — withhold the score until an object exists.
  if (structuredAnswers == null) return null;

  const answers = structuredAnswers;
  let answered = 0;
  for (const c of list) {
    const byLabel = dataCollectionKey(c.label);
    const byId = dataCollectionKey(c.id);
    const value = answers[byLabel] ?? answers[byId] ?? answers[c.id];
    if (answerPresent(value)) answered += 1;
  }

  return Math.round((answered / list.length) * 100);
}
