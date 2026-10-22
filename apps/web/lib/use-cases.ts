/**
 * Use-case-driven rendering (spec §9). The UI reads a definition instead of hard-coding
 * hiring nouns. HRVoice has one use case, bundled in use-case-definitions.ts; there is no module
 * switcher until a second one is live.
 */

import { HIRING_USE_CASE, type UseCaseDefinition } from './use-case-definitions';

export { HIRING_USE_CASE, type UseCaseDefinition, type UseCaseStage } from './use-case-definitions';

/** The definition for a use case (default hiring). Never loading, never missing. */
export function useUseCase(_id = 'hiring'): UseCaseDefinition {
  return HIRING_USE_CASE;
}
