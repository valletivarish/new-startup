/**
 * Immutable VoiceSession provision snapshot (PO Q2=B).
 *
 * Frozen at browser/outbound call start so fit / review / ask-AI interpret
 * the call with the config actually used — not later Job or Agent edits.
 * Provider deployments remain one-per-agent-version (not per Job).
 */

import { createHash } from 'node:crypto';

import type { EvaluationCriterion } from './provision-config.js';
import type { KnowledgeSnapshot } from './types.js';

export const PROVISION_SNAPSHOT_VERSION = 1 as const;

export interface VoiceProvisionSnapshot {
  readonly version: typeof PROVISION_SNAPSHOT_VERSION;
  /** ISO timestamp when this snapshot was frozen. */
  readonly frozenAt: string;
  readonly jobId: string | null;
  readonly agentId: string;
  readonly agentVersionId: string;
  /**
   * True when Job screening questions and/or knowledge were applied.
   * False when call used agent config (no job, or empty job → agent fallback).
   */
  readonly usedJobScreening: boolean;
  /**
   * True only when a jobId was supplied but Job screening was empty, so
   * agent criteria/knowledge were used instead.
   */
  readonly usedAgentFallback: boolean;
  /** Must-ask / evaluation criteria actually sent to the provider. */
  readonly evaluationCriteria: readonly EvaluationCriterion[];
  /** Screening language actually used ('en' | 'hi' or provider tag). */
  readonly screeningLanguage: string;
  readonly knowledgeSourceIds: readonly string[];
  /** Truncated knowledge metadata — not the full KB payload. */
  readonly knowledge: {
    readonly name: string;
    readonly contentChars: number;
    readonly contentFingerprint: string;
  } | null;
  readonly agentPrompt: string;
  readonly firstMessage: string;
  readonly transferPhones: readonly string[];
  readonly voiceId: string | null;
}

export function fingerprintKnowledgeContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 24);
}

export function buildVoiceProvisionSnapshot(input: {
  jobId?: string | null;
  agentId: string;
  agentVersionId: string;
  usedJobScreening: boolean;
  evaluationCriteria: readonly EvaluationCriterion[];
  screeningLanguage: string;
  knowledgeSourceIds: readonly string[];
  knowledgeSnapshot?: KnowledgeSnapshot | null;
  agentPrompt: string;
  firstMessage: string;
  transferPhones: readonly string[];
  voiceId?: string | null;
  frozenAt?: string;
}): VoiceProvisionSnapshot {
  const jobId = input.jobId ?? null;
  const usedJobScreening = input.usedJobScreening;
  const knowledge = input.knowledgeSnapshot
    ? {
        name: input.knowledgeSnapshot.name,
        contentChars: input.knowledgeSnapshot.content.length,
        contentFingerprint: fingerprintKnowledgeContent(
          input.knowledgeSnapshot.content,
        ),
      }
    : null;

  return {
    version: PROVISION_SNAPSHOT_VERSION,
    frozenAt: input.frozenAt ?? new Date().toISOString(),
    jobId,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    usedJobScreening,
    usedAgentFallback: Boolean(jobId) && !usedJobScreening,
    evaluationCriteria: input.evaluationCriteria.map((c) => ({
      id: c.id,
      label: c.label,
      ...(c.required !== undefined ? { required: c.required } : {}),
    })),
    screeningLanguage: input.screeningLanguage,
    knowledgeSourceIds: [...input.knowledgeSourceIds],
    knowledge,
    agentPrompt: input.agentPrompt,
    firstMessage: input.firstMessage,
    transferPhones: [...input.transferPhones],
    voiceId: input.voiceId ?? null,
  };
}

/**
 * Extract evaluation criteria from a stored snapshot.
 * Returns null when the column is missing/unusable (legacy sessions).
 * Returns [] when the snapshot froze with no criteria.
 */
export function criteriaFromProvisionSnapshot(
  raw: unknown,
): { id: string; label: string }[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const criteria = (raw as Record<string, unknown>).evaluationCriteria;
  if (!Array.isArray(criteria)) return null;

  const out: { id: string; label: string }[] = [];
  for (const item of criteria) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (id && label) out.push({ id, label });
  }
  return out;
}
