/**
 * Phase 3 — adversarial tenant isolation for knowledge and vector retrieval.
 *
 * Organization knowledge is potentially confidential, and a vector search is
 * an unusually attractive way to exfiltrate it: it returns CONTENT, not just
 * ids. These tests attack it directly — forged tenant ids, foreign chunk and
 * document ids, retrieval with no context, and cross-tenant similarity —
 * against real PostgreSQL as the real non-owner role.
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
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { appDatabase, expectRlsDenied, superDatabase } from './setup/fixtures.js';

let api: ApiHarness;
let db: Database;

interface World {
  actor: TestActor;
  organizationId: string;
  sourceId: string;
  documentId: string;
  secret: string;
}

async function buildWorld(label: string, secret: string): Promise<World> {
  const actor = await registerUser(api, `${label}-owner`);
  const organizationId = await createOrganization(api, actor, `${label} Org`);

  const src = await api.request({
    method: 'POST',
    url: '/knowledge/sources',
    cookie: actor.cookie,
    payload: { name: `${label} Source`, type: 'text' },
  });
  const sourceId = (JSON.parse(src.body) as { id: string }).id;

  const doc = await api.request({
    method: 'POST',
    url: '/knowledge/documents',
    cookie: actor.cookie,
    payload: {
      sourceId,
      name: `${label}.md`,
      contentType: 'text/markdown',
      content: `# Confidential\n\n${secret}`,
    },
  });
  const documentId = (JSON.parse(doc.body) as { id: string }).id;
  return { actor, organizationId, sourceId, documentId, secret };
}

let orgA: World;
let orgB: World;

beforeAll(async () => {
  api = await startApi();
  db = appDatabase();
  orgA = await buildWorld('kiso-a', 'The Alpha acquisition target is Ironbark Limited.');
  orgB = await buildWorld('kiso-b', 'The Beta severance budget is four hundred lakh.');
}, 180_000);

afterAll(async () => {
  await api?.close();
  await db?.close();
});

// ---------------------------------------------------------------------------

describe('cross-tenant knowledge access through the API', () => {
  it("B cannot read A's source or document by id", async () => {
    for (const url of [
      `/knowledge/sources/${orgA.sourceId}`,
      `/knowledge/documents/${orgA.documentId}`,
    ]) {
      const res = await api.request({ method: 'GET', url, cookie: orgB.actor.cookie });
      // 404, never 403 — existence must not be probeable.
      expect(res.statusCode, url).toBe(404);
    }
  });

  it("B's lists never contain A's knowledge", async () => {
    const sources = await api.request({
      method: 'GET',
      url: '/knowledge/sources',
      cookie: orgB.actor.cookie,
    });
    const docs = await api.request({
      method: 'GET',
      url: '/knowledge/documents',
      cookie: orgB.actor.cookie,
    });
    expect(
      (JSON.parse(sources.body) as { sources: { id: string }[] }).sources.some(
        (s) => s.id === orgA.sourceId,
      ),
    ).toBe(false);
    expect(
      (JSON.parse(docs.body) as { documents: { id: string }[] }).documents.some(
        (d) => d.id === orgA.documentId,
      ),
    ).toBe(false);
  });

  it("B cannot mutate, delete or re-index A's knowledge", async () => {
    const attempts = await Promise.all([
      api.request({ method: 'PATCH', url: `/knowledge/sources/${orgA.sourceId}`, cookie: orgB.actor.cookie, payload: { name: 'stolen' } }),
      api.request({ method: 'DELETE', url: `/knowledge/sources/${orgA.sourceId}`, cookie: orgB.actor.cookie }),
      api.request({ method: 'DELETE', url: `/knowledge/documents/${orgA.documentId}`, cookie: orgB.actor.cookie }),
      api.request({ method: 'POST', url: `/knowledge/documents/${orgA.documentId}/reindex`, cookie: orgB.actor.cookie }),
    ]);
    for (const res of attempts) expect(res.statusCode).toBe(404);

    // A's document is genuinely untouched and still retrievable by A.
    const check = await api.request({
      method: 'GET',
      url: `/knowledge/documents/${orgA.documentId}`,
      cookie: orgA.actor.cookie,
    });
    expect((JSON.parse(check.body) as { status: string }).status).toBe('ready');
  });

  it("B cannot attach A's source to B's own agent", async () => {
    const agentRes = await api.request({
      method: 'POST',
      url: '/agents',
      cookie: orgB.actor.cookie,
      payload: { name: 'B Agent', purpose: 'testing' },
    });
    const agentId = (JSON.parse(agentRes.body) as { id: string }).id;

    const attach = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/knowledge`,
      cookie: orgB.actor.cookie,
      payload: { sourceId: orgA.sourceId },
    });
    // Validated explicitly, not merely hidden by RLS afterwards.
    expect(attach.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('adversarial vector retrieval', () => {
  it("B's search never returns A's content, even querying A's exact secret", async () => {
    const res = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      cookie: orgB.actor.cookie,
      payload: { query: orgA.secret, topK: 50, minSimilarity: 0 },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      chunks: { documentId: string; content: string }[];
    };
    for (const chunk of body.chunks) {
      expect(chunk.documentId).not.toBe(orgA.documentId);
      expect(chunk.content).not.toContain('Ironbark');
    }
    expect(res.body).not.toContain('Ironbark');
  });

  it("A's search never returns B's content either — isolation is symmetric", async () => {
    const res = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      cookie: orgA.actor.cookie,
      payload: { query: orgB.secret, topK: 50, minSimilarity: 0 },
    });
    expect(res.body).not.toContain('severance');
  });

  it('a forged organization id in the body is ignored, not honoured', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      cookie: orgB.actor.cookie,
      payload: {
        query: 'acquisition target',
        organizationId: orgA.organizationId,
        organization_id: orgA.organizationId,
        topK: 50,
        minSimilarity: 0,
      },
    });
    expect(res.body).not.toContain('Ironbark');
  });

  it('a forged organization id in headers or query is ignored', async () => {
    const viaHeader = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      cookie: orgB.actor.cookie,
      headers: { 'x-organization-id': orgA.organizationId },
      payload: { query: 'acquisition target', topK: 50, minSimilarity: 0 },
    });
    const viaQuery = await api.request({
      method: 'POST',
      url: `/knowledge/search?organizationId=${orgA.organizationId}`,
      cookie: orgB.actor.cookie,
      payload: { query: 'acquisition target', topK: 50, minSimilarity: 0 },
    });
    expect(viaHeader.body).not.toContain('Ironbark');
    expect(viaQuery.body).not.toContain('Ironbark');
  });

  it("narrowing by A's source id from B's session returns nothing", async () => {
    const res = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      cookie: orgB.actor.cookie,
      payload: {
        query: 'acquisition target',
        sourceIds: [orgA.sourceId],
        topK: 50,
        minSimilarity: 0,
      },
    });
    const body = JSON.parse(res.body) as { chunks: unknown[] };
    expect(body.chunks).toEqual([]);
  });

  it("narrowing by A's document id from B's session returns nothing", async () => {
    const res = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      cookie: orgB.actor.cookie,
      payload: {
        query: 'acquisition target',
        documentIds: [orgA.documentId],
        topK: 50,
        minSimilarity: 0,
      },
    });
    expect((JSON.parse(res.body) as { chunks: unknown[] }).chunks).toEqual([]);
  });

  it('anonymous retrieval is refused outright', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/knowledge/search',
      payload: { query: 'acquisition target' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe('knowledge isolation at the DATABASE layer', () => {
  it('every knowledge table returns zero rows with NO tenant context', async () => {
    for (const table of [
      'knowledge_sources',
      'knowledge_documents',
      'knowledge_chunks',
      'agent_knowledge_sources',
      'job_knowledge_sources',
      'knowledge_processing_runs',
    ]) {
      const rows = await withoutTenantContext(db.db, async (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*)::text as n from ${sql.raw(`"${table}"`)}`,
        ),
      );
      expect(rows[0]?.n, `${table} leaked rows with no tenant context`).toBe('0');
    }
  });

  it('a vector similarity scan with no tenant context returns nothing', async () => {
    // The most direct exfiltration attempt: run the scan itself unscoped.
    const rows = await withoutTenantContext(db.db, async (tx) =>
      tx.execute(sql`
        select content from knowledge_chunks
        order by embedding <=> (select embedding from knowledge_chunks limit 1)
        limit 50
      `),
    );
    expect(rows.length).toBe(0);
  });

  it("A's tenant context cannot read B's chunks by explicit id", async () => {
    const su = superDatabase();
    let bChunkId: string | undefined;
    try {
      const rows = await su.db.execute<{ id: string }>(sql`
        select id from knowledge_chunks
        where organization_id = ${orgB.organizationId} limit 1
      `);
      bChunkId = rows[0]?.id;
    } finally {
      await su.close();
    }
    expect(bChunkId).toBeDefined();

    const rows = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.actor.userId },
      async (tx) =>
        tx.execute(sql`select content from knowledge_chunks where id = ${bChunkId}`),
    );
    expect(rows.length).toBe(0);
  });

  it("A cannot INSERT knowledge attributed to B", async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.actor.userId },
        async (tx) => {
          await tx.execute(sql`
            insert into knowledge_sources (organization_id, name)
            values (${orgB.organizationId}, 'forged source')
          `);
        },
      ),
    );
  });

  it("A cannot UPDATE or DELETE B's knowledge", async () => {
    const updated = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.actor.userId },
      async (tx) =>
        tx.execute(
          sql`update knowledge_sources set name = 'hijacked' where organization_id = ${orgB.organizationId}`,
        ),
    );
    expect(updated.count).toBe(0);

    const deleted = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.actor.userId },
      async (tx) =>
        tx.execute(
          sql`delete from knowledge_chunks where organization_id = ${orgB.organizationId}`,
        ),
    );
    expect(deleted.count).toBe(0);
  });

  it('knowledge rows cannot be migrated to another tenant', async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.actor.userId },
        async (tx) => {
          await tx.execute(sql`
            update knowledge_chunks set organization_id = ${orgB.organizationId}
            where organization_id = ${orgA.organizationId}
          `);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------

describe('knowledge permission enforcement', () => {
  let viewer: TestActor;

  beforeAll(async () => {
    viewer = await registerUser(api, 'kb-viewer');
    const token = await inviteAndCaptureToken(
      api,
      orgA.actor,
      viewer.email,
      'viewer',
    );
    expect((await acceptInvitation(api, viewer, token)).statusCode).toBe(201);
  }, 120_000);

  it('a Viewer holds no knowledge permission at all', async () => {
    // Viewer is deliberately excluded from knowledge.read in the matrix —
    // organization knowledge is not automatically readable by everyone.
    const denied = await Promise.all([
      api.request({ method: 'GET', url: '/knowledge/sources', cookie: viewer.cookie }),
      api.request({ method: 'GET', url: '/knowledge/documents', cookie: viewer.cookie }),
      api.request({ method: 'POST', url: '/knowledge/search', cookie: viewer.cookie, payload: { query: 'anything' } }),
      api.request({ method: 'POST', url: '/knowledge/sources', cookie: viewer.cookie, payload: { name: 'nope' } }),
    ]);
    for (const res of denied) expect(res.statusCode).toBe(403);
  });

  it('an Agent Manager can read and re-index but not create or delete', async () => {
    const manager = await registerUser(api, 'kb-manager');
    const token = await inviteAndCaptureToken(
      api,
      orgA.actor,
      manager.email,
      'agent_manager',
    );
    expect((await acceptInvitation(api, manager, token)).statusCode).toBe(201);

    expect(
      (await api.request({ method: 'GET', url: '/knowledge/sources', cookie: manager.cookie })).statusCode,
    ).toBe(200);
    expect(
      (
        await api.request({
          method: 'POST',
          url: `/knowledge/documents/${orgA.documentId}/reindex`,
          cookie: manager.cookie,
        })
      ).statusCode,
    ).toBe(201);

    // Curation belongs to the Knowledge Manager, not the Agent Manager.
    expect(
      (
        await api.request({
          method: 'POST',
          url: '/knowledge/sources',
          cookie: manager.cookie,
          payload: { name: 'manager source' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await api.request({
          method: 'DELETE',
          url: `/knowledge/documents/${orgA.documentId}`,
          cookie: manager.cookie,
        })
      ).statusCode,
    ).toBe(403);
  }, 120_000);
});

describe('knowledge audit events', () => {
  it('records source and document lifecycle', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/audit?limit=200',
      cookie: orgA.actor.cookie,
    });
    const types = (
      JSON.parse(res.body) as { events: { event_type: string }[] }
    ).events.map((e) => e.event_type);

    for (const expected of [
      'knowledge.source.created',
      'knowledge.document.created',
      'knowledge.document.processing_started',
      'knowledge.document.processing_completed',
    ]) {
      expect(types, `missing audit event ${expected}`).toContain(expected);
    }
  });
});
