import type { ApiHarness, TestActor } from './api-harness.js';
import { createOrganization, registerUser } from './api-harness.js';

export interface AgentWorld {
  readonly owner: TestActor;
  readonly organizationId: string;
  readonly agentId: string;
  readonly versionId: string;
}

/** A published agent, ready to serve sessions. */
export async function publishedAgent(
  api: ApiHarness,
  label: string,
  configOverrides: Record<string, unknown> = {},
): Promise<AgentWorld> {
  const owner = await registerUser(api, `${label}-owner`);
  const organizationId = await createOrganization(api, owner, `${label} Org`);

  const created = await api.request({
    method: 'POST',
    url: '/agents',
    cookie: owner.cookie,
    payload: { name: `${label} Agent`, purpose: 'Testing the runtime' },
  });
  if (created.statusCode !== 201) {
    throw new Error(`agent create failed (${created.statusCode}): ${created.body}`);
  }
  const { id: agentId, versionId } = JSON.parse(created.body) as {
    id: string;
    versionId: string;
  };

  if (Object.keys(configOverrides).length > 0) {
    const current = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/versions/${versionId}`,
      cookie: owner.cookie,
    });
    const version = JSON.parse(current.body) as { configuration: Record<string, unknown> };
    const patched = await api.request({
      method: 'PATCH',
      url: `/agents/${agentId}/versions/${versionId}`,
      cookie: owner.cookie,
      payload: { configuration: { ...version.configuration, ...configOverrides } },
    });
    if (patched.statusCode !== 200) {
      throw new Error(`draft update failed (${patched.statusCode}): ${patched.body}`);
    }
  }

  const published = await api.request({
    method: 'POST',
    url: `/agents/${agentId}/versions/${versionId}/publish`,
    cookie: owner.cookie,
  });
  if (published.statusCode !== 201) {
    throw new Error(`publish failed (${published.statusCode}): ${published.body}`);
  }

  return { owner, organizationId, agentId, versionId };
}

/** Start a session against a published agent. */
export async function startSession(
  api: ApiHarness,
  world: AgentWorld,
): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/sessions',
    cookie: world.owner.cookie,
    payload: { agentId: world.agentId },
  });
  if (res.statusCode !== 201) {
    throw new Error(`session create failed (${res.statusCode}): ${res.body}`);
  }
  return (JSON.parse(res.body) as { id: string }).id;
}

/** Send a user message through the runtime. */
export async function sendMessage(
  api: ApiHarness,
  world: AgentWorld,
  sessionId: string,
  content: string,
  idempotencyKey?: string,
) {
  return api.request({
    method: 'POST',
    url: `/sessions/${sessionId}/events`,
    cookie: world.owner.cookie,
    payload: {
      type: 'UserMessageReceived',
      payload: { content },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  });
}
