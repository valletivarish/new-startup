import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentConfiguration } from '../src/agents/configuration.js';
import { getPack, listPacks } from '../src/agents/packs/index.js';
import {
  createOrganization,
  registerUser,
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
