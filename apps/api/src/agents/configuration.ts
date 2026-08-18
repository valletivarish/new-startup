/**
 * Agent configuration — the versioned contract.
 *
 * This phase establishes the SHAPE only. No LLM, RAG, tool, or voice
 * behaviour is implemented; every section below is a slot that a later phase
 * fills in. That ordering is deliberate: the configuration contract is what
 * agent versions are immutable *about*, so it has to exist before anything
 * can be published against it.
 *
 * PROVIDER INDEPENDENCE (ADR-001, `00_PROJECT_CONTEXT` core principle):
 * nothing here names a model, vendor, voice id, or endpoint. Customers
 * configure *capabilities* — intelligence tier, voice tier, language — and
 * the adapter layer resolves those to a provider at run time. A configuration
 * that mentioned `gpt-4` or `elevenlabs` would leak infrastructure into the
 * business model and make the provider un-swappable, which is the one thing
 * the architecture exists to prevent.
 */

import { z } from 'zod';

/** Business capability tiers — never provider or model names. */
export const IntelligenceTier = z.enum(['standard', 'advanced', 'premium']);
export const VoiceTier = z.enum(['standard', 'premium']);

const Identity = z.object({
  /** How the agent introduces itself. */
  displayName: z.string().trim().min(1).max(80),
  persona: z.string().trim().max(2000).default(''),
  /** BCP-47 tags. Indian-language support is a Phase 5 provider concern. */
  languages: z.array(z.string().trim().min(2).max(35)).min(1).default(['en-IN']),
  primaryLanguage: z.string().trim().min(2).max(35).default('en-IN'),
});

const Conversation = z.object({
  greeting: z.string().trim().max(1000).default(''),
  /** Prompt text is authored by the platform, not pasted by users (UX §18.10). */
  instructions: z.string().trim().max(20_000).default(''),
  maxTurns: z.number().int().min(1).max(500).default(50),
  /** Silence before the agent treats a turn as finished. */
  turnTimeoutSeconds: z.number().int().min(1).max(300).default(30),
  /** Whole-session ceiling — a hard stop, not a suggestion. */
  maxSessionSeconds: z.number().int().min(30).max(7200).default(1800),
});

const Capabilities = z.object({
  intelligenceTier: IntelligenceTier.default('standard'),
  voiceTier: VoiceTier.default('standard'),
});

/** Knowledge is referenced by id; retrieval itself arrives in Phase 3. */
const KnowledgeReference = z.object({
  knowledgeSourceId: z.string().uuid(),
  label: z.string().trim().max(120).default(''),
});

/**
 * A deterministic rule. Phase 2 evaluates a deliberately small predicate set
 * so the runtime is testable without a model; richer conditions arrive with
 * the intelligence layer.
 */
const Rule = z.object({
  id: z.string().trim().min(1).max(64),
  when: z.enum(['always', 'on_session_start', 'on_message_contains']),
  /** Match text for `on_message_contains`. */
  value: z.string().trim().max(500).default(''),
  then: z.enum(['reply', 'escalate', 'end_session']),
  /** Reply text for the `reply` action. */
  reply: z.string().trim().max(2000).default(''),
});

const Guardrails = z.object({
  /** Subjects the agent must refuse. Enforced in the runtime, not the prompt. */
  forbiddenTopics: z.array(z.string().trim().max(120)).max(50).default([]),
  /**
   * When knowledge retrieval returns nothing, say so rather than invent
   * organization facts (`02_BRD` §7). Default on, deliberately.
   */
  refuseWhenNoKnowledge: z.boolean().default(true),
  maxToolCallsPerTurn: z.number().int().min(0).max(20).default(3),
});

/** Tools are referenced by name; the registry and execution arrive later. */
const ToolReference = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
});

const Escalation = z.object({
  enabled: z.boolean().default(false),
  trigger: z.enum(['never', 'on_request', 'on_failure', 'on_forbidden_topic'])
    .default('on_request'),
  /** Business-level target, resolved by the notification layer. */
  notifyEmails: z.array(z.string().email()).max(20).default([]),
});

const FollowUp = z.object({
  enabled: z.boolean().default(false),
  maxAttempts: z.number().int().min(0).max(10).default(0),
  delayMinutes: z.number().int().min(1).max(20_160).default(60),
});

/** Structured evaluation criteria. Scoring itself is a later phase. */
const Evaluation = z.object({
  enabled: z.boolean().default(false),
  criteria: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        label: z.string().trim().min(1).max(120),
        required: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
});

/**
 * The full versioned configuration.
 *
 * `.strict()` throughout: an unknown key is rejected rather than silently
 * dropped, so a typo in a published version fails loudly instead of
 * disabling a guardrail nobody notices.
 */
export const AgentConfiguration = z
  .object({
    identity: Identity,
    purpose: z.string().trim().min(1).max(2000),
    conversation: Conversation.prefault({}),
    capabilities: Capabilities.prefault({}),
    knowledge: z.array(KnowledgeReference).max(100).default([]),
    rules: z.array(Rule).max(100).default([]),
    guardrails: Guardrails.prefault({}),
    tools: z.array(ToolReference).max(50).default([]),
    escalation: Escalation.prefault({}),
    followUp: FollowUp.prefault({}),
    evaluation: Evaluation.prefault({}),
  })
  .strict();

export type AgentConfiguration = z.infer<typeof AgentConfiguration>;
export type AgentRule = z.infer<typeof Rule>;

/** A minimal valid configuration, used as the starting point for a new agent. */
export function defaultConfiguration(
  name: string,
  purpose: string,
): AgentConfiguration {
  return AgentConfiguration.parse({
    identity: { displayName: name },
    purpose,
  });
}
