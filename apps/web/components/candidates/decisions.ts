import type { CandidateStage } from '../../lib/api';

/** A candidate's stage on a job: undecided ('new') first, then the three decisions. */
export const STAGES = ['new', 'screening', 'reviewed', 'declined'] as const satisfies readonly CandidateStage[];

export function isStage(value: string | null | undefined): value is CandidateStage {
  return (STAGES as readonly string[]).includes(value ?? '');
}

/** The stage in the use case's words; none yet reads as undecided ("No decision yet"). */
export function decisionLabel(
  stage: string | null | undefined,
  stages: readonly { value: string; label: string }[],
): string {
  return stages.find((s) => s.value === (stage || 'new'))?.label ?? 'Unknown';
}

/** The toast after a decision: "Moved Priya Deshmukh forward", "Put 3 candidates on hold". */
export function decisionDone(stage: CandidateStage, who: string): string {
  switch (stage) {
    case 'reviewed':
      return `Moved ${who} forward`;
    case 'screening':
      return `Put ${who} on hold`;
    case 'declined':
      return `Marked ${who} as not moving forward`;
    default:
      return `Cleared the decision for ${who}`;
  }
}

export type StageTotals = { all: number; new: number; screening: number; reviewed: number; declined?: number };

/** The stage counts after people moved, so the filter counts stay true without a refetch. */
export function moveTotals(totals: StageTotals, moves: readonly { from: CandidateStage; to: CandidateStage }[]): StageTotals {
  const next = { ...totals };
  for (const { from, to } of moves) {
    next[from] = Math.max(0, (next[from] ?? 0) - 1);
    next[to] = (next[to] ?? 0) + 1;
  }
  return next;
}

// Why the latest call never connected, as a recruiter would say it.
const NO_CONNECT: Record<string, string> = {
  no_answer: 'Didn’t answer',
  busy: 'Number busy',
  voicemail: 'Went to voicemail',
  invalid_number: 'Number not valid',
  line_not_connected: 'Calling number not set up',
};

/**
 * The reason, in plain words, when the latest call never connected: nothing was said, so there
 * is no evidence to decide on. null when it did connect, or there was no call.
 */
export function noConnectReason(callStatus: string | null | undefined, failureReason: string | null | undefined): string | null {
  if (callStatus !== 'failed') return null;
  return (failureReason && NO_CONNECT[failureReason]) || 'Couldn’t connect';
}
