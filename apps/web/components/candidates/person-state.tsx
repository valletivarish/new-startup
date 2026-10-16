import { StageTag, StatusTag } from '../ui/state-tag';

/**
 * Where a person stands on their job, as one state, in Home's queue order: a call in progress
 * first, then a decision, then what waits on you. One tag per person, so a row never says
 * "Not called yet" beside "Call ended".
 */
export type PersonState = 'calling' | 'review' | 'retry' | 'hold' | 'new' | 'decided';

export function personState(stage: string | null | undefined, callStatus: string | null | undefined): PersonState {
  if (callStatus === 'calling') return 'calling';
  if (stage === 'reviewed' || stage === 'declined') return 'decided';
  if (callStatus === 'completed') return 'review';
  if (callStatus === 'failed') return 'retry';
  return stage === 'screening' ? 'hold' : 'new';
}

/**
 * The person's one state as a tag: the stage once it is a decision or on hold, else the call,
 * which names why it didn't connect when the row says ("No answer", "Line busy").
 */
export function PersonStateTag({
  stage,
  callStatus,
  failureReason,
}: {
  stage: string;
  callStatus?: string | null;
  failureReason?: string | null;
}) {
  const state = personState(stage, callStatus);
  return state === 'decided' || state === 'hold' ? (
    <StageTag value={stage} />
  ) : (
    <StatusTag domain="call" value={callStatus ?? 'not_called'} stage={stage} failureReason={failureReason} />
  );
}
