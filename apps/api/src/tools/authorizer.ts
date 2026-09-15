/**
 * Tool authorization.
 *
 * THE RULE THIS FILE ENFORCES: **the model requesting a tool does not
 * authorize the tool.** A `ToolRequest` is a suggestion. Authorization is
 * decided here, from state the model cannot influence:
 *
 *   1. Does the tool EXIST in this organization's catalogue? (RLS-scoped)
 *   2. Is it ENABLED?
 *   3. Is there a registered IMPLEMENTATION for that name?
 *   4. Has this AGENT been granted it?
 *   5. Does the ACTING MEMBERSHIP hold the tool's required permission?
 *
 * All five must pass. Every one of them is server-side state; none of them is
 * derivable from prompt text, retrieved documents, or tool output. There is
 * deliberately no argument to this function that a model could supply.
 *
 * The decision is a PURE function so it can be tested exhaustively without a
 * database, and so no call site can accidentally take a shortcut through it.
 */

import type { ToolRecord } from './registry.js';

export type ToolDenialReason =
  | 'unknown_tool'
  | 'tool_disabled'
  | 'not_implemented'
  | 'not_granted_to_agent'
  | 'permission_denied';

export type ToolAuthorization =
  | { readonly allowed: true; readonly tool: ToolRecord }
  | {
      readonly allowed: false;
      readonly reason: ToolDenialReason;
      /** Business language, safe to show a user and to log. */
      readonly message: string;
    };

export interface AuthorizationInput {
  /** The catalogue row, already scoped to the organization. Null if absent. */
  readonly tool: ToolRecord | null;
  /** Whether a registered implementation exists for the requested name. */
  readonly implemented: boolean;
  /** Whether the agent that owns the session has been granted this tool. */
  readonly grantedToAgent: boolean;
  /**
   * Permissions of the MEMBERSHIP the agent is acting on behalf of — resolved
   * from the session on the server. Never a value the model or client sends.
   */
  readonly grantedPermissions: ReadonlySet<string>;
}

const MESSAGES: Record<ToolDenialReason, string> = {
  unknown_tool: 'That tool is not available.',
  tool_disabled: 'That tool is currently disabled.',
  not_implemented: 'That tool has no implementation on this platform.',
  not_granted_to_agent: 'This agent is not allowed to use that tool.',
  permission_denied: 'You do not have permission to use that tool.',
};

function deny(reason: ToolDenialReason): ToolAuthorization {
  return { allowed: false, reason, message: MESSAGES[reason] };
}

export function authorizeTool(input: AuthorizationInput): ToolAuthorization {
  // Order matters only for the quality of the message; every check is
  // independently required, and none of them can be skipped by an earlier
  // one passing.
  if (!input.tool) return deny('unknown_tool');
  if (!input.implemented) return deny('not_implemented');
  if (!input.tool.enabled) return deny('tool_disabled');
  if (!input.grantedToAgent) return deny('not_granted_to_agent');
  if (!input.grantedPermissions.has(input.tool.requiredPermission)) {
    return deny('permission_denied');
  }
  return { allowed: true, tool: input.tool };
}
