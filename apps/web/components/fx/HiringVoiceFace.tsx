import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';

/**
 * The agent's avatar on the app's light surfaces: the glass character in ink. Decorative, so
 * nothing is announced; a StatusTag or StatusIndicator beside it says the state in words.
 */
export function HiringVoiceFace({
  size = 40,
  state = 'idle',
}: {
  /** Ignored. Pass `state` instead. */
  working?: boolean;
  /** What a real call is doing right now (agentStateFor). Leave out when there is no call. */
  state?: AgentState;
  /** Width and height in px. */
  size?: number;
}) {
  return <Agent size={size} state={state} colour="glass" onLight />;
}
