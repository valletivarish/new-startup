import type { PackDefinition } from './types.js';

export const hiringPack: PackDefinition = {
  id: 'hiring',
  label: 'Hiring screen',
  description: 'Screen candidates against a job description. Collects answers; never recommends hire or reject.',
  wizardFields: [
    { key: 'purpose', label: 'What should this agent do?', kind: 'textarea', required: true },
    { key: 'transferPhones', label: 'Transfer to a human (phone numbers)', kind: 'phone_list', required: false },
  ],
  // Suggestions live on Job screening setup — not agent create.
  suggestedMustAskQuestions: undefined,
  defaultConfigSlice: {
    agentType: 'hiring',
    guardrails: { refuseWhenNoKnowledge: true },
    escalation: { enabled: true, trigger: 'on_request' },
  },
};
