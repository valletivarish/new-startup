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
} from '@platform/providers';
import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import { AgentConfiguration, type AgentRule } from './configuration.js';
import type { EventType } from './events.js';
import type { Actor, SessionsService } from './sessions.service.js';

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

      // No rule matched. Without an intelligence layer there is nothing
      // meaningful to say, so acknowledge rather than fabricate — the same
      // discipline `refuseWhenNoKnowledge` encodes for retrieval.
      return {
        kind: 'reply',
        content:
          config.conversation.greeting ||
          'Thanks — I have recorded that. A response strategy is not configured yet.',
      };
    },
  };
}

export function createAgentRuntime(
  database: Database,
  sessions: SessionsService,
  strategy: ExecutionStrategy = createDeterministicStrategy(),
): AgentRuntime {
  return {
    strategyName: strategy.name,

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

      const decision = await strategy.decide({
        configuration: parsed.data,
        turnCount: conversation.turnCount,
        lastUserMessage: conversation.lastUserMessage,
      });

      const outbound = [requested.event];

      if (decision.kind === 'reply') {
        const generated = await sessions.append(actor, sessionId, {
          type: 'AgentResponseGenerated',
          direction: 'outbound',
          payload: { content: decision.content, strategy: strategy.name },
          causedByEventId: appended.event.id,
        });
        outbound.push(generated.event);
      } else if (decision.kind === 'escalate') {
        const escalated = await sessions.append(actor, sessionId, {
          type: 'HumanEscalationRequested',
          direction: 'outbound',
          payload: { reason: decision.reason },
          causedByEventId: appended.event.id,
        });
        outbound.push(escalated.event);
      } else {
        const ended = await sessions.append(actor, sessionId, {
          type: 'AgentResponseGenerated',
          direction: 'outbound',
          payload: {
            content: 'Ending the session.',
            strategy: strategy.name,
          },
          causedByEventId: appended.event.id,
        });
        outbound.push(ended.event);
        await sessions.end(actor, sessionId, decision.reason);
      }

      return {
        inboundEvent: appended.event,
        outboundEvents: outbound,
        deduplicated: false,
      } satisfies AgentRuntimeResult;
    },
  };
}
