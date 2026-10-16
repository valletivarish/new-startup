/**
 * The bundled use-case definitions (spec §9), with no hooks and no API client, so server
 * components (the website, page shells) can read the words too. The hook is in use-cases.ts.
 */

import type { CandidateStage, UseCaseSummary } from './api';
import { getStateMeta, type StateFamily, type StateGlyph } from './status-labels';

export interface UseCaseStage {
  value: string;
  label: string;
  family: StateFamily;
  glyph: StateGlyph;
  /** A decision that takes the contact out of the active queue. */
  closing: boolean;
}

export interface UseCaseDefinition {
  id: string;
  moduleName: string;
  live: boolean;
  labels: {
    workItem: { one: string; many: string };
    contact: { one: string; many: string };
    agentDefaultName: string;
  };
  stages: UseCaseStage[];
}

const stage = (value: CandidateStage, closing: boolean): UseCaseStage => ({
  value,
  ...getStateMeta('candidate', value),
  closing,
});

export const HIRING_USE_CASE: UseCaseDefinition = {
  id: 'hiring',
  moduleName: 'HRVoice',
  live: true,
  labels: {
    workItem: { one: 'Job', many: 'Jobs' },
    contact: { one: 'Candidate', many: 'Candidates' },
    agentDefaultName: 'Hiring agent',
  },
  stages: [stage('new', false), stage('screening', false), stage('reviewed', true), stage('declined', true)],
};

export const BUNDLED_USE_CASES: Record<string, UseCaseDefinition> = { hiring: HIRING_USE_CASE };

const noun = (n?: { label?: string; pluralLabel?: string }) =>
  n?.label && n.pluralLabel ? { one: n.label, many: n.pluralLabel } : undefined;

/**
 * Server words over the bundled definition. Stage colours and glyphs stay ours; unknown stages are
 * ignored. The undecided stage keeps our "No decision yet": the backend still calls it "Not called
 * yet", a call's state, which contradicts the call tag once someone has been called.
 */
export function mergeUseCase(bundled: UseCaseDefinition, server: UseCaseSummary): UseCaseDefinition {
  const stageLabels = new Map((server.stages ?? []).filter((st) => st.key !== 'new').map((st) => [st.key, st.label]));
  return {
    ...bundled,
    moduleName: server.displayName || bundled.moduleName,
    labels: {
      ...bundled.labels,
      workItem: noun(server.workUnit) ?? bundled.labels.workItem,
      contact: noun(server.contact) ?? bundled.labels.contact,
    },
    stages: bundled.stages.map((st) => ({ ...st, label: stageLabels.get(st.value) || st.label })),
  };
}
