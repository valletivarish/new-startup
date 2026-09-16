import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentConfiguration } from '../src/agents/configuration.js';
import { getPack, listPacks } from '../src/agents/packs/index.js';
import {
  acceptInvitation,
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  sessionCookie,
  startApi,
  type ApiHarness,
} from './setup/api-harness.js';

describe('packs registry', () => {
  it('lists hiring pack with neutral labels (no vendor names)', () => {
    const packs = listPacks();
    const hiring = packs.find((p) => p.id === 'hiring');
    expect(hiring).toBeDefined();
    expect(hiring!.label.toLowerCase()).not.toMatch(/eleven|exotel|gemini/);
    const blob = JSON.stringify(hiring).toLowerCase();
    expect(blob).not.toMatch(/elevenlabs|exotel|gemini/);
  });

  it('getPack(hiring) returns mustAskQuestions and transfer fields', () => {
    const pack = getPack('hiring');
    expect(pack.wizardFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['purpose', 'documentsHint', 'mustAskQuestions', 'transferPhones']),
    );
  });

  it('AgentConfiguration requires agentType and accepts hiring', () => {
    const parsed = AgentConfiguration.parse({
      agentType: 'hiring',
      identity: { displayName: 'Screening assistant', languages: ['en-IN'], primaryLanguage: 'en-IN' },
      purpose: 'Screen candidates against the job description',
    });
    expect(parsed.agentType).toBe('hiring');
  });
});

describe('GET /agents/packs', () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await startApi();
  }, 120_000);

  afterAll(async () => {
    await api?.close();
  });

  it('returns enabled packs with hiring wizard fields and no vendor names', async () => {
    const owner = await registerUser(api, 'packs-list');
    await createOrganization(api, owner, 'Packs List Org');
    const cookie = owner.cookie;

    const res = await api.request({
      method: 'GET',
      url: '/agents/packs',
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      packs: { id: string; label: string; wizardFields: { key: string }[] }[];
    };
    expect(body.packs.map((p) => p.id)).toEqual(['hiring', 'custom']);
    const hiring = body.packs.find((p) => p.id === 'hiring');
    expect(hiring).toBeDefined();
    expect(hiring!.wizardFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['purpose', 'mustAskQuestions', 'transferPhones']),
    );
    expect(res.body.toLowerCase()).not.toMatch(/elevenlabs|exotel|gemini/);
  });

  it('allows agent_manager (create + read) to list packs', async () => {
    const owner = await registerUser(api, 'packs-owner');
    await createOrganization(api, owner, 'Packs Manager Org');
    const manager = await registerUser(api, 'packs-manager');
    const token = await inviteAndCaptureToken(api, owner, manager.email, 'agent_manager');
    const accepted = await acceptInvitation(api, manager, token);
    expect([200, 201]).toContain(accepted.statusCode);
    const cookie = manager.cookie;

    const res = await api.request({
      method: 'GET',
      url: '/agents/packs',
      cookie,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('hiring wizard create', () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await startApi();
  }, 120_000);

  afterAll(async () => {
    await api?.close();
  });

  it('create hiring agent stores criteria and transfer phones from wizard fields', async () => {
    const owner = await registerUser(api, 'pack-create');
    await createOrganization(api, owner, 'Pack Create Org');
    const cookie = owner.cookie;

    const res = await api.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: {
        name: 'JD Screener',
        agentType: 'hiring',
        purpose: 'Screen for the open role',
        mustAskQuestions: ['How many years of relevant experience?'],
        transferPhones: ['+919876543210'],
      },
    });
    expect(res.statusCode).toBe(201);
    const agent = JSON.parse(res.body) as { id: string; versionId: string };

    const versionRes = await api.request({
      method: 'GET',
      url: `/agents/${agent.id}/versions/${agent.versionId}`,
      cookie,
    });
    expect(versionRes.statusCode).toBe(200);
    const { configuration: cfg } = JSON.parse(versionRes.body) as {
      configuration: {
        agentType: string;
        evaluation: { criteria: { label: string }[] };
        escalation: { transferPhones: string[] };
      };
    };

    expect(cfg.agentType).toBe('hiring');
    expect(cfg.evaluation.criteria.some((c) => c.label.includes('experience'))).toBe(true);
    expect(cfg.escalation.transferPhones).toContain('+919876543210');
  });
});

describe('agent creation quota', () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await startApi({ ORG_AGENT_LIMIT: '3' });
  }, 120_000);

  afterAll(async () => {
    await api?.close();
  });

  it('returns 409 when org agent limit is reached', async () => {
    const owner = await registerUser(api, 'quota');
    await createOrganization(api, owner, 'Quota Org');
    const cookie = owner.cookie;

    for (let i = 1; i <= 3; i++) {
      const res = await api.request({
        method: 'POST',
        url: '/agents',
        cookie,
        payload: { name: `Agent ${i}`, agentType: 'hiring' },
      });
      expect(res.statusCode, `create ${i}`).toBe(201);
    }

    const blocked = await api.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: { name: 'Over limit', agentType: 'hiring' },
    });
    expect(blocked.statusCode).toBe(409);
    const body = JSON.parse(blocked.body) as { message: string };
    expect(body.message.toLowerCase()).toMatch(/limit|plan/);
    expect(body.message.toLowerCase()).not.toMatch(/eleven|exotel|gemini/);
  });
});
