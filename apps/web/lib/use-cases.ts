/**
 * Use-case-driven rendering (spec §9). The UI reads a definition instead of hard-coding
 * hiring nouns. HRVoice is bundled (use-case-definitions.ts); the backend's copy
 * (GET /use-cases) only refines words. No module switcher until a second definition is live.
 */

import { useQuery } from '@tanstack/react-query';
import { listUseCases } from './api';
import { BUNDLED_USE_CASES, HIRING_USE_CASE, mergeUseCase, type UseCaseDefinition } from './use-case-definitions';

export {
  HIRING_USE_CASE,
  mergeUseCase,
  type UseCaseDefinition,
  type UseCaseStage,
} from './use-case-definitions';

async function fetchUseCases(): Promise<UseCaseDefinition[]> {
  try {
    const { useCases } = await listUseCases();
    return useCases.flatMap((uc) => {
      const bundled = BUNDLED_USE_CASES[uc.id];
      return bundled ? [mergeUseCase(bundled, uc)] : [];
    });
  } catch {
    return []; // Older backend, no permission or offline: the bundled definition is complete.
  }
}

/** The definition for a use case (default hiring). Never loading, never missing: falls back to the bundled one. */
export function useUseCase(id = 'hiring'): UseCaseDefinition {
  const { data } = useQuery({ queryKey: ['use-cases'], queryFn: fetchUseCases, staleTime: Infinity });
  return data?.find((uc) => uc.id === id) ?? BUNDLED_USE_CASES[id] ?? HIRING_USE_CASE;
}
