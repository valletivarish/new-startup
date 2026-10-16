import type { UseCaseDefinition } from '../../lib/use-case-definitions';

export interface AgentStateCopy {
  /** The state as a short heading, such as "Ready to call". */
  title: string;
  /** What the state means for calls, in one sentence. */
  line: string;
}

/**
 * What an agent's state means for its calls, in the use case's words. The StatusTag by the
 * agent's name names the state; an unknown state gets a plain line, never the raw value.
 */
export function agentStateCopy(
  status: string | null | undefined,
  labels: UseCaseDefinition['labels'],
): AgentStateCopy {
  const contacts = labels.contact.many.toLowerCase();
  const items = labels.workItem.many.toLowerCase();
  switch (status) {
    case 'published':
      return { title: 'Ready to call', line: `It calls ${contacts} for the ${items} that use it.` };
    case 'draft':
      return { title: 'Not live yet', line: 'Publish it before it can call anyone.' };
    case 'paused':
      return { title: 'Paused', line: 'It calls no one until you publish it again.' };
    case 'archived':
      return { title: 'Archived', line: 'Kept for your records. It can’t call anyone.' };
    default:
      return { title: 'State unknown', line: 'Reload the page to check it again.' };
  }
}
