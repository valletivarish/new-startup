import { describe, expect, it } from 'vitest';
import { AgentConfiguration } from '../src/agents/configuration.js';
import { getPack, listPacks } from '../src/agents/packs/index.js';

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
