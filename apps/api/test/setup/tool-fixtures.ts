import type { ApiHarness, TestActor } from './api-harness.js';
import {
  acceptInvitation,
  inviteAndCaptureToken,
  registerUser,
} from './api-harness.js';
import type { AgentWorld } from './agent-fixtures.js';

export interface CatalogueTool {
  readonly id: string;
  readonly name: string;
  readonly requiredPermission: string;
  readonly enabled: boolean;
}

/** Install the built-in declarations and return them by name. */
export async function installTools(
  api: ApiHarness,
  actor: TestActor,
): Promise<Map<string, CatalogueTool>> {
  const res = await api.request({
    method: 'POST',
    url: '/tools/install-builtins',
    cookie: actor.cookie,
    payload: {},
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    throw new Error(`install failed (${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
  const { tools } = JSON.parse(res.body) as { tools: CatalogueTool[] };
  return new Map(tools.map((t) => [t.name, t]));
}

/** Grant one tool to an agent. */
export async function grantTool(
  api: ApiHarness,
  world: AgentWorld,
  toolId: string,
): Promise<void> {
  const res = await api.request({
    method: 'POST',
    url: `/agents/${world.agentId}/tools`,
    cookie: world.owner.cookie,
    payload: { toolId },
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    throw new Error(`grant failed (${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
}

/** Add a member holding a specific system role, and return their session. */
export async function addMember(
  api: ApiHarness,
  world: AgentWorld,
  roleKey: string,
  label: string,
): Promise<TestActor> {
  const member = await registerUser(api, label);
  const token = await inviteAndCaptureToken(
    api,
    world.owner,
    member.email,
    roleKey,
  );
  const accepted = await acceptInvitation(api, member, token);
  if (accepted.statusCode !== 200 && accepted.statusCode !== 201) {
    throw new Error(
      `accept failed (${accepted.statusCode}): ${accepted.body.slice(0, 300)}`,
    );
  }
  return member;
}

/** Start a session as an arbitrary actor (not necessarily the owner). */
export async function startSessionAs(
  api: ApiHarness,
  actor: TestActor,
  agentId: string,
): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/sessions',
    cookie: actor.cookie,
    payload: { agentId },
  });
  if (res.statusCode !== 201) {
    throw new Error(`session create failed (${res.statusCode}): ${res.body}`);
  }
  return (JSON.parse(res.body) as { id: string }).id;
}

export interface TurnResult {
  readonly statusCode: number;
  readonly types: readonly string[];
  readonly events: readonly {
    type: string;
    payload: Record<string, unknown>;
  }[];
  readonly last: { type: string; payload: Record<string, unknown> } | undefined;
}

/** Send a message as an arbitrary actor and summarise the outbound stream. */
export async function turn(
  api: ApiHarness,
  actor: TestActor,
  sessionId: string,
  content: string,
): Promise<TurnResult> {
  const res = await api.request({
    method: 'POST',
    url: `/sessions/${sessionId}/events`,
    cookie: actor.cookie,
    payload: { type: 'UserMessageReceived', payload: { content } },
  });
  if (res.statusCode !== 201) {
    return { statusCode: res.statusCode, types: [], events: [], last: undefined };
  }
  const body = JSON.parse(res.body) as {
    outboundEvents: { type: string; payload: Record<string, unknown> }[];
  };
  return {
    statusCode: res.statusCode,
    types: body.outboundEvents.map((e) => e.type),
    events: body.outboundEvents,
    last: body.outboundEvents.at(-1),
  };
}

/** Read the tool execution records for a session. */
export async function executions(
  api: ApiHarness,
  actor: TestActor,
  sessionId: string,
): Promise<
  readonly {
    toolName: string;
    status: string;
    denialReason: string | null;
    outputChars: number | null;
  }[]
> {
  const res = await api.request({
    method: 'GET',
    url: `/sessions/${sessionId}/tool-executions`,
    cookie: actor.cookie,
  });
  if (res.statusCode !== 200) {
    throw new Error(`executions failed (${res.statusCode}): ${res.body.slice(0, 200)}`);
  }
  return (
    JSON.parse(res.body) as {
      executions: {
        toolName: string;
        status: string;
        denialReason: string | null;
        outputChars: number | null;
      }[];
    }
  ).executions;
}
