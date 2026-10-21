/**
 * Maps hiring evaluation criteria (must-ask questions) into ElevenLabs
 * provision fields: prompt instructions + post-call data_collection keys +
 * built-in tools (voicemail, transfer, end call).
 *
 * Without data_collection on the provider agent, reconcile stores
 * structuredAnswers as null even when the candidate answered on the call.
 */

import { toE164Phone } from './phone-e164.js';
import { requirementsPromptBlock, type JobRequirements } from '../../hiring/requirements.js';

/** Never asked, and steered away from if the candidate raises them. */
export const OFF_LIMITS_TOPICS = ['age', 'religion', 'caste', 'marital status', 'family plans', 'health'] as const;

/** How a recruiter screens beyond the must-ask list (spec 2026-10-21, goal 2). */
function recruiterRules(requirements: JobRequirements | null, hasCriteria: boolean): string[] {
  const days = requirements?.replyWithinWorkingDays ?? 3;
  const block = requirementsPromptBlock(requirements);
  return [
    ...(block ? [block, ''] : []),
    `${hasCriteria ? 'Along with the questions above, also' : 'Also'} cover these standard screening topics, one at a time, unless the candidate already answered them: why they are looking for a change; their notice period and whether it is negotiable; their current and expected CTC; any offers in hand or other interviews; whether the work mode and location suit them.`,
    'Follow-ups: ask at most one follow-up per topic, then move on.',
    '- If the expected CTC is more than about 30% above the current CTC, or above the budget for this role, ask what is behind the number and whether there is flexibility (for example: "That\'s a good jump from thirteen. What\'s behind the eighteen?").',
    '- If an answer falls outside what the role needs, state the requirement gently and ask about flexibility (for example: "The range for this role is around 5 lakh. Is there flexibility?"). Do not argue or negotiate.',
    '- If an answer is vague, ask once more in other words. If they say they don\'t know, accept it and move on.',
    `Never ask about ${OFF_LIMITS_TOPICS.join(', ')}. If the candidate brings any of these up, do not ask more about it, say politely that it is not needed for this screen, and steer back to the role.`,
    'If something the role clearly needs does not fit, finish the essential questions briefly and close politely. Never tell the candidate they are rejected, not selected, or do not meet the requirements, and never hint at the outcome.',
    `Close with clear next steps: thank them and say the hiring team will review and get back to them within ${days} working day${days === 1 ? '' : 's'}.`,
  ];
}

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
  /**
   * Company-wide facts (policies, about the company). Injected into the
   * system prompt on every screen. Not job-specific questions.
   */
  companyFacts?: string;
  /** What HR says the role needs (jobs.requirements); null = none set. */
  requirements?: JobRequirements | null;
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
    lines.push(
      'Talk like a friendly recruiter on the phone: short, natural sentences in plain words. Answer the candidate\'s questions in your own words. Never mention where an answer comes from: do not say "the job description says", "according to our documents" or "the knowledge base".',
    );
  }

  if (criteria.length > 0) {
    lines.push('');
    lines.push(
      'Ask exactly one question at a time from this list, in order. Wait for their answer before asking the next. If they would rather not answer, or seem unwilling, accept it politely and move on; never press or ask that question again. If you did not hear their answer, say so and ask again (for example: "Sorry, I didn\'t get that. Could you tell me once more?"). If an answer is vague or does not answer the question, ask the same question once more in simpler words, the way a person would. Keep the same meaning; do not suggest an answer or give options. If it is still unclear, thank them and move to the next question. If they already answered a later question, do not ask it again. If they ask something the role details and company facts do not cover, do not guess; say you\'ll check with the hiring team. If they say it is not a good time to talk, say that is fine and the team can call at a better time, then end the call. Never bundle questions and never read the full list at once:',
    );
    criteria.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.label.trim()}`);
    });
    lines.push(
      'Do not invent questions beyond this list and the standard screening topics below.',
    );
  }

  if (isHiring) {
    lines.push('');
    lines.push(...recruiterRules(input.requirements ?? null, criteria.length > 0));
  }

  const companyFacts = (input.companyFacts ?? '').trim();
  if (companyFacts) {
    lines.push('');
    lines.push(
      'Company facts below are true for every role at this company. Use them when the candidate asks about the company, workplace, or shared policies.',
    );
    lines.push(
      'Do not treat company facts as screening questions. Job-specific items such as notice period, pay for this role, or this job\'s requirements come from the role, not from this section.',
    );
    lines.push('');
    lines.push(companyFacts.slice(0, 12_000));
  }

  if (isHiring) {
    lines.push('');
    lines.push(
      'Collect the candidate\'s answers only. Do not recommend hire or reject, and do not score or rank the candidate. The hiring team decides.',
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
