/**
 * Phase 2 — tenant isolation and permission enforcement for agent resources.
 *
 * The Phase 1 engineering rule applies unchanged: no cross-tenant data
 * access, even accidentally. These tests cover both layers — the API
 * (a foreign id is a 404, never another tenant's data) and the database
 * (RLS refuses even a direct query).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sql,
  withTenantContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';

import {
  acceptInvitation,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { appDatabase, expectRlsDenied } from './setup/fixtures.js';
import { publishedAgent, startSession, type AgentWorld } from './setup/agent-fixtures.js';

let api: ApiHarness;
let db: Database;
let orgA: AgentWorld;
let orgB: AgentWorld;
let sessionA: string;

beforeAll(async () => {
  api = await startApi();
  db = appDatabase();
  orgA = await publishedAgent(api, 'iso-a');
  orgB = await publishedAgent(api, 'iso-b');
  sessionA = await startSession(api, orgA);
}, 180_000);

afterAll(async () => {
  await api?.close();
  await db?.close();
});

describe('cross-tenant access through the API', () => {
  it("B cannot read A's agent, version, session, or events", async () => {
    const probes = [
      `/agents/${orgA.agentId}`,
      `/agents/${orgA.agentId}/versions`,
      `/agents/${orgA.agentId}/versions/${orgA.versionId}`,
      `/sessions/${sessionA}`,
      `/sessions/${sessionA}/events`,
    ];
    for (const url of probes) {
      const res = await api.request({ method: 'GET', url, cookie: orgB.owner.cookie });
      // 404, never 403: existence must not be inferable from the response.
      expect(res.statusCode, url).toBe(404);
    }
  });

  it("B cannot modify or transition A's agent", async () => {
    const attempts = [
      api.request({ method: 'PATCH', url: `/agents/${orgA.agentId}`, cookie: orgB.owner.cookie, payload: { name: 'stolen' } }),
      api.request({ method: 'POST', url: `/agents/${orgA.agentId}/pause`, cookie: orgB.owner.cookie }),
      api.request({ method: 'POST', url: `/agents/${orgA.agentId}/archive`, cookie: orgB.owner.cookie }),
      api.request({ method: 'POST', url: `/agents/${orgA.agentId}/versions`, cookie: orgB.owner.cookie, payload: { configuration: { identity: { displayName: 'x' }, purpose: 'y' } } }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(404);
    }

    // A is genuinely untouched.
    const check = await api.request({
      method: 'GET',
      url: `/agents/${orgA.agentId}`,
      cookie: orgA.owner.cookie,
    });
    const agent = JSON.parse(check.body) as { name: string; status: string };
    expect(agent.name).toBe('iso-a Agent');
    expect(agent.status).toBe('published');
  });

  it("B cannot start a session against A's agent", async () => {
    const res = await api.request({
      method: 'POST',
      url: '/sessions',
      cookie: orgB.owner.cookie,
      payload: { agentId: orgA.agentId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("B cannot append events to A's session", async () => {
    const res = await api.request({
      method: 'POST',
      url: `/sessions/${sessionA}/events`,
      cookie: orgB.owner.cookie,
      payload: { type: 'UserMessageReceived', payload: { content: 'intrusion' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("B's agent list never contains A's agents", async () => {
    const res = await api.request({ method: 'GET', url: '/agents', cookie: orgB.owner.cookie });
    const { agents } = JSON.parse(res.body) as { agents: { id: string }[] };
    expect(agents.some((a) => a.id === orgA.agentId)).toBe(false);
  });
});

describe('cross-tenant access at the DATABASE layer', () => {
  it('every agent table returns zero rows with NO tenant context', async () => {
    for (const table of ['agents', 'agent_versions', 'agent_sessions', 'agent_events']) {
      const rows = await withoutTenantContext(db.db, async (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*)::text as n from ${sql.raw(`"${table}"`)}`,
        ),
      );
      expect(rows[0]?.n, `${table} leaked rows with no tenant context`).toBe('0');
    }
  });

  it("A's context cannot read B's rows even by explicit id", async () => {
    const rows = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (tx) =>
        tx.execute(sql`select id from agents where id = ${orgB.agentId}`),
    );
    expect(rows.length).toBe(0);
  });

  it("A cannot INSERT an agent attributed to B", async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.owner.userId },
        async (tx) => {
          await tx.execute(sql`
            insert into agents (organization_id, name, purpose)
            values (${orgB.organizationId}, 'forged', 'forged')
          `);
        },
      ),
    );
  });

  it("A cannot INSERT an event into B's session", async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.owner.userId },
        async (tx) => {
          await tx.execute(sql`
            insert into agent_events
              (organization_id, session_id, sequence, type, direction)
            values (${orgB.organizationId}, ${sessionA}, 9999, 'UserMessageReceived', 'inbound')
          `);
        },
      ),
    );
  });

  it("A cannot UPDATE or DELETE B's agents", async () => {
    const updated = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (tx) =>
        tx.execute(sql`update agents set name = 'hijacked' where id = ${orgB.agentId}`),
    );
    expect(updated.count).toBe(0);

    const deleted = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (tx) => tx.execute(sql`delete from agents where id = ${orgB.agentId}`),
    );
    expect(deleted.count).toBe(0);
  });

  it('rows cannot be migrated to another tenant', async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.owner.userId },
        async (tx) => {
          await tx.execute(sql`
            update agents set organization_id = ${orgB.organizationId}
            where id = ${orgA.agentId}
          `);
        },
      ),
    );
  });
});

describe('agent permission enforcement', () => {
  let viewer: TestActor;
  let analyst: TestActor;

  beforeAll(async () => {
    viewer = await registerUser(api, 'agent-viewer');
    const vToken = await inviteAndCaptureToken(api, orgA.owner, viewer.email, 'viewer');
    expect((await acceptInvitation(api, viewer, vToken)).statusCode).toBe(201);

    analyst = await registerUser(api, 'agent-analyst');
    const aToken = await inviteAndCaptureToken(api, orgA.owner, analyst.email, 'analyst');
    expect((await acceptInvitation(api, analyst, aToken)).statusCode).toBe(201);
  }, 120_000);

  it('a Viewer can read agents but cannot create, publish, or archive', async () => {
    expect(
      (await api.request({ method: 'GET', url: '/agents', cookie: viewer.cookie })).statusCode,
    ).toBe(200);

    const denied = await Promise.all([
      api.request({ method: 'POST', url: '/agents', cookie: viewer.cookie, payload: { name: 'nope', purpose: 'nope' } }),
      api.request({ method: 'POST', url: `/agents/${orgA.agentId}/publish`, cookie: viewer.cookie }),
      api.request({ method: 'POST', url: `/agents/${orgA.agentId}/archive`, cookie: viewer.cookie }),
      api.request({ method: 'PATCH', url: `/agents/${orgA.agentId}`, cookie: viewer.cookie, payload: { name: 'nope' } }),
    ]);
    for (const res of denied) expect(res.statusCode).toBe(403);
  });

  it('an Analyst cannot read session events — they carry conversation content', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/sessions/${sessionA}/events`,
      cookie: analyst.cookie,
    });
    expect(res.statusCode).toBe(403);
  });

  it('a Viewer cannot start or drive a session', async () => {
    const create = await api.request({
      method: 'POST',
      url: '/sessions',
      cookie: viewer.cookie,
      payload: { agentId: orgA.agentId },
    });
    expect(create.statusCode).toBe(403);

    const ingest = await api.request({
      method: 'POST',
      url: `/sessions/${sessionA}/events`,
      cookie: viewer.cookie,
      payload: { type: 'UserMessageReceived', payload: { content: 'hi' } },
    });
    expect(ingest.statusCode).toBe(403);
  });

  it('reading session events is audited as sensitive access', async () => {
    await api.request({
      method: 'GET',
      url: `/sessions/${sessionA}/events`,
      cookie: orgA.owner.cookie,
    });
    const audit = await api.request({
      method: 'GET',
      url: '/audit?limit=100',
      cookie: orgA.owner.cookie,
    });
    const { events } = JSON.parse(audit.body) as {
      events: { event_type: string; metadata: { permission?: string } }[];
    };
    expect(
      events.some(
        (e) =>
          e.event_type === 'authz.sensitive_access' &&
          e.metadata?.permission === 'agents.sessions.read',
      ),
    ).toBe(true);
  });
});

describe('agent audit events', () => {
  it('records the lifecycle actions', async () => {
    const w = await publishedAgent(api, 'audited');
    // Session first: pausing an agent stops NEW sessions, so the order here
    // mirrors what an operator would actually do.
    const sessionId = await startSession(api, w);
    await api.request({
      method: 'DELETE',
      url: `/sessions/${sessionId}`,
      cookie: w.owner.cookie,
      payload: { reason: 'completed' },
    });
    await api.request({ method: 'POST', url: `/agents/${w.agentId}/pause`, cookie: w.owner.cookie });

    const res = await api.request({
      method: 'GET',
      url: '/audit?limit=200',
      cookie: w.owner.cookie,
    });
    const types = (
      JSON.parse(res.body) as { events: { event_type: string }[] }
    ).events.map((e) => e.event_type);

    for (const expected of [
      'agent.created',
      'agent.version.published',
      'agent.paused',
      'agent.session.started',
      'agent.session.ended',
    ]) {
      expect(types, `missing audit event ${expected}`).toContain(expected);
    }
  });
});
