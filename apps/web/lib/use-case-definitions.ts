/**
 * The bundled use-case definitions (spec §9), with no hooks and no API client, so server
 * components (the website, page shells) can read the words too. The hook is in use-cases.ts.
 */

import type { CandidateStage } from './api';
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

