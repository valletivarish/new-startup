/**
 * Phase 4 — tenant isolation for tools, grants and execution records.
 *
 * Both layers, as in every phase: the API must answer 404 for a foreign id,
 * and the database must refuse the same access even when the query bypasses
 * the API entirely. The second half is what makes the first half survive a
 * future bug in a service method.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withTenantContext, type Database } from '@platform/db';

import { startApi, type ApiHarness } from './setup/api-harness.js';
import {
  appDatabase,
  expectDatabaseRejection,
  expectRlsDenied,
} from './setup/fixtures.js';
import { publishedAgent, type AgentWorld } from './setup/agent-fixtures.js';
import {
  grantTool,
  installTools,
  startSessionAs,
  turn,
  type CatalogueTool,
} from './setup/tool-fixtures.js';

let api: ApiHarness;
let db: Database;
let orgA: AgentWorld;
let orgB: AgentWorld;
let toolsA: Map<string, CatalogueTool>;
let toolsB: Map<string, CatalogueTool>;
let sessionA: string;

beforeAll(async () => {
  api = await startApi();
  db = appDatabase();

  orgA = await publishedAgent(api, 'tool-iso-a');
  orgB = await publishedAgent(api, 'tool-iso-b');
  toolsA = await installTools(api, orgA.owner);
  toolsB = await installTools(api, orgB.owner);

  await grantTool(api, orgA, (toolsA.get('test_echo') as CatalogueTool).id);
  sessionA = await startSessionAs(api, orgA.owner, orgA.agentId);
  await turn(api, orgA.owner, sessionA, 'echo [[tool:test_echo:{"value":"a"}]]');
}, 180_000);

afterAll(async () => {
  await api?.close();
  await db?.close();
});

const contextOf = (world: AgentWorld) => ({
  organizationId: world.organizationId,
  userId: world.owner.userId,
});

describe('the catalogue is per organization', () => {
  it('each organization sees only its own rows, with distinct ids', () => {
    const idsA = new Set([...toolsA.values()].map((t) => t.id));
    const idsB = [...toolsB.values()].map((t) => t.id);
    expect(idsB.some((id) => idsA.has(id))).toBe(false);
  });

  it('listing returns only the caller’s tools', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/tools',
      cookie: orgB.owner.cookie,
    });
    const ids = (JSON.parse(res.body) as { tools: CatalogueTool[] }).tools.map(
      (t) => t.id,
    );
    const idsA = new Set([...toolsA.values()].map((t) => t.id));
    expect(ids.some((id) => idsA.has(id))).toBe(false);
  });

  it("B cannot enable or disable A's tool", async () => {
    const foreign = toolsA.get('calculator') as CatalogueTool;
    const res = await api.request({
      method: 'PATCH',
      url: `/tools/${foreign.id}`,
      cookie: orgB.owner.cookie,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("B cannot grant A's tool to B's own agent", async () => {
    const foreign = toolsA.get('calculator') as CatalogueTool;
    const res = await api.request({
      method: 'POST',
      url: `/agents/${orgB.agentId}/tools`,
      cookie: orgB.owner.cookie,
      payload: { toolId: foreign.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("B cannot list the tools of A's agent", async () => {
    const res = await api.request({
      method: 'GET',
      url: `/agents/${orgA.agentId}/tools`,
      cookie: orgB.owner.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("B cannot read A's tool executions", async () => {
    const res = await api.request({
      method: 'GET',
      url: `/sessions/${sessionA}/tool-executions`,
      cookie: orgB.owner.cookie,
    });
    // The session is not B's, so there is nothing to return. Never A's rows.
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).executions).toEqual([]);
  });
});

describe('row-level security refuses the same access directly', () => {
  it("B's tenant context cannot select A's tools", async () => {
    const rows = await withTenantContext(db.db, contextOf(orgB), async (tx) =>
      tx.execute<{ id: string }>(sql`
        select id from tools where organization_id = ${orgA.organizationId}
      `),
    );
    expect(rows).toEqual([]);
  });

  it("B's tenant context cannot select A's grants or executions", async () => {
    const grants = await withTenantContext(db.db, contextOf(orgB), async (tx) =>
      tx.execute(sql`select id from agent_tools where agent_id = ${orgA.agentId}`),
    );
    expect(grants).toEqual([]);

    const runs = await withTenantContext(db.db, contextOf(orgB), async (tx) =>
      tx.execute(sql`select id from tool_executions where session_id = ${sessionA}`),
    );
    expect(runs).toEqual([]);
  });

  it("B cannot insert a tool into A's organization", async () => {
    await expectRlsDenied(() =>
      withTenantContext(db.db, contextOf(orgB), async (tx) =>
        tx.execute(sql`
          insert into tools
            (organization_id, name, description, input_schema, output_schema,
             required_permission)
          values (${orgA.organizationId}, 'smuggled', '', '{}'::jsonb, '{}'::jsonb,
                  'agents.test')
        `),
      ),
    );
  });

  it("B cannot grant one of A's tools by writing the row directly", async () => {
    const toolId = (toolsA.get('calculator') as CatalogueTool).id;
    await expectRlsDenied(() =>
      withTenantContext(db.db, contextOf(orgB), async (tx) =>
        tx.execute(sql`
          insert into agent_tools (organization_id, agent_id, tool_id)
          values (${orgA.organizationId}, ${orgA.agentId}, ${toolId})
        `),
      ),
    );
  });

  it('A cannot forge an execution record for another organization', async () => {
    await expectRlsDenied(() =>
      withTenantContext(db.db, contextOf(orgA), async (tx) =>
        tx.execute(sql`
          insert into tool_executions
            (organization_id, session_id, tool_name, call_id, status)
          values (${orgB.organizationId}, ${sessionA}, 'test_echo', 'forged', 'completed')
        `),
      ),
    );
  });
});

describe('the execution record is append-only', () => {
  it('the runtime role cannot update or delete an execution', async () => {
    const existing = await withTenantContext(db.db, contextOf(orgA), async (tx) =>
      tx.execute<{ id: string }>(sql`
        select id from tool_executions
        where organization_id = ${orgA.organizationId} limit 1
      `),
    );
    const id = existing[0]?.id;
    expect(id, 'the setup turn should have recorded an execution').toBeTruthy();

    await expectDatabaseRejection(
      () =>
        withTenantContext(db.db, contextOf(orgA), async (tx) =>
          tx.execute(sql`
            update tool_executions set status = 'completed' where id = ${id}
          `),
        ),
      /permission denied/i,
    );

    await expectDatabaseRejection(
      () =>
        withTenantContext(db.db, contextOf(orgA), async (tx) =>
          tx.execute(sql`delete from tool_executions where id = ${id}`),
        ),
      /permission denied/i,
    );
  });

  it('a denial is recorded, not just a success', async () => {
    // The evidence that authorization did its job has to survive too.
    const sessionB = await startSessionAs(api, orgB.owner, orgB.agentId);
    await turn(api, orgB.owner, sessionB, 'run [[tool:test_echo:{"value":"x"}]]');

    const rows = await withTenantContext(db.db, contextOf(orgB), async (tx) =>
      tx.execute<{ status: string; denial_reason: string | null }>(sql`
        select status, denial_reason from tool_executions
        where session_id = ${sessionB} and organization_id = ${orgB.organizationId}
      `),
    );
    expect(rows[0]?.status).toBe('denied');
    expect(rows[0]?.denial_reason).toBe('not_granted_to_agent');
  });
});
