import { HIRING_USE_CASE } from './use-case-definitions';

// The one place the product name lives. It is a placeholder until the founder names the product.
export const BRAND = {
  name: 'Voice platform',
  tagline: 'AI agents that make business phone calls. Made in India.',
} as const;

// The live module's name and state come from its use-case definition (spec §9); the rest are roadmap.
export const MODULES = [
  {
    id: HIRING_USE_CASE.id,
    name: HIRING_USE_CASE.moduleName,
    live: HIRING_USE_CASE.live,
    summary:
      'Phones job candidates and asks the questions for your job. You get the recording, transcript and answers.',
  },
  {
    id: 'support',
    name: 'CustomerVoice',
    live: false,
    summary: 'Answers support calls from your help articles.',
  },
  {
    id: 'sales',
    name: 'SalesVoice',
    live: false,
    summary: 'Qualifies new leads and books the next step.',
  },
  {
    id: 'booking',
    // A reception desk's work: confirming, rescheduling and reminding. Named for the team, like HRVoice and SalesVoice.
    name: 'ReceptionVoice',
    live: false,
    summary: 'Confirms, reschedules and reminds people about appointments.',
  },
] as const;
