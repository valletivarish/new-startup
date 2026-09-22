import { describe, expect, it } from 'vitest';
import {
  buildVoiceProvisionConfig,
  dataCollectionKey,
} from '../src/providers/elevenlabs/provision-config.js';

describe('dataCollectionKey', () => {
  it('normalizes ids to safe keys', () => {
    expect(dataCollectionKey('q1')).toBe('q1');
    expect(dataCollectionKey(' Years Experience ')).toBe('years_experience');
  });
});

describe('buildVoiceProvisionConfig', () => {
  it('keeps purpose-only prompt when there are no criteria', () => {
    const result = buildVoiceProvisionConfig({
      agentPurpose: 'Screen support candidates.',
    });
    expect(result.agentPrompt).toContain('Screen support candidates.');
    expect(result.agentPrompt).toContain('voicemail');
    expect(result.dataCollection).toBeNull();
    expect(result.builtInTools.endCall).toEqual({
      name: 'end_call',
      params: { systemToolType: 'end_call' },
    });
  });

  it('adds must-ask instructions, no-hire rule, and data_collection', () => {
    const result = buildVoiceProvisionConfig({
      agentPurpose: 'Screen for customer support.',
      agentType: 'hiring',
      criteria: [
        { id: 'q1', label: 'How many years of relevant experience?' },
        { id: 'q2', label: 'What is your notice period?' },
      ],
    });

    expect(result.agentPrompt).toContain('Screen for customer support.');
    expect(result.agentPrompt).toContain('Ask exactly one question at a time');
    expect(result.agentPrompt).toContain('Never bundle questions');
    expect(result.agentPrompt).toContain('1. How many years of relevant experience?');
    expect(result.agentPrompt).toContain('2. What is your notice period?');
    expect(result.agentPrompt).toContain('Do not recommend hire or reject');
    expect(result.agentPrompt).toContain('voicemail');
    expect(result.builtInTools.endCall).toEqual({
      name: 'end_call',
      params: { systemToolType: 'end_call' },
    });
    expect(result.builtInTools.voicemailDetection.params.voicemailMessage).toMatch(
      /call us back/i,
    );
    expect(result.builtInTools.transferToNumber).toBeUndefined();
    expect(result.firstMessage).toMatch(/Hi, this is the hiring agent/);
    expect(result.firstMessage).not.toMatch(/Alex/);
    expect(result.language).toBe('en');
    expect(result.dataCollection).toEqual({
      how_many_years_of_relevant_experience: {
        type: 'string',
        description: expect.stringContaining('How many years of relevant experience?'),
      },
      what_is_your_notice_period: {
        type: 'string',
        description: expect.stringContaining('What is your notice period?'),
      },
    });
  });

  it('wires transfer phones into built-in transfer tool', () => {
    const result = buildVoiceProvisionConfig({
      agentPurpose: 'Screen candidates.',
      agentType: 'hiring',
      transferPhones: ['9876543210', '+919876543210'],
    });
    expect(result.agentPrompt).toContain('transfer');
    expect(result.builtInTools.transferToNumber?.params.transfers).toEqual([
      {
        transferDestination: { type: 'phone', phoneNumber: '+919876543210' },
        condition: expect.stringContaining('human recruiter'),
      },
    ]);
  });

  it('introduces as hiring agent from organization name, not agent display name', () => {
    const result = buildVoiceProvisionConfig({
      agentPurpose: 'Screen candidates.',
      agentType: 'hiring',
      displayName: 'ScreenBot-42',
      organizationName: 'Acme Logistics',
    });
    expect(result.firstMessage).toBe(
      'Hi, this is the hiring agent from Acme Logistics calling about a role. Do you have a couple of minutes for a quick chat?',
    );
    expect(result.firstMessage).not.toContain('ScreenBot-42');
    expect(result.agentPrompt).toContain(
      'Introduce yourself only as the hiring agent from Acme Logistics',
    );
    expect(result.agentPrompt).not.toContain('ScreenBot-42');
    expect(result.builtInTools.voicemailDetection.params.voicemailMessage).toContain(
      'from Acme Logistics',
    );
  });
});
