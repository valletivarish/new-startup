/**
 * The tool catalogue, its grants, and its execution records — against the
 * real API, real guards and real RLS.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type ApiHarness } from './setup/api-harness.js';
import { publishedAgent, type AgentWorld } from './setup/agent-fixtures.js';
import {
  addMember,
  executions,
  grantTool,
  installTools,
  startSessionAs,
  turn,
  type CatalogueTool,
} from './setup/tool-fixtures.js';

let api: ApiHarness;
let world: AgentWorld;
let tools: Map<string, CatalogueTool>;

beforeAll(async () => {
  api = await startApi();
  world = await publishedAgent(api, 'tools');
  tools = await installTools(api, world.owner);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('the catalogue', () => {
  it('installs exactly the built-in declarations', () => {
    expect([...tools.keys()].sort()).toEqual([
      'calculator',
      'deterministic_business_action',
      'test_echo',
      'test_structured_output',
    ]);
  });

  it('declares permissions drawn from the existing catalogue', () => {
    expect(tools.get('calculator')?.requiredPermission).toBe('agents.test');
    expect(tools.get('deterministic_business_action')?.requiredPermission).toBe(
      'workflows.run',
    );
  });

  it('is idempotent — reinstalling does not duplicate rows', async () => {
    const again = await installTools(api, world.owner);
    expect(again.size).toBe(tools.size);
    const listed = await api.request({
      method: 'GET',
      url: '/tools',
      cookie: world.owner.cookie,
    });
    expect(JSON.parse(listed.body).tools).toHaveLength(4);
  });

  it('grants and revokes a tool for one agent', async () => {
    const echo = tools.get('test_echo') as CatalogueTool;
    await grantTool(api, world, echo.id);

    const granted = await api.request({
      method: 'GET',
      url: `/agents/${world.agentId}/tools`,
      cookie: world.owner.cookie,
    });
    expect(
      (JSON.parse(granted.body).tools as CatalogueTool[]).map((t) => t.name),
    ).toContain('test_echo');

    const revoked = await api.request({
      method: 'DELETE',
      url: `/agents/${world.agentId}/tools/${echo.id}`,
      cookie: world.owner.cookie,
    });
    expect(revoked.statusCode).toBe(200);

    const after = await api.request({
      method: 'GET',
      url: `/agents/${world.agentId}/tools`,
      cookie: world.owner.cookie,
    });
    expect(JSON.parse(after.body).tools).toHaveLength(0);

    // Re-grant for the execution tests below.
    await grantTool(api, world, echo.id);
  });

  it('rejects a tool id from another organization as a 404', async () => {
    const other = await publishedAgent(api, 'tools-other');
    const otherTools = await installTools(api, other.owner);
    const foreign = otherTools.get('test_echo') as CatalogueTool;

    const res = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/tools`,
      cookie: world.owner.cookie,
      payload: { toolId: foreign.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses catalogue changes without agents.update', async () => {
    const analyst = await addMember(api, world, 'analyst', 'tools-analyst');
    const res = await api.request({
      method: 'POST',
      url: '/tools/install-builtins',
      cookie: analyst.cookie,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('executing a tool through a conversation', () => {
  it('runs an authorized tool and records the execution', async () => {
    const sessionId = await startSessionAs(api, world.owner, world.agentId);
    const result = await turn(
      api,
      world.owner,
      sessionId,
      'please [[tool:test_echo:{"value":"pong"}]]',
    );

    expect(result.types).toEqual([
      'AgentResponseRequested',
      'ToolRequested',
      'ToolCompleted',
      'AgentResponseGenerated',
    ]);
    expect(result.last?.payload['content']).toContain('pong');

    const records = await executions(api, world.owner, sessionId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ toolName: 'test_echo', status: 'completed' });
    expect(records[0]?.outputChars).toBeGreaterThan(0);
  });

  it('records a denial when the acting membership lacks the permission', async () => {
    // A Recruiter holds workflows.run but NOT agents.test, so the calculator
    // is refused for them and permitted for the Owner — same agent, same
    // tool, different acting membership.
    const calculator = tools.get('calculator') as CatalogueTool;
    await grantTool(api, world, calculator.id);
    const recruiter = await addMember(api, world, 'recruiter', 'tools-recruiter');

    const sessionId = await startSessionAs(api, recruiter, world.agentId);
    const result = await turn(
      api,
      recruiter,
      sessionId,
      'compute [[tool:calculator:{"operation":"add","operands":[2,2]}]]',
    );

    expect(result.types).toContain('ToolFailed');
    expect(result.types).not.toContain('ToolCompleted');

    const records = await executions(api, world.owner, sessionId);
    expect(records[0]).toMatchObject({
      toolName: 'calculator',
      status: 'denied',
      denialReason: 'permission_denied',
    });
  });

  it('denies a disabled tool even though it is granted', async () => {
    const calculator = tools.get('calculator') as CatalogueTool;
    await api.request({
      method: 'PATCH',
      url: `/tools/${calculator.id}`,
      cookie: world.owner.cookie,
      payload: { enabled: false },
    });

    const sessionId = await startSessionAs(api, world.owner, world.agentId);
    const result = await turn(
      api,
      world.owner,
      sessionId,
      'compute [[tool:calculator:{"operation":"add","operands":[2,2]}]]',
    );
    expect(result.types).toContain('ToolFailed');

    const records = await executions(api, world.owner, sessionId);
    expect(records[0]).toMatchObject({
      status: 'denied',
      denialReason: 'tool_disabled',
    });

    await api.request({
      method: 'PATCH',
      url: `/tools/${calculator.id}`,
      cookie: world.owner.cookie,
      payload: { enabled: true },
    });
  });

  it('writes an audit entry for both a denial and an execution', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/audit?limit=100',
      cookie: world.owner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const events = (
      JSON.parse(res.body) as {
        events: { event_type: string; resource_id: string | null }[];
      }
    ).events;
    const types = events.map((e) => e.event_type);

    // A denial is as important to record as a success: it is the evidence
    // that authorization did its job, and the signal if something keeps
    // trying.
    expect(types).toContain('agent.tool.denied');
    expect(types).toContain('agent.tool.completed');
    expect(types).toContain('tools.installed');
    expect(
      events.some(
        (e) =>
          e.event_type === 'agent.tool.denied' && e.resource_id === 'calculator',
      ),
    ).toBe(true);

    // The intelligence turn is audited too, with operational metadata only.
    expect(types).toContain('agent.response.generated');
  });

  it('reading executions requires agents.sessions.read', async () => {
    const sessionId = await startSessionAs(api, world.owner, world.agentId);
    const knowledgeManager = await addMember(
      api,
      world,
      'knowledge_manager',
      'tools-km',
    );
    const res = await api.request({
      method: 'GET',
      url: `/sessions/${sessionId}/tool-executions`,
      cookie: knowledgeManager.cookie,
    });
    expect(res.statusCode).toBe(403);
  });
});
