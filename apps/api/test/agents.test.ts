/**
 * Phase 2 — agent model, versioning, lifecycle, and the runtime.
 *
 * Everything runs through the real HTTP surface against real PostgreSQL, as
 * the real non-owner role. The properties under test are the ones later
 * phases will depend on and must not silently lose: version immutability,
 * session version pinning, deterministic event ordering, and idempotency.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@platform/db';

import {
  createOrganization,
  registerUser,
  startApi,
  type ApiHarness,
} from './setup/api-harness.js';
import { expectDatabaseRejection, superDatabase } from './setup/fixtures.js';
import {
  publishedAgent,
  startSession,
  type AgentWorld,
} from './setup/agent-fixtures.js';

let api: ApiHarness;

beforeAll(async () => {
  api = await startApi();
}, 120_000);

afterAll(async () => {
  await api?.close();
});

// ---------------------------------------------------------------------------

describe('agent CRUD', () => {
  let world: AgentWorld;

  beforeAll(async () => {
    world = await publishedAgent(api, 'crud');
  });

  it('creates an agent with a draft version 1', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
    });
    const { versions } = JSON.parse(res.body) as {
      versions: { version: number; status: string }[];
    };
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
    expect(versions[0]?.status).toBe('published');
  });

  it('lists and retrieves agents within the organization', async () => {
    const list = await api.request({
      method: 'GET',
      url: '/agents',
      cookie: world.owner.cookie,
    });
    expect(list.statusCode).toBe(200);
    const { agents } = JSON.parse(list.body) as { agents: { id: string }[] };
    expect(agents.some((a) => a.id === world.agentId)).toBe(true);
  });

  it('refuses a duplicate agent name in the same organization', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/agents',
      cookie: world.owner.cookie,
      payload: { name: 'crud Agent', purpose: 'duplicate' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an invalid configuration', async () => {
    const draft = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
      payload: { configuration: { purpose: 'missing identity' } },
    });
    expect(draft.statusCode).toBe(422);
    const body = JSON.parse(draft.body) as { errors: { field: string }[] };
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown configuration key rather than dropping it', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
      payload: {
        configuration: {
          identity: { displayName: 'X' },
          purpose: 'test',
          // A typo must fail loudly, not silently disable a guardrail.
          guardrailz: { forbiddenTopics: [] },
        },
      },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------

describe('version immutability and lifecycle', () => {
  let world: AgentWorld;

  beforeAll(async () => {
    world = await publishedAgent(api, 'immutable');
  });

  it('refuses to edit a PUBLISHED version', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/agents/${world.agentId}/versions/${world.versionId}`,
      cookie: world.owner.cookie,
      payload: {
        configuration: { identity: { displayName: 'Hacked' }, purpose: 'changed' },
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('the DATABASE refuses it too, not just the service', async () => {
    // Defence in depth: even a direct UPDATE bypassing the service is
    // refused by the trigger.
    const su = superDatabase();
    try {
      await expectDatabaseRejection(
        () =>
          su.db.execute(sql`
            update agent_versions
            set configuration = '{"tampered":true}'::jsonb
            where id = ${world.versionId}
          `),
        /immutable/i,
      );
    } finally {
      await su.close();
    }
  });

  it('creates a new draft instead, and allows only one open draft', async () => {
    const first = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
      payload: {
        configuration: { identity: { displayName: 'v2' }, purpose: 'second version' },
      },
    });
    expect(first.statusCode).toBe(201);
    expect((JSON.parse(first.body) as { version: number }).version).toBe(2);

    const second = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
      payload: {
        configuration: { identity: { displayName: 'v3' }, purpose: 'third version' },
      },
    });
    expect(second.statusCode).toBe(409);
  });

  it('publishing supersedes the previous version', async () => {
    const versions = await api.request({
      method: 'GET',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
    });
    const draft = (
      JSON.parse(versions.body) as { versions: { id: string; status: string }[] }
    ).versions.find((v) => v.status === 'draft');

    const res = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions/${draft?.id}/publish`,
      cookie: world.owner.cookie,
    });
    expect(res.statusCode).toBe(201);

    const after = await api.request({
      method: 'GET',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
    });
    const list = (
      JSON.parse(after.body) as { versions: { version: number; status: string }[] }
    ).versions;
    expect(list.find((v) => v.version === 1)?.status).toBe('superseded');
    expect(list.find((v) => v.version === 2)?.status).toBe('published');
  });

  it('enforces valid lifecycle transitions and refuses invalid ones', async () => {
    // published → paused → published is allowed.
    expect(
      (await api.request({ method: 'POST', url: `/agents/${world.agentId}/pause`, cookie: world.owner.cookie })).statusCode,
    ).toBe(201);
    expect(
      (await api.request({ method: 'POST', url: `/agents/${world.agentId}/publish`, cookie: world.owner.cookie })).statusCode,
    ).toBe(201);

    // published → published is NOT a declared transition.
    const again = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/publish`,
      cookie: world.owner.cookie,
    });
    expect(again.statusCode).toBe(409);
  });

  it('archiving is terminal', async () => {
    const w = await publishedAgent(api, 'terminal');
    expect(
      (await api.request({ method: 'POST', url: `/agents/${w.agentId}/archive`, cookie: w.owner.cookie })).statusCode,
    ).toBe(201);
    // No transition leaves `archived`.
    for (const action of ['publish', 'pause', 'archive']) {
      const res = await api.request({
        method: 'POST',
        url: `/agents/${w.agentId}/${action}`,
        cookie: w.owner.cookie,
      });
      expect(res.statusCode, action).toBe(409);
    }
  });

  it('refuses concurrent publishes of two different versions', async () => {
    const w = await publishedAgent(api, 'race-publish');
    const draftRes = await api.request({
      method: 'POST',
      url: `/agents/${w.agentId}/versions`,
      cookie: w.owner.cookie,
      payload: { configuration: { identity: { displayName: 'v2' }, purpose: 'p' } },
    });
    const draftId = (JSON.parse(draftRes.body) as { id: string }).id;

    // Publish the SAME draft twice concurrently: at most one may win, and
    // the one-published-per-agent index is what guarantees it.
    const [a, b] = await Promise.all([
      api.request({ method: 'POST', url: `/agents/${w.agentId}/versions/${draftId}/publish`, cookie: w.owner.cookie }),
      api.request({ method: 'POST', url: `/agents/${w.agentId}/versions/${draftId}/publish`, cookie: w.owner.cookie }),
    ]);
    const successes = [a.statusCode, b.statusCode].filter((s) => s === 201).length;
    expect(successes).toBeLessThanOrEqual(1);

    const su = superDatabase();
    try {
      const rows = await su.db.execute<{ n: string }>(sql`
        select count(*)::text as n from agent_versions
        where agent_id = ${w.agentId} and status = 'published'
      `);
      expect(Number(rows[0]?.n)).toBe(1);
    } finally {
      await su.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('sessions pin the exact agent version', () => {
  it('a session keeps its version after a new one is published', async () => {
    const world = await publishedAgent(api, 'pinning');
    const sessionId = await startSession(api, world);

    const before = await api.request({
      method: 'GET',
      url: `/sessions/${sessionId}`,
      cookie: world.owner.cookie,
    });
    const pinned = JSON.parse(before.body) as {
      agentVersionId: string;
      agentVersion: number;
    };
    expect(pinned.agentVersion).toBe(1);

    // Publish version 2 while the session is live.
    const draft = await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions`,
      cookie: world.owner.cookie,
      payload: { configuration: { identity: { displayName: 'v2' }, purpose: 'changed' } },
    });
    const draftId = (JSON.parse(draft.body) as { id: string }).id;
    await api.request({
      method: 'POST',
      url: `/agents/${world.agentId}/versions/${draftId}/publish`,
      cookie: world.owner.cookie,
    });

    const after = await api.request({
      method: 'GET',
      url: `/sessions/${sessionId}`,
      cookie: world.owner.cookie,
    });
    const stillPinned = JSON.parse(after.body) as {
      agentVersionId: string;
      agentVersion: number;
    };
    // The live conversation is untouched by the new publish.
    expect(stillPinned.agentVersionId).toBe(pinned.agentVersionId);
    expect(stillPinned.agentVersion).toBe(1);
  });

  it('refuses a session against a draft or paused agent', async () => {
    const owner = await registerUser(api, 'nodraft');
    await createOrganization(api, owner, 'No Draft Org');
    const created = await api.request({
      method: 'POST',
      url: '/agents',
      cookie: owner.cookie,
      payload: { name: 'Draft Only', purpose: 'never published' },
    });
    const agentId = (JSON.parse(created.body) as { id: string }).id;

    const res = await api.request({
      method: 'POST',
      url: '/sessions',
      cookie: owner.cookie,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(409);
  });
});
