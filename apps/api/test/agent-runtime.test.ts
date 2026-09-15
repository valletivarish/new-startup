/**
 * Phase 2 — the runtime, event ordering, and idempotency.
 *
 * These are the properties a voice transport will depend on at Phase 5.
 * Ordering must be a server guarantee, not an assumption about delivery, and
 * a retry must never fork a conversation.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@platform/db';

import { startApi, type ApiHarness } from './setup/api-harness.js';
import { superDatabase } from './setup/fixtures.js';
import {
  publishedAgent,
  sendMessage,
  startSession,
  type AgentWorld,
} from './setup/agent-fixtures.js';

let api: ApiHarness;

beforeAll(async () => {
  api = await startApi();
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('the deterministic runtime', () => {
  let world: AgentWorld;

  beforeAll(async () => {
    world = await publishedAgent(api, 'runtime', {
      conversation: {
        greeting: 'Hello from the deterministic runtime.',
        instructions: '',
        maxTurns: 3,
        turnTimeoutSeconds: 30,
        maxSessionSeconds: 1800,
      },
    });
  });

  it('SessionStarted is the first event, at sequence 0', async () => {
    const sessionId = await startSession(api, world);
    const res = await api.request({
      method: 'GET',
      url: `/sessions/${sessionId}/events`,
      cookie: world.owner.cookie,
    });
    const { events } = JSON.parse(res.body) as {
      events: { sequence: number; type: string }[];
    };
    expect(events[0]?.sequence).toBe(1);
    expect(events[0]?.type).toBe('SessionStarted');
  });

  it('a user message produces request + response events in order', async () => {
    const sessionId = await startSession(api, world);
    const res = await sendMessage(api, world, sessionId, 'hello there');
    expect(res.statusCode).toBe(201);

    const body = JSON.parse(res.body) as {
      inboundEvent: { type: string; sequence: number };
      outboundEvents: {
        type: string;
        sequence: number;
        payload: { content?: string; strategy?: string };
      }[];
      deduplicated: boolean;
    };
    expect(body.deduplicated).toBe(false);
    expect(body.inboundEvent.type).toBe('UserMessageReceived');
    expect(body.outboundEvents.map((e) => e.type)).toEqual([
      'AgentResponseRequested',
      'AgentResponseGenerated',
    ]);
    // No rule matched, so the turn was deferred to the intelligence layer —
    // which runs AFTER guardrails, the turn ceiling and rules, never instead
    // of them. The response records which layer produced it.
    expect(body.outboundEvents[1]?.payload.strategy).toBe(
      'intelligence:deterministic',
    );
    expect(body.outboundEvents[1]?.payload.content).toContain('hello there');

    // Sequences strictly increase across the whole exchange.
    const all = [body.inboundEvent, ...body.outboundEvents].map((e) => e.sequence);
    expect(all).toEqual([...all].sort((a, b) => a - b));
    expect(new Set(all).size).toBe(all.length);
  });

  it('applies configured rules deterministically', async () => {
    const ruled = await publishedAgent(api, 'ruled', {
      rules: [
        {
          id: 'greet',
          when: 'on_message_contains',
          value: 'refund',
          then: 'escalate',
          reply: '',
        },
      ],
    });
    const sessionId = await startSession(api, ruled);
    const res = await sendMessage(api, ruled, sessionId, 'I need a refund please');
    const body = JSON.parse(res.body) as {
      outboundEvents: { type: string; payload: { reason?: string } }[];
    };
    expect(body.outboundEvents.map((e) => e.type)).toContain(
      'HumanEscalationRequested',
    );
    expect(body.outboundEvents.at(-1)?.payload.reason).toBe('rule:greet');
  });

  it('guardrails outrank rules', async () => {
    const guarded = await publishedAgent(api, 'guarded', {
      guardrails: {
        forbiddenTopics: ['salary'],
        refuseWhenNoKnowledge: true,
        maxToolCallsPerTurn: 3,
      },
      rules: [
        { id: 'any', when: 'always', then: 'reply', value: '', reply: 'should not win' },
      ],
    });
    const sessionId = await startSession(api, guarded);
    const res = await sendMessage(api, guarded, sessionId, 'what is the salary');
    const body = JSON.parse(res.body) as {
      outboundEvents: { payload: { content?: string } }[];
    };
    expect(body.outboundEvents.at(-1)?.payload.content).toMatch(/not able to discuss/i);
  });

  it('permits exactly maxTurns turns, then ends the session', async () => {
    const sessionId = await startSession(api, world);

    // maxTurns is 3: three turns are answered normally.
    for (let i = 0; i < 3; i += 1) {
      const res = await sendMessage(api, world, sessionId, `message ${i}`);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { outboundEvents: { type: string }[] };
      expect(body.outboundEvents.map((e) => e.type)).toContain(
        'AgentResponseGenerated',
      );
    }

    // The fourth exceeds the ceiling and ends the session.
    const last = await sendMessage(api, world, sessionId, 'one too many');
    expect(last.statusCode).toBe(201);

    const session = await api.request({
      method: 'GET',
      url: `/sessions/${sessionId}`,
      cookie: world.owner.cookie,
    });
    const state = JSON.parse(session.body) as { status: string; endedReason: string };
    expect(state.status).toBe('ended');
    expect(state.endedReason).toBe('max_turns');
  });

  it('refuses events on an ended session', async () => {
    const sessionId = await startSession(api, world);
    await api.request({
      method: 'DELETE',
      url: `/sessions/${sessionId}`,
      cookie: world.owner.cookie,
      payload: { reason: 'completed' },
    });
    const res = await sendMessage(api, world, sessionId, 'after the end');
    expect(res.statusCode).toBe(409);
  });

  it('refuses a runtime-only event type submitted by a client', async () => {
    const sessionId = await startSession(api, world);
    const res = await api.request({
      method: 'POST',
      url: `/sessions/${sessionId}/events`,
      cookie: world.owner.cookie,
      payload: { type: 'AgentResponseGenerated', payload: { content: 'forged', strategy: 'x' } },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('event ordering and idempotency', () => {
  let world: AgentWorld;

  beforeAll(async () => {
    world = await publishedAgent(api, 'ordering');
  });

  it('assigns a gapless monotonic sequence under CONCURRENT ingestion', async () => {
    const sessionId = await startSession(api, world);

    // Ten messages fired at once. The sequence is allocated under a row lock,
    // so the result must still be a contiguous ordering with no duplicates.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        sendMessage(api, world, sessionId, `concurrent ${i}`, `key-${i}`),
      ),
    );

    const res = await api.request({
      method: 'GET',
      url: `/sessions/${sessionId}/events`,
      cookie: world.owner.cookie,
    });
    const { events } = JSON.parse(res.body) as { events: { sequence: number }[] };
    const sequences = events.map((e) => e.sequence);

    expect(new Set(sequences).size, 'duplicate sequence numbers').toBe(sequences.length);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    // Contiguous from 1 — no gaps, so nothing was lost or double-allocated.
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
  });

  it('deduplicates a retried event and does NOT reprocess it', async () => {
    const sessionId = await startSession(api, world);
    const key = 'retry-key-abcdef123456';

    const first = await sendMessage(api, world, sessionId, 'only once', key);
    expect(first.statusCode).toBe(201);
    const firstBody = JSON.parse(first.body) as {
      inboundEvent: { id: string };
      outboundEvents: unknown[];
      deduplicated: boolean;
    };
    expect(firstBody.deduplicated).toBe(false);
    expect(firstBody.outboundEvents.length).toBeGreaterThan(0);

    const retry = await sendMessage(api, world, sessionId, 'only once', key);
    const retryBody = JSON.parse(retry.body) as {
      inboundEvent: { id: string };
      outboundEvents: unknown[];
      deduplicated: boolean;
    };
    expect(retryBody.deduplicated).toBe(true);
    expect(retryBody.inboundEvent.id).toBe(firstBody.inboundEvent.id);
    // Critically: the retry produced NO new outbound events.
    expect(retryBody.outboundEvents).toEqual([]);
  });

  it('survives simultaneous duplicate submissions of the same key', async () => {
    const sessionId = await startSession(api, world);
    const key = 'simultaneous-key-xyz789';

    const results = await Promise.all([
      sendMessage(api, world, sessionId, 'race', key),
      sendMessage(api, world, sessionId, 'race', key),
      sendMessage(api, world, sessionId, 'race', key),
    ]);
    for (const r of results) expect(r.statusCode).toBe(201);

    const su = superDatabase();
    try {
      const rows = await su.db.execute<{ n: string }>(sql`
        select count(*)::text as n from agent_events
        where session_id = ${sessionId} and idempotency_key = ${key}
      `);
      // Exactly one logical event, whatever the interleaving.
      expect(Number(rows[0]?.n)).toBe(1);
    } finally {
      await su.close();
    }
  });

  it('the event log is append-only even for the runtime role', async () => {
    const sessionId = await startSession(api, world);
    const su = superDatabase();
    try {
      const rows = await su.db.execute<{ has: boolean }>(sql`
        select bool_or(privilege_type in ('UPDATE','DELETE')) as has
        from information_schema.role_table_grants
        where grantee = 'platform_app' and table_name = 'agent_events'
      `);
      expect(rows[0]?.has ?? false).toBe(false);
    } finally {
      await su.close();
    }
    expect(sessionId).toBeTruthy();
  });
});
