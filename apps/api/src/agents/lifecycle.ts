/**
 * Agent and version lifecycle.
 *
 * Transitions are an explicit allow-list. Anything not named here is refused,
 * so the set of reachable states stays small enough to reason about — and a
 * future phase adding a state has to state its transitions rather than
 * quietly widening the machine.
 */

import { ApiError } from '../errors.js';

export const AGENT_STATUSES = ['draft', 'published', 'paused', 'archived'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const VERSION_STATUSES = [
  'draft',
  'published',
  'superseded',
  'archived',
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/**
 * Permitted agent transitions.
 *
 * `archived` is terminal: an archived agent is retained for history and audit
 * but never returns to service. Reviving one means creating a new agent, which
 * keeps the audit trail of the old one honest.
 */
const AGENT_TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = {
  draft: ['published', 'archived'],
  published: ['paused', 'archived'],
  paused: ['published', 'archived'],
  archived: [],
};

const VERSION_TRANSITIONS: Readonly<
  Record<VersionStatus, readonly VersionStatus[]>
> = {
  draft: ['published', 'archived'],
  // A published version is replaced, never edited (enforced by trigger too).
  published: ['superseded', 'archived'],
  superseded: ['archived'],
  archived: [],
};

export function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

export function isVersionStatus(value: string): value is VersionStatus {
  return (VERSION_STATUSES as readonly string[]).includes(value);
}

export function canTransitionAgent(from: AgentStatus, to: AgentStatus): boolean {
  return AGENT_TRANSITIONS[from].includes(to);
}

export function canTransitionVersion(
  from: VersionStatus,
  to: VersionStatus,
): boolean {
  return VERSION_TRANSITIONS[from].includes(to);
}

/** Throws a 409 naming both states, so the error explains the rule. */
export function assertAgentTransition(from: string, to: AgentStatus): void {
  if (!isAgentStatus(from) || !canTransitionAgent(from, to)) {
    throw ApiError.conflict(
      `An agent cannot go from "${from}" to "${to}"`,
    );
  }
}

export function assertVersionTransition(from: string, to: VersionStatus): void {
  if (!isVersionStatus(from) || !canTransitionVersion(from, to)) {
    throw ApiError.conflict(
      `An agent version cannot go from "${from}" to "${to}"`,
    );
  }
}

/** Agents that may serve new sessions. */
export function canStartSession(status: string): boolean {
  return status === 'published';
}
