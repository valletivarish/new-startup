import { hiringPack } from './hiring.js';
import type { AgentType, PackDefinition } from './types.js';

const PACKS: Record<AgentType, PackDefinition> = {
  hiring: hiringPack,
  support: { ...hiringPack, id: 'support', label: 'Customer support', description: 'Coming soon', wizardFields: hiringPack.wizardFields, defaultConfigSlice: { agentType: 'support' } },
  sales: { ...hiringPack, id: 'sales', label: 'Sales outreach', description: 'Coming soon', wizardFields: [], defaultConfigSlice: { agentType: 'sales' } },
  appointments: { ...hiringPack, id: 'appointments', label: 'Appointments', description: 'Coming soon', wizardFields: [], defaultConfigSlice: { agentType: 'appointments' } },
  reminders: { ...hiringPack, id: 'reminders', label: 'Reminders', description: 'Coming soon', wizardFields: [], defaultConfigSlice: { agentType: 'reminders' } },
  custom: { ...hiringPack, id: 'custom', label: 'Custom', description: 'General-purpose agent', wizardFields: hiringPack.wizardFields, defaultConfigSlice: { agentType: 'custom' } },
};

export function listPacks(): PackDefinition[] {
  return Object.values(PACKS);
}

export function listEnabledPacks(): PackDefinition[] {
  // Day-one launch: hiring only. Other packs stay in the registry for later unlock.
  return [getPack('hiring')];
}

export function getPack(id: AgentType): PackDefinition {
  const pack = PACKS[id];
  if (!pack) throw new Error(`Unknown pack: ${id}`);
  return pack;
}
