/**
 * The agent runtime (ADR-007).
 *
 *   Inbound event → validate → load session → load PINNED version
 *                 → load state → apply rules → decide → persist outbound
 *
 * There is no LLM in Phase 2, and that is the point. A deterministic strategy
 * lets the whole event lifecycle — ordering, idempotency, version pinning,
 * tenant isolation, escalation, termination — be built and tested BEFORE any
 * external provider exists. When the intelligence layer arrives it replaces
 * one collaborator (`ExecutionStrategy`), not the loop.
 *
 * The runtime never reaches for an agent's CURRENT configuration. It uses the
 * version the session pinned at creation. Publishing a new version mid-session
 * must not change a conversation already in flight.
 */

import type {
  AgentRuntime,
  AgentRuntimeResult,
  ConversationState,
  ExecutionStrategy,
  KnowledgeRetriever,
  RetrievalResult,
  RuntimeLimits,
  RuntimeOutcome,
} from '@platform/providers';
import { DEFAULT_RUNTIME_LIMITS } from '@platform/providers';
import type { Logger } from 'pino';
import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import { AgentConfiguration, type AgentRule } from './configuration.js';
import type { EventType } from './events.js';
import type { Actor, SessionsService } from './sessions.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { IntelligenceOrchestrator } from '../intelligence/orchestrator.js';
import type { HistoryMessage } from '../intelligence/context-builder.js';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * The Phase 2 execution strategy: deterministic and rule-driven.
 *
 * Every decision is a pure function of the pinned configuration and the
 * conversation state, so a test can assert an exact outcome. Replacing this
 * with an LLM-backed strategy at Phase 4 changes no other file.
 */
export function createDeterministicStrategy(): ExecutionStrategy {
  return {
    name: 'deterministic',
    async decide(input) {
      const config = input.configuration as AgentConfiguration;
      const rules = config.rules as readonly AgentRule[];
      const message = input.lastUserMessage ?? '';


      // Guardrails outrank rules: a forbidden topic ends the turn regardless
      // of what any rule would otherwise have matched.
      const forbidden = config.guardrails.forbiddenTopics.find(
        (topic) => topic.length > 0 && message.toLowerCase().includes(topic.toLowerCase()),
      );
      if (forbidden) {
        return config.escalation.enabled &&
          config.escalation.trigger === 'on_forbidden_topic'
          ? { kind: 'escalate', reason: `forbidden topic: ${forbidden}` }
          : {
              kind: 'reply',
              content: 'I am not able to discuss that. Let me help with something else.',
            };
      }

      // The session's turn ceiling is a hard stop, not a suggestion.
      // `turnCount` includes the message being handled, so the comparison is
      // strict: maxTurns = 3 permits three replies, and the fourth turn ends
      // the session.
      if (input.turnCount > config.conversation.maxTurns) {
        return { kind: 'end', reason: 'max_turns' };
      }

      for (const rule of rules) {
        const matches =
          rule.when === 'always' ||
          (rule.when === 'on_session_start' && input.turnCount === 0) ||
          (rule.when === 'on_message_contains' &&
            rule.value.length > 0 &&
            message.toLowerCase().includes(rule.value.toLowerCase()));

        if (!matches) continue;
        if (rule.then === 'escalate') {
          return { kind: 'escalate', reason: `rule:${rule.id}` };
        }
        if (rule.then === 'end_session') {
          return { kind: 'end', reason: 'agent_ended' };
        }
        return { kind: 'reply', content: rule.reply || config.conversation.greeting };
      }

      // No rule matched. NOW consider knowledge.
      //
      // `input.knowledge` is present only when the agent actually has
      // knowledge sources attached — an agent configured purely with rules
      // has nothing to be missing, and must not refuse on that basis. That
      // ordering matters: an explicit operator rule outranks a generic
      // refusal, and a forbidden topic outranks both.
      //
      // Only a FAILED lookup short-circuits here. "The knowledge system is
      // down" is a deterministic fallback: with the agent configured to
      // depend on approved knowledge, there is nothing safe to do but say so.
      //
      // "Nothing relevant was found" is NOT decided here. That check moved
      // into the intelligence loop, and the reason is worth recording: when
      // it lived at this point it pre-empted EVERY turn of an agent that had
      // knowledge attached — including turns that asked for a tool and turns
      // that were not knowledge questions at all. The guardrail's actual
      // purpose is to stop the agent inventing organization facts, so it now
      // applies to an ungrounded ANSWER rather than to the whole turn.
      const knowledge = input.knowledge;
      if (
        config.guardrails.refuseWhenNoKnowledge &&
        knowledge &&
        knowledge.outcome === 'failed'
      ) {
        return {
          kind: 'reply',
          content:
            'I cannot reach my knowledge sources right now, so I would rather not answer than guess. Please try again shortly.',
        };
      }

      // Nothing deterministic applies. Hand the turn to the intelligence
      // layer — which runs AFTER every check above, never instead of them.
      return { kind: 'defer' };
    },
  };
}

export interface AgentRuntimeDeps {
  readonly strategy?: ExecutionStrategy;
  readonly retriever?: KnowledgeRetriever;
  /** When absent, a deferred turn falls back to a plain acknowledgement. */
  readonly intelligence?: IntelligenceOrchestrator;
  readonly tools?: ToolRegistry;
  /** Platform safety ceilings. Environment-tunable; never widened by config. */
  readonly limits?: RuntimeLimits;
  readonly audit?: AuditService;
  readonly logger?: Logger;
}

export function createAgentRuntime(
  database: Database,
  sessions: SessionsService,
  deps: AgentRuntimeDeps = {},
): AgentRuntime {
  const strategy = deps.strategy ?? createDeterministicStrategy();
  const retriever = deps.retriever;
  const intelligence = deps.intelligence;
  const toolRegistry = deps.tools;
  const limits = deps.limits ?? DEFAULT_RUNTIME_LIMITS;
  const audit = deps.audit;
  const logger = deps.logger;

  /**
   * Records an intelligence event.
   *
   * Metadata only — counts, timings, provider and model. Never the model's
   * reasoning, and never the content of a message: the event stream already
   * holds what was said, under `agents.sessions.read`, which the matrix
   * treats as sensitive. Duplicating it into the audit trail would widen who
   * can read a conversation.
   */
  const recordAudit = async (
    actor: Actor,
    eventType: string,
    sessionId: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> => {
    if (!audit) return;
    await audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType,
      resourceType: 'agent_session',
      resourceId: sessionId,
      metadata,
    });
  };

  /**
   * The permissions of the membership the agent acts on behalf of.
   *
   * Resolved HERE from the database rather than accepted from the caller.
   * A tool authorization decision must never depend on a permission set that
   * travelled through a parameter someone could shape.
   */
  async function grantedPermissionsFor(actor: Actor): Promise<ReadonlySet<string>> {
    const rows = await withTenantContext(
      database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) =>
        tx.execute<{ key: string }>(sql`
          select p.key
          from organization_memberships m
          join role_permissions rp on rp.role_id = m.role_id
          join permissions p on p.id = rp.permission_id
          where m.user_id = ${actor.userId}
            and m.organization_id = ${actor.organizationId}
            and m.status = 'active'
        `),
    );
    return new Set(rows.map((r) => r.key));
  }

  /** Prior turns, oldest first, bounded by the runtime limit. */
  async function loadHistory(
    actor: Actor,
    sessionId: string,
    beforeSequence: number,
    maxMessages: number,
  ): Promise<readonly HistoryMessage[]> {
    const rows = await withTenantContext(
      database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) =>
        tx.execute<{ type: string; content: string | null }>(sql`
          select type, payload ->> 'content' as content
          from agent_events
          where session_id = ${sessionId}
            and organization_id = ${actor.organizationId}
            and type in ('UserMessageReceived', 'AgentResponseGenerated')
            and sequence < ${beforeSequence}
          order by sequence desc
          limit ${maxMessages}
        `),
    );
    return rows
      .reverse()
      .filter((r): r is { type: string; content: string } => r.content !== null)
      .map((r) => ({
        role: r.type === 'UserMessageReceived' ? ('user' as const) : ('assistant' as const),
        content: r.content,
      }));
  }

  return {
    strategyName: intelligence
      ? `${strategy.name}+${intelligence.providerName}`
      : strategy.name,

    async process(rawActor, sessionId, inbound) {
      const actor = rawActor as Actor;

      // 1. Validate and append the inbound event. Idempotency is settled
      //    here: a retry returns the original event and is NOT reprocessed.
      const appended = await sessions.append(actor, sessionId, {
        type: inbound.type as EventType,
        direction: 'inbound',
        payload: inbound.payload,
        ...(inbound.idempotencyKey !== undefined
          ? { idempotencyKey: inbound.idempotencyKey }
          : {}),
        ...(inbound.correlationId !== undefined
          ? { correlationId: inbound.correlationId }
          : {}),
      });

      if (appended.deduplicated) {
        return {
          inboundEvent: appended.event,
          outboundEvents: [],
          deduplicated: true,
        } satisfies AgentRuntimeResult;
      }

      // Lifecycle events carry no turn to process.
      if (
        appended.event.type === 'SessionStarted' ||
        appended.event.type === 'SessionEnded'
      ) {
        return {
          inboundEvent: appended.event,
          outboundEvents: [],
          deduplicated: false,
        } satisfies AgentRuntimeResult;
      }

      // 2. Load the session and the PINNED version's configuration.
      const state = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const rows = await tx.execute<{
            configuration: unknown;
            status: string;
            turn_count: string | number;
            last_user_message: string | null;
          }>(sql`
            select v.configuration,
                   s.status,
                   (select count(*) from agent_events e
                     where e.session_id = s.id
                       and e.organization_id = ${actor.organizationId}
                       and e.type = 'UserMessageReceived') as turn_count,
                   (select e.payload ->> 'content' from agent_events e
                     where e.session_id = s.id
                       and e.organization_id = ${actor.organizationId}
                       and e.type = 'UserMessageReceived'
                     order by e.sequence desc limit 1) as last_user_message
            from agent_sessions s
            join agent_versions v on v.id = s.agent_version_id
            where s.id = ${sessionId} and s.organization_id = ${actor.organizationId}
          `);
          const found = rows[0];
          if (!found) throw ApiError.notFound('Session');
          return found;
        },
      );

      const parsed = AgentConfiguration.safeParse(state.configuration);
      if (!parsed.success) {
        // A published version whose configuration no longer parses is a
        // platform fault, not a client error — surface it as an event rather
        // than a silent nothing.
        const errorEvent = await sessions.append(actor, sessionId, {
          type: 'ErrorOccurred',
          direction: 'outbound',
          payload: {
            message: 'Pinned agent configuration is invalid',
            recoverable: false,
          },
          causedByEventId: appended.event.id,
        });
        return {
          inboundEvent: appended.event,
          outboundEvents: [errorEvent.event],
          deduplicated: false,
        } satisfies AgentRuntimeResult;
      }

      const conversation: ConversationState = {
        sessionId,
        turnCount: Number(state.turn_count),
        lastUserMessage: state.last_user_message,
      };

      // 3. A response is requested, then produced. Both are recorded: the
      //    request/response pair is what a streaming transport will later
      //    interleave audio around.
      const requested = await sessions.append(actor, sessionId, {
        type: 'AgentResponseRequested',
        direction: 'outbound',
        payload: {},
        causedByEventId: appended.event.id,
      });

      // Retrieve BEFORE deciding, so the strategy can act on what knowledge
      // is actually available. The retrieval context is built here from the
      // validated actor — the configuration cannot widen it, and neither can
      // anything the user typed.
      let retrieval: RetrievalResult | undefined;
      if (retriever && conversation.lastUserMessage) {
        // Which sources this agent is permitted to draw on. If none are
        // attached, retrieval is skipped entirely and `knowledge` stays
        // undefined — the agent has no knowledge to be missing.
        const sourceIds = await withTenantContext(
          database.db,
          { organizationId: actor.organizationId, userId: actor.userId },
          async (tx) => {
            const rows = await tx.execute<{ source_id: string }>(sql`
              select a.source_id
              from agent_knowledge_sources a
              join agent_sessions s on s.agent_id = a.agent_id
              where s.id = ${sessionId}
                and a.organization_id = ${actor.organizationId}
            `);
            return rows.map((r) => r.source_id);
          },
        );

        if (sourceIds.length > 0) {
          retrieval = await retriever.retrieve(
            conversation.lastUserMessage,
            {
              organizationId: actor.organizationId,
              actorUserId: actor.userId,
              // Scoped to the agent's OWN sources — an agent cannot reach
              // organization knowledge it was not given.
              sourceIds,
            },
            { topK: 5 },
          );
        }
      }

      const decision = await strategy.decide({
        configuration: parsed.data,
        turnCount: conversation.turnCount,
        lastUserMessage: conversation.lastUserMessage,
        ...(retrieval
          ? {
              knowledge: {
                outcome: retrieval.outcome,
                chunkCount: retrieval.chunks.length,
              },
            }
          : {}),
      });

      const outbound = [requested.event];
      const config = parsed.data;

      /** Append an outbound event and keep it in the stream we return. */
      const emit = async (type: EventType, payload: unknown): Promise<void> => {
        const written = await sessions.append(actor, sessionId, {
          type,
          direction: 'outbound',
          payload,
          causedByEventId: appended.event.id,
        });
        outbound.push(written.event);
      };

      /** Escalate on failure when — and only when — the agent asked for it. */
      const escalateOnFailure = async (reason: string): Promise<void> => {
        if (config.escalation.enabled && config.escalation.trigger === 'on_failure') {
          await emit('HumanEscalationRequested', { reason });
        }
      };

      if (decision.kind === 'reply') {
        await emit('AgentResponseGenerated', {
          content: decision.content,
          strategy: strategy.name,
        });
      } else if (decision.kind === 'escalate') {
        await emit('HumanEscalationRequested', { reason: decision.reason });
      } else if (decision.kind === 'end') {
        await emit('AgentResponseGenerated', {
          content: 'Ending the session.',
          strategy: strategy.name,
        });
        await sessions.end(actor, sessionId, decision.reason);
      } else if (!intelligence) {
        // Deterministic rules did not decide the turn and no intelligence
        // layer is wired. Acknowledge rather than fabricate — this is the
        // Phase 2/3 behaviour, preserved exactly.
        await emit('AgentResponseGenerated', {
          content:
            config.conversation.greeting ||
            'Thanks — I have recorded that. A response strategy is not configured yet.',
          strategy: strategy.name,
        });
      } else {
        // ---- The intelligence turn ---------------------------------------
        //
        // Reached only AFTER guardrails, the turn ceiling, operator rules and
        // the knowledge-refusal check have all declined to decide. The model
        // is the last participant consulted, never the first.
        const startedAt = Date.now();
        const strategyLabel = `intelligence:${intelligence.providerName}`;

        const [grantedPermissions, history, granted] = await Promise.all([
          grantedPermissionsFor(actor),
          loadHistory(
            actor,
            sessionId,
            appended.event.sequence,
            limits.maxHistoryMessages,
          ),
          toolRegistry
            ? toolRegistry.listForSession(actor, sessionId)
            : Promise.resolve([]),
        ]);

        const result = await intelligence.run({
          actor,
          sessionId,
          configuration: config,
          history,
          userMessage: conversation.lastUserMessage ?? '',
          ...(retrieval
            ? { knowledge: { outcome: retrieval.outcome, chunks: retrieval.chunks } }
            : {}),
          // The guardrail applies only when this agent actually HAS knowledge
          // configured — the Phase 3 regression fix, preserved.
          requireGrounding:
            config.guardrails.refuseWhenNoKnowledge && retrieval !== undefined,
          // A disabled tool is not offered at all. Authorization re-checks
          // `enabled` regardless — this only avoids inviting a denial.
          availableTools: granted.filter((tool) => tool.enabled),
          grantedPermissions,
          limits,
          emit: async (event) => {
            await emit(event.type, event.payload);
          },
        });

        // ---- Observability -----------------------------------------------
        // Latency, model, provider, token counts and retry count — the inputs
        // the future cost layer needs. No prompt text, no response content,
        // no personal data.
        const durationMs = Date.now() - startedAt;
        const tokens = result.usage.reduce(
          (sum, u) => sum + (u.totalTokens ?? 0),
          0,
        );
        const providerCalls = result.usage.length;
        const model = result.usage.at(-1)?.model ?? null;

        logger?.info(
          {
            sessionId,
            organizationId: actor.organizationId,
            outcome: result.outcome.kind,
            providerCalls,
            tokens,
            durationMs,
            model,
            provider: intelligence.providerName,
            knowledgeOutcome: retrieval?.outcome ?? 'not_configured',
            toolsOffered: granted.length,
          },
          'agent.turn.completed',
        );

        if (retrieval && retrieval.outcome === 'ok') {
          await recordAudit(actor, 'agent.knowledge.used', sessionId, {
            chunks: retrieval.chunks.length,
            outcome: retrieval.outcome,
          });
        }

        await recordIntelligenceOutcome(result.outcome, strategyLabel);

        await recordAudit(actor, 'agent.response.generated', sessionId, {
          outcome: result.outcome.kind,
          providerCalls,
          tokens,
          durationMs,
          model,
          provider: intelligence.providerName,
        });

        async function recordIntelligenceOutcome(
          outcome: RuntimeOutcome,
          label: string,
        ): Promise<void> {
          switch (outcome.kind) {
            case 'FinalResponse':
              await emit('AgentResponseGenerated', {
                content: outcome.content,
                strategy: label,
                citations: outcome.citations,
              });
              return;

            case 'Refusal':
              // A refusal IS an answer — about what the agent would not do.
              // It is recorded as a response, not as an error.
              await emit('AgentResponseGenerated', {
                content: outcome.reason,
                strategy: label,
              });
              return;

            case 'KnowledgeInsufficient':
              await emit('AgentResponseGenerated', {
                content:
                  'I do not have approved information on that, so I would rather not guess.',
                strategy: label,
              });
              return;

            case 'HumanEscalation':
              await emit('HumanEscalationRequested', { reason: outcome.reason });
              return;

            case 'ProviderFailure':
              // NOT presented as an answer. A customer told "I don't know"
              // when the truth is "the provider is down" has been misled.
              await recordAudit(actor, 'agent.provider.failed', sessionId, {
                kind: outcome.failure.kind,
                retryable: outcome.failure.retryable,
              });
              await emit('ErrorOccurred', {
                message: 'The assistant is temporarily unavailable.',
                recoverable: outcome.failure.retryable,
              });
              await escalateOnFailure(`provider_failure:${outcome.failure.kind}`);
              return;

            case 'ValidationFailure':
              await recordAudit(actor, 'agent.output.validation.failed', sessionId, {
                errors: outcome.errors.length,
              });
              await emit('ErrorOccurred', {
                message: 'The assistant produced a response that could not be used.',
                recoverable: true,
              });
              await escalateOnFailure('validation_failure');
              return;

            case 'LimitExceeded':
              await recordAudit(actor, 'agent.limit.exceeded', sessionId, {
                limit: outcome.limit,
              });
              await emit('ErrorOccurred', {
                message: `The assistant stopped after reaching a safety limit (${outcome.limit}).`,
                recoverable: false,
              });
              await escalateOnFailure(`limit_exceeded:${outcome.limit}`);
              return;

            case 'ToolRequest':
              // The loop resolves tool requests internally; one surfacing
              // here would mean the loop returned without deciding.
              await emit('ErrorOccurred', {
                message: 'The assistant could not complete this turn.',
                recoverable: true,
              });
              await escalateOnFailure('unresolved_tool_request');
              return;

            case 'RuntimeFailure':
              await emit('ErrorOccurred', {
                message: 'The assistant could not complete this turn.',
                recoverable: true,
              });
              await escalateOnFailure(`runtime_failure:${outcome.reason}`);
              return;
          }
        }
      }

      return {
        inboundEvent: appended.event,
        outboundEvents: outbound,
        deduplicated: false,
      } satisfies AgentRuntimeResult;
    },
  };
}
