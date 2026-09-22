export const AGENT_TYPES = [
  'hiring', 'support', 'sales', 'appointments', 'reminders', 'custom',
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type WizardField = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'string_list' | 'phone_list';
  required: boolean;
};

export type PackDefinition = {
  id: AgentType;
  label: string;
  description: string;
  wizardFields: WizardField[];
  /** Slice merged into new agent configuration defaults */
  defaultConfigSlice: Record<string, unknown>;
  /**
   * Optional legacy hint list. Hiring create no longer surfaces must-ask —
   * questions belong on each Job.
   */
  suggestedMustAskQuestions?: readonly string[];
};
