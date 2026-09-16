import type { PackDefinition } from './types.js';

export const hiringPack: PackDefinition = {
  id: 'hiring',
  label: 'Hiring screen',
  description: 'Screen candidates against a job description. Reports fit; never recommends hire or reject.',
  wizardFields: [
    { key: 'purpose', label: 'What should this agent do?', kind: 'textarea', required: true },
    { key: 'documentsHint', label: 'Upload job description and related docs', kind: 'text', required: false },
    { key: 'mustAskQuestions', label: 'Questions to always ask (optional)', kind: 'string_list', required: false },
    { key: 'transferPhones', label: 'Transfer to a human (phone numbers)', kind: 'phone_list', required: false },
  ],
  defaultConfigSlice: {
    agentType: 'hiring',
    guardrails: { refuseWhenNoKnowledge: true },
    escalation: { enabled: true, trigger: 'on_request' },
  },
};
