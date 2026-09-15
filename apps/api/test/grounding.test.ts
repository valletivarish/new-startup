/**
 * Grounding — regression tests for a defect found by running the platform,
 * not by running the suite.
 *
 * `refuseWhenNoKnowledge` used to be decided before the intelligence layer.
 * The effect was that ANY agent with knowledge attached refused every turn
 * whose retrieval scored low — including turns that asked for a tool and
 * turns that were not knowledge questions at all. Tools became unreachable
 * the moment a knowledge source was attached.
 *
 * The guardrail's real purpose is to stop the agent inventing organization
 * facts, so it now gates the ANSWER: a final response backed by neither
 * approved knowledge nor a tool result is refused. A failed lookup still
 * short-circuits, because there is nothing safe to do when the knowledge
 * system is down and the agent depends on it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type ApiHarness, type TestActor } from './setup/api-harness.js';
import { publishedAgent, type AgentWorld } from './setup/agent-fixtures.js';
import {
  executions,
  grantTool,
  installTools,
  startSessionAs,
  turn,
  type CatalogueTool,
} from './setup/tool-fixtures.js';
import { createDeterministicStrategy } from '../src/agents/runtime.js';
import { AgentConfiguration } from '../src/agents/configuration.js';

let api: ApiHarness;
let world: AgentWorld;
let owner: TestActor;

beforeAll(async () => {
  api = await startApi();
  world = await publishedAgent(api, 'grounding');
  owner = world.owner;

  const tools = await installTools(api, owner);
  await grantTool(api, world, (tools.get('test_echo') as CatalogueTool).id);

  // Attach a knowledge source. Before the fix, this alone disabled tools.
  const source = await api.request({
    method: 'POST',
    url: '/knowledge/sources',
    cookie: owner.cookie,
    payload: { name: 'Leave Policy', type: 'text' },
  });
  const sourceId = (JSON.parse(source.body) as { id: string }).id;
  await api.request({
    method: 'POST',
    url: '/knowledge/documents',
    cookie: owner.cookie,
    payload: {
      sourceId,
      name: 'leave.md',
      contentType: 'text/markdown',
      content:
        '# Leave policy\n\nEvery employee receives eighteen days of paid annual leave each year.\n',
    },
  });
  await api.request({
    method: 'POST',
    url: `/agents/${world.agentId}/knowledge`,
    cookie: owner.cookie,
    payload: { sourceId },
  });
}, 180_000);

afterAll(async () => {
  await api?.close();
});

describe('an agent with knowledge attached can still use its tools', () => {
  it('runs a granted tool on a message that retrieves nothing relevant', async () => {
    const sessionId = await startSessionAs(api, owner, world.agentId);
    const result = await turn(
      api,
      owner,
      sessionId,
      'echo this [[tool:test_echo:{"value":"still reachable"}]]',
    );

    expect(result.types).toContain('ToolRequested');
    expect(result.types).toContain('ToolCompleted');
    expect(result.last?.type).toBe('AgentResponseGenerated');
    expect(result.last?.payload['content']).toContain('still reachable');

    const records = await executions(api, owner, sessionId);
    expect(records[0]).toMatchObject({ toolName: 'test_echo', status: 'completed' });
  });

  it('answers from approved knowledge when retrieval succeeds', async () => {
    const sessionId = await startSessionAs(api, owner, world.agentId);
    const result = await turn(
      api,
      owner,
      sessionId,
      'leave policy paid annual leave employee days',
    );

    expect(result.last?.type).toBe('AgentResponseGenerated');
    expect(result.last?.payload['content']).toContain('eighteen days');
    const citations = result.last?.payload['citations'] as { documentName: string }[];
    expect(citations.map((c) => c.documentName)).toContain('leave.md');
  });

  it('still refuses an answer grounded in nothing', async () => {
    const sessionId = await startSessionAs(api, owner, world.agentId);
    // No tool requested and nothing retrievable: the model would be answering
    // from its own inclinations, which is exactly what the guardrail forbids.
    const result = await turn(
      api,
      owner,
      sessionId,
      'what is our policy on interplanetary relocation stipends',
    );

    expect(result.last?.type).toBe('AgentResponseGenerated');
    expect(result.last?.payload['content']).toMatch(/do not have approved information/i);
    expect(result.last?.payload['citations']).toEqual([]);
  });
});

describe('the deterministic pre-checks keep their ordering', () => {
  const strategy = createDeterministicStrategy();
  const configuration = AgentConfiguration.parse({
    identity: { displayName: 'Asha' },
    purpose: 'Answer questions',
  });

  it('a FAILED lookup short-circuits before the model is consulted', async () => {
    const decision = await strategy.decide({
      configuration,
      turnCount: 1,
      lastUserMessage: 'anything',
      knowledge: { outcome: 'failed', chunkCount: 0 },
    });
    expect(decision.kind).toBe('reply');
    expect(decision.kind === 'reply' && decision.content).toMatch(
      /cannot reach my knowledge sources/i,
    );
  });

  it('an empty result defers to the intelligence layer instead of refusing', async () => {
    for (const outcome of ['no_knowledge', 'below_threshold'] as const) {
      const decision = await strategy.decide({
        configuration,
        turnCount: 1,
        lastUserMessage: 'anything',
        knowledge: { outcome, chunkCount: 0 },
      });
      expect(decision.kind, outcome).toBe('defer');
    }
  });

  it('an agent with NO knowledge configured never refuses on that basis', async () => {
    const decision = await strategy.decide({
      configuration,
      turnCount: 1,
      lastUserMessage: 'anything',
    });
    expect(decision.kind).toBe('defer');
  });

  it('a forbidden topic still outranks everything', async () => {
    const guarded = AgentConfiguration.parse({
      identity: { displayName: 'Asha' },
      purpose: 'Answer questions',
      guardrails: { forbiddenTopics: ['salary'] },
      rules: [{ id: 'any', when: 'always', then: 'reply', reply: 'should not win' }],
    });
    const decision = await strategy.decide({
      configuration: guarded,
      turnCount: 1,
      lastUserMessage: 'what is the salary',
      knowledge: { outcome: 'ok', chunkCount: 3 },
    });
    expect(decision.kind === 'reply' && decision.content).toMatch(/not able to discuss/i);
  });
});
