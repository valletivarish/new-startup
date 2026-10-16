import type { AgentState } from '../brand/agent-draw';
import { STATE_MAP } from '../../lib/status-labels';

// Raw call and test-call states (STATE_MAP.call and .voice keys) the agent acts out. The rest:
// a failure of any kind is 'missed', anything unknown or not started is 'idle'.
const ACTS: Record<string, AgentState> = {
  pending: 'ringing',
  dialing: 'ringing',
  ringing: 'ringing',
  calling: 'ringing',
  connecting: 'ringing',
  transferring: 'ringing', // dialling someone on the team
  active: 'listening',
  connected: 'listening',
  listening: 'listening',
  interrupted: 'listening',
  speaking: 'speaking',
  processing: 'thinking',
  reconnecting: 'thinking',
  results_pending: 'thinking', // writing up the call
  ready_for_review: 'done',
  completed: 'done',
  ended: 'done',
};

/**
 * The agent's face for a call's state, so it mirrors what really happened: ringing while it
 * dials, listening while connected (who is talking is not known from the state alone; pass
 * 'speaking' yourself when it is), done once the call ended, missed when it didn't connect.
 * Takes the key StatusTag shows: callStateKey(...) for calls, the voice status for test calls.
 */
export function agentStateFor(state: string | null | undefined): AgentState {
  if (!state) return 'idle';
  if (Object.hasOwn(ACTS, state)) return ACTS[state] ?? 'idle';
  return STATE_MAP.call[state]?.family === 'failed' ? 'missed' : 'idle';
}
