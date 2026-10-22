import type { CandidateStage, FitLane } from '../../lib/api';

export type BoardMode = 'people' | 'review';
export type StageFilter = 'all' | CandidateStage;
export type CallFilter = 'all' | 'not_called' | 'calling' | 'completed' | 'failed';

// From this many people at once, a bulk decision asks to be typed out first.
export const BULK_CONFIRM_AT = 24;
export const needsTypedConfirm = (count: number): boolean => count >= BULK_CONFIRM_AT;

/** Review opens on answered calls nobody has decided on yet; People on everyone. */
export const defaultStageFor = (mode: BoardMode): StageFilter => (mode === 'review' ? 'new' : 'all');
export const defaultCallFor = (mode: BoardMode): CallFilter => (mode === 'review' ? 'completed' : 'all');

/** The filters the server applies to the people list: all of them, so a page is never filtered after the fact. */
export function peopleListFilters(f: { stage: StageFilter; fit: FitLane | 'all'; call: CallFilter; q: string }) {
  return {
    status: f.stage === 'all' ? undefined : f.stage,
    fit: f.fit === 'all' ? undefined : f.fit,
    call: f.call === 'all' ? undefined : f.call,
    q: f.q.trim() || undefined,
  };
}
