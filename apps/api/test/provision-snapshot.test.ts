import { describe, expect, it } from 'vitest';

import {
  buildVoiceProvisionSnapshot,
  criteriaFromProvisionSnapshot,
  fingerprintKnowledgeContent,
} from '../src/providers/elevenlabs/provision-snapshot.js';

describe('provision-snapshot', () => {
  it('builds a durable snapshot with knowledge fingerprint and fallback flags', () => {
    const snap = buildVoiceProvisionSnapshot({
      jobId: 'job-1',
      agentId: 'agent-1',
      agentVersionId: 'ver-1',
      usedJobScreening: false,
      evaluationCriteria: [{ id: 'q1', label: 'Years of experience?' }],
      screeningLanguage: 'en',
      knowledgeSourceIds: ['ks-1'],
      knowledgeSnapshot: { name: 'JD', content: 'Backend role JD text' },
      agentPrompt: 'Ask about experience.',
      firstMessage: 'Hi, quick screen?',
      transferPhones: ['+919876543210'],
      voiceId: 'voice-abc',
      frozenAt: '2026-09-17T00:00:00.000Z',
    });

    expect(snap.version).toBe(1);
    expect(snap.usedJobScreening).toBe(false);
    expect(snap.usedAgentFallback).toBe(true);
    expect(snap.knowledge?.contentFingerprint).toBe(
      fingerprintKnowledgeContent('Backend role JD text'),
    );
    expect(snap.knowledge?.contentChars).toBe('Backend role JD text'.length);
    expect(snap.evaluationCriteria[0]?.label).toBe('Years of experience?');
  });

  it('parses criteria from stored JSON and returns null for legacy rows', () => {
    expect(criteriaFromProvisionSnapshot(null)).toBeNull();
    expect(criteriaFromProvisionSnapshot({})).toBeNull();
    expect(
      criteriaFromProvisionSnapshot({
        evaluationCriteria: [{ id: 'q1', label: 'City?' }],
      }),
    ).toEqual([{ id: 'q1', label: 'City?' }]);
    expect(
      criteriaFromProvisionSnapshot({ evaluationCriteria: [] }),
    ).toEqual([]);
  });
});
