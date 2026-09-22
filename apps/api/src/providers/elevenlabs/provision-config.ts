/**
 * Maps hiring evaluation criteria (must-ask questions) into ElevenLabs
 * provision fields: prompt instructions + post-call data_collection keys +
 * built-in tools (voicemail, transfer, end call).
 *
 * Without data_collection on the provider agent, reconcile stores
 * structuredAnswers as null even when the candidate answered on the call.
 */

import { toE164Phone } from './phone-e164.js';

export interface EvaluationCriterion {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
}

/** Matches ElevenLabs SystemToolConfigInput (name + params.systemToolType). */
export type BuiltInToolsConfig = Readonly<{
  endCall: {
    name: string;
    params: { systemToolType: 'end_call' };
  };
  voicemailDetection: {
    name: string;
    params: {
      systemToolType: 'voicemail_detection';
      voicemailMessage: string;
    };
  };
  transferToNumber?: {
    name: string;
    params: {
      systemToolType: 'transfer_to_number';
      transfers: ReadonlyArray<{
        transferDestination: { type: 'phone'; phoneNumber: string };
        condition: string;
      }>;
    };
  };
}>;

export interface VoiceProvisionConfig {
  /** Full system prompt sent to the provider (purpose + must-ask + no hire advice). */
  readonly agentPrompt: string;
  /**
   * ElevenLabs platform_settings.data_collection map.
   * Keys are stable criterion ids (e.g. q1); values are string extractors.
   */
  readonly dataCollection: Readonly<
    Record<string, { type: 'string'; description: string }>
  > | null;
  /** System tools for phone screens: end call, voicemail, optional human transfer. */
  readonly builtInTools: BuiltInToolsConfig;
  /** Opening line spoken on connect. */
  readonly firstMessage: string;
  /** Provider language code (e.g. en). */
  readonly language: string;
}

/** Sanitize criterion id into a safe data-collection key. */
export function dataCollectionKey(id: string): string {
  const cleaned = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || 'answer';
}

function providerLanguage(primaryLanguage?: string): string {
  const tag = (primaryLanguage ?? 'en-IN').trim().toLowerCase();
  if (tag.startsWith('hi')) return 'hi';
  if (tag.startsWith('te')) return 'te';
  if (tag.startsWith('ta')) return 'ta';
  return 'en';
}

/**
 * Build the provider prompt and optional data-collection schema from
 * the agent's purpose and evaluation criteria (must-ask questions).
 */
export function buildVoiceProvisionConfig(input: {
  agentPurpose: string;
  criteria?: readonly EvaluationCriterion[];
  agentType?: string;
  /** Human transfer numbers from escalation.transferPhones (any format; normalized to E.164). */
  transferPhones?: readonly string[];
  /**
   * @deprecated Prefer organizationName for hiring intros. Kept for non-hiring
   * fallbacks only; never used as the spoken hiring identity.
   */
  displayName?: string;
  /** Company name from registration — how the hiring agent introduces itself. */
  organizationName?: string;
  greeting?: string;
  primaryLanguage?: string;
}): VoiceProvisionConfig {
  const purpose = input.agentPurpose.trim();
  const criteria = (input.criteria ?? []).filter((c) => c.label.trim().length > 0);
  const orgName = (input.organizationName ?? '').trim();
  const isHiring = input.agentType === 'hiring' || criteria.length > 0;

  const dataCollection: Record<string, { type: 'string'; description: string }> = {};
  for (const c of criteria) {
    // Prefer a slug of the question so desk UI shows readable answer keys.
    const key = dataCollectionKey(c.label) || dataCollectionKey(c.id);
    // Keep first occurrence if ids collide after sanitizing.
    if (dataCollection[key]) continue;
    dataCollection[key] = {
      type: 'string',
      description:
        `Extract the candidate's clear answer to: "${c.label.trim()}". ` +
        'If they did not answer, return an empty string.',
    };
  }

  const lines: string[] = [purpose];

  if (isHiring) {
    lines.push('');
    if (orgName) {
      lines.push(
        `You are the hiring agent for ${orgName}. Introduce yourself only as the hiring agent from ${orgName}. Never use a personal name, nickname, or the agent record name.`,
      );
    } else {
      lines.push(
        'You are the hiring agent for this company. Introduce yourself only as the hiring agent from the company. Never use a personal name, nickname, or the agent record name.',
      );
    }
  }

  if (criteria.length > 0) {
    lines.push('');
    lines.push(
      'Ask exactly one question at a time from this list. Wait for a clear spoken answer before asking the next. Never bundle questions, never read the full list at once, and do not skip ahead:',
    );
    criteria.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.label.trim()}`);
    });
    lines.push(
      'After the last answer, thank them briefly and end the call. Do not invent extra questions.',
    );
  }

  if (isHiring) {
    lines.push('');
    lines.push(
      'Collect the candidate\'s answers only. Do not recommend hire or reject, and do not score or rank the candidate.',
    );
  }

  const transferE164 = [...new Set(
    (input.transferPhones ?? [])
      .map((p) => toE164Phone(p))
      .filter((p): p is string => Boolean(p)),
  )].slice(0, 5);

  if (transferE164.length > 0) {
    lines.push('');
    lines.push(
      'If the candidate clearly asks to speak with a human recruiter, use the transfer tool. Do not transfer for routine screening questions.',
    );
  }

  lines.push('');
  lines.push(
    'If you reach voicemail or an answering machine, leave one short callback message and end the call. Do not keep asking if anyone is there.',
  );

  const voicemailMessage = orgName
    ? `Hello, this is a brief screening call from ${orgName} about an open role. Please call us back when you are free. Thank you.`
    : 'Hello, this is a brief screening call about the open role. Please call us back when you are free. Thank you.';

  const builtInTools: {
    endCall: BuiltInToolsConfig['endCall'];
    voicemailDetection: BuiltInToolsConfig['voicemailDetection'];
    transferToNumber?: BuiltInToolsConfig['transferToNumber'];
  } = {
    endCall: {
      name: 'end_call',
      params: { systemToolType: 'end_call' },
    },
    voicemailDetection: {
      name: 'voicemail_detection',
      params: {
        systemToolType: 'voicemail_detection',
        voicemailMessage,
      },
    },
  };

  if (transferE164.length > 0) {
    builtInTools.transferToNumber = {
      name: 'transfer_to_number',
      params: {
        systemToolType: 'transfer_to_number',
        transfers: transferE164.map((phoneNumber) => ({
          transferDestination: { type: 'phone' as const, phoneNumber },
          condition:
            'The candidate explicitly asks to speak with a human recruiter or hiring manager.',
        })),
      },
    };
  }

  const greeting = (input.greeting ?? '').trim();
  const defaultFirstMessage = orgName
    ? `Hi, this is the hiring agent from ${orgName} calling about a role. Do you have a couple of minutes for a quick chat?`
    : 'Hi, this is the hiring agent calling about a role. Do you have a couple of minutes for a quick chat?';
  const firstMessage = greeting || defaultFirstMessage;

  return {
    agentPrompt: lines.join('\n').trim(),
    dataCollection: Object.keys(dataCollection).length > 0 ? dataCollection : null,
    builtInTools,
    firstMessage,
    language: providerLanguage(input.primaryLanguage),
  };
}
