/**
 * Sessions and the event stream.
 *
 * Two guarantees this file exists to provide, both enforced by the database
 * rather than by application care:
 *
 *   ORDERING — every event carries a per-session `sequence`, allocated by
 *   incrementing a counter on the session row under a row lock. Concurrent
 *   appends serialise behind that lock, and a unique index on
 *   (session_id, sequence) is the backstop. Network delivery order is never
 *   assumed; the server assigns order.
 *
 *   IDEMPOTENCY — an inbound event may carry a client key. A retry with the
 *   same key returns the ORIGINAL event instead of appending a second one,
 *   so a duplicate delivery cannot fork the conversation.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import {
  type EventType,
  isInboundEventType,
  payloadSchemaFor,
  type EventDirection,
} from './events.js';
import { canStartSession } from './lifecycle.js';
import type { Actor } from './agents.service.js';

export interface SessionRow {
  readonly id: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly agentVersion: number;
  readonly status: string;
  readonly channel: string;
  readonly businessContext: unknown;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly endedReason: string | null;
}

export interface EventRow {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly direction: string;
  readonly payload: unknown;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface AppendResult {
  readonly event: EventRow;
  /** True when an idempotency key matched an existing event. */
  readonly deduplicated: boolean;
}

export interface SessionsService {
  create(
    actor: Actor,
    input: {
      agentId: string;
      channel?: string;
      businessContext?: unknown;
      correlationId?: string;
    },
  ): Promise<SessionRow>;
  get(actor: Actor, sessionId: string): Promise<SessionRow>;
  list(actor: Actor, agentId?: string): Promise<readonly SessionRow[]>;
  end(actor: Actor, sessionId: string, reason: string): Promise<void>;
  listEvents(actor: Actor, sessionId: string): Promise<readonly EventRow[]>;
  /** Append an event. Used by ingest and by the runtime for its own output. */
  append(
    actor: Actor,
    sessionId: string,
    event: {
      type: EventType;
      direction: EventDirection;
      payload: unknown;
      idempotencyKey?: string;
      correlationId?: string;
      causedByEventId?: string;
    },
  ): Promise<AppendResult>;
}

type SessionRecord = {
  id: string;
  agent_id: string;
  agent_version_id: string;
  agent_version: number;
  status: string;
  channel: string;
  business_context: unknown;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
};

type EventRecord = {
  id: string;
  sequence: string | number;
  type: string;
  direction: string;
  payload: unknown;
  correlation_id: string | null;
  created_at: string;
};

function toSession(r: SessionRecord): SessionRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    agentVersionId: r.agent_version_id,
    agentVersion: Number(r.agent_version),
    status: r.status,
    channel: r.channel,
    businessContext: r.business_context,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
  };
}

function toEvent(r: EventRecord): EventRow {
  return {
    id: r.id,
    sequence: Number(r.sequence),
    type: r.type,
    direction: r.direction,
    payload: r.payload,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
  };
}

/** Validates an event payload against its per-type schema. */
export function validatePayload(type: EventType, payload: unknown): unknown {
  const result = payloadSchemaFor(type).safeParse(payload ?? {});
  if (!result.success) {
    throw ApiError.validation(
      result.error.issues.map((i) => ({
        field: `payload.${i.path.join('.')}`,
        message: i.message,
      })),
    );
  }
  return result.data;
}

export function createSessionsService(
  database: Database,
  audit: AuditService,
): SessionsService {
  type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];

  async function loadSession(
    tx: Tx,
    actor: Actor,
    sessionId: string,
    forUpdate = false,
  ): Promise<SessionRecord> {
    const rows = await tx.execute<SessionRecord>(sql`
      select s.id, s.agent_id, s.agent_version_id, v.version as agent_version,
             s.status, s.channel, s.business_context,
             s.started_at::text, s.ended_at::text, s.ended_reason
      from agent_sessions s
      join agent_versions v on v.id = s.agent_version_id
      where s.id = ${sessionId} and s.organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update of s` : sql``}
    `);
    const session = rows[0];
    if (!session) throw ApiError.notFound('Session');
    return session;
  }

  /**
   * Appends one event inside an existing transaction.
   *
   * The sequence is allocated by incrementing the session counter under the
   * row lock taken here — that single UPDATE is what serialises concurrent
   * appends into a deterministic order.
   */
  async function appendInTx(
    tx: Tx,
    actor: Actor,
    sessionId: string,
    event: {
      type: EventType;
      direction: EventDirection;
      payload: unknown;
      idempotencyKey?: string;
      correlationId?: string;
      causedByEventId?: string;
    },
  ): Promise<AppendResult> {
    // Idempotency check first: a retry must return the original event, not a
    // second one with a new sequence number.
    if (event.idempotencyKey) {
      const existing = await tx.execute<EventRecord>(sql`
        select id, sequence, type, direction, payload, correlation_id, created_at::text
        from agent_events
        where session_id = ${sessionId}
          and organization_id = ${actor.organizationId}
          and idempotency_key = ${event.idempotencyKey}
      `);
      const found = existing[0];
      if (found) return { event: toEvent(found), deduplicated: true };
    }

    const seqRows = await tx.execute<{ next_sequence: string | number }>(sql`
      update agent_sessions
      set next_sequence = next_sequence + 1
      where id = ${sessionId} and organization_id = ${actor.organizationId}
      returning next_sequence - 1 as next_sequence
    `);
    const sequence = Number(seqRows[0]?.next_sequence);
    if (!Number.isFinite(sequence)) throw ApiError.notFound('Session');

    try {
      const rows = await tx.execute<EventRecord>(sql`
        insert into agent_events
          (organization_id, session_id, sequence, type, direction, payload,
           idempotency_key, correlation_id, caused_by_event_id)
        values (${actor.organizationId}, ${sessionId}, ${sequence},
                ${event.type}, ${event.direction},
                ${JSON.stringify(event.payload ?? {})}::jsonb,
                ${event.idempotencyKey ?? null}, ${event.correlationId ?? null},
                ${event.causedByEventId ?? null})
        returning id, sequence, type, direction, payload, correlation_id, created_at::text
      `);
      const inserted = rows[0];
      if (!inserted) throw new Error('event insert returned no row');
      return { event: toEvent(inserted), deduplicated: false };
    } catch (error) {
      // Lost a race on the idempotency key: another transaction inserted the
      // same logical event first. Return theirs — the retry is satisfied.
      if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
        if (event.idempotencyKey) {
          const existing = await tx.execute<EventRecord>(sql`
            select id, sequence, type, direction, payload, correlation_id, created_at::text
            from agent_events
            where session_id = ${sessionId}
              and organization_id = ${actor.organizationId}
              and idempotency_key = ${event.idempotencyKey}
          `);
          const found = existing[0];
          if (found) return { event: toEvent(found), deduplicated: true };
        }
        throw ApiError.conflict('Event conflict; retry');
      }
      throw error;
    }
  }

  return {
    async create(actor, input) {
      const session = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const agentRows = await tx.execute<{
            status: string;
            current_version_id: string | null;
          }>(sql`
            select status, current_version_id from agents
            where id = ${input.agentId} and organization_id = ${actor.organizationId}
          `);
          const agent = agentRows[0];
          if (!agent) throw ApiError.notFound('Agent');

          // Only a published agent serves sessions — a draft or paused agent
          // has no version the platform is willing to stand behind.
          if (!canStartSession(agent.status)) {
            throw ApiError.conflict(
              `Agent is ${agent.status}; only a published agent can start a session`,
            );
          }
          if (!agent.current_version_id) {
            throw ApiError.conflict('Agent has no published version');
          }

          // The version is PINNED here. Publishing a new version later must
          // not change how this conversation behaves.
          const rows = await tx.execute<{ id: string }>(sql`
            insert into agent_sessions
              (organization_id, agent_id, agent_version_id, channel,
               business_context, correlation_id, started_by_user_id)
            values (${actor.organizationId}, ${input.agentId},
                    ${agent.current_version_id}, ${input.channel ?? 'text'},
                    ${JSON.stringify(input.businessContext ?? {})}::jsonb,
                    ${input.correlationId ?? null}, ${actor.userId})
            returning id
          `);
          const id = rows[0]?.id;
          if (!id) throw new Error('session insert returned no id');

          await appendInTx(tx, actor, id, {
            type: 'SessionStarted',
            direction: 'inbound',
            payload: {},
            ...(input.correlationId !== undefined
              ? { correlationId: input.correlationId }
              : {}),
          });

          return loadSession(tx, actor, id);
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.session.started',
        resourceType: 'agent_session',
        resourceId: session.id,
        metadata: { agentId: session.agent_id, version: Number(session.agent_version) },
      });
      return toSession(session);
    },

    async get(actor, sessionId) {
      const session = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadSession(tx, actor, sessionId),
      );
      return toSession(session);
    },

    async list(actor, agentId) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<SessionRecord>(sql`
            select s.id, s.agent_id, s.agent_version_id, v.version as agent_version,
                   s.status, s.channel, s.business_context,
                   s.started_at::text, s.ended_at::text, s.ended_reason
            from agent_sessions s
            join agent_versions v on v.id = s.agent_version_id
            where s.organization_id = ${actor.organizationId}
              ${agentId ? sql`and s.agent_id = ${agentId}` : sql``}
            order by s.started_at desc
            limit 200
          `),
      );
      return rows.map(toSession);
    },

    async end(actor, sessionId, reason) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const session = await loadSession(tx, actor, sessionId, true);
          // Ending an already-ended session is a conflict, not a silent
          // no-op: concurrent enders must not both believe they won.
          if (session.status !== 'active') {
            throw ApiError.conflict('Session has already ended');
          }

          await appendInTx(tx, actor, sessionId, {
            type: 'SessionEnded',
            direction: 'inbound',
            payload: { reason },
          });

          await tx.execute(sql`
            update agent_sessions
            set status = 'ended', ended_at = now(), ended_reason = ${reason}
            where id = ${sessionId} and organization_id = ${actor.organizationId}
          `);
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.session.ended',
        resourceType: 'agent_session',
        resourceId: sessionId,
        metadata: { reason },
      });
    },

    async listEvents(actor, sessionId) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadSession(tx, actor, sessionId);
          return tx.execute<EventRecord>(sql`
            select id, sequence, type, direction, payload, correlation_id, created_at::text
            from agent_events
            where session_id = ${sessionId} and organization_id = ${actor.organizationId}
            order by sequence asc
          `);
        },
      );
      return rows.map(toEvent);
    },

    async append(actor, sessionId, event) {
      if (event.direction === 'inbound' && !isInboundEventType(event.type)) {
        throw ApiError.validation([
          {
            field: 'type',
            message: `"${event.type}" is emitted by the runtime and cannot be submitted`,
          },
        ]);
      }
      const payload = validatePayload(event.type, event.payload);

      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const session = await loadSession(tx, actor, sessionId, true);
          if (session.status !== 'active') {
            throw ApiError.conflict('Session has ended');
          }
          return appendInTx(tx, actor, sessionId, { ...event, payload });
        },
      );
    },
  };
}

export type { Actor };
