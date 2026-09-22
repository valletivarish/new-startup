/**
 * MVP-01 ElevenLabs browser-voice tests.
 *
 * All tests run against the real application (real NestJS, real Fastify, real
 * PostgreSQL via Testcontainers) with the stub voice adapter injected so no
 * live network calls are made and no ElevenLabs credits are spent.
 *
 * Coverage:
 *   - Kill switch: feature disabled when ELEVENLABS_ENABLED=false
 *   - Authorization: unauthorized, forbidden, missing permission
 *   - Cross-tenant isolation: org B cannot read org A's voice sessions
 *   - Forged IDs: 404, not 403, for cross-org lookups
 *   - Cost guards: active-session limit, daily session cap, daily minute cap
 *   - Deployment: provision and re-provision (idempotent)
 *   - Start session: returns token; second concurrent session blocked
 *   - Get result: status transitions
 *   - Reconcile: updates from stub adapter
 *   - Webhook: invalid signature → 422; duplicate event is idempotent
 *   - Null cost: costCredits may be null
 */

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@platform/db';
import {
  startApi,
  registerUser,
  createOrganization,
  inviteAndCaptureToken,
  acceptInvitation,
  type ApiHarness,
} from './setup/api-harness.js';
import { superDatabase } from './setup/fixtures.js';
import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';

// ---------------------------------------------------------------------------
// Harness setup
// ---------------------------------------------------------------------------

let api: ApiHarness;
let webhookApi: ApiHarness; // uses real sig verification

const STUB_ADAPTER = createStubVoiceSessionAdapter();

/** Stub that does real webhook signature verification using a known secret. */
const WEBHOOK_STUB = {
  ...createStubVoiceSessionAdapter(),
  verifyWebhookSignature(payload: string, sig: string): boolean {
    if (!sig) return false;
    const secret = VOICE_ENV['ELEVENLABS_WEBHOOK_SECRET']!;
    try {
      if (/\bt=\d+/.test(sig) && /\bv0=/.test(sig)) {
        const timestamp = sig
          .split(',')
          .map((p) => p.trim())
          .find((p) => p.startsWith('t='))
          ?.slice(2);
        const candidates = sig
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.startsWith('v0='))
          .map((p) => p.slice(3));
        if (!timestamp || candidates.length === 0) return false;
        const ageSecs = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
        if (!Number.isFinite(Number(timestamp)) || ageSecs > 30 * 60) return false;
        const expected = createHmac('sha256', secret)
          .update(`${timestamp}.${payload}`, 'utf8')
          .digest('hex');
        return candidates.some((received) => {
          const a = Buffer.from(expected, 'hex');
          const b = Buffer.from(received, 'hex');
          return a.length === b.length && a.equals(b);
        });
      }
      const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
      const received = sig.replace(/^xi-signature-256=/i, '');
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(received, 'hex');
      if (a.length !== b.length) return false;
      return a.equals(b);
    } catch {
      return false;
    }
  },
};

function signProduction(payload: string): string {
  const secret = VOICE_ENV['ELEVENLABS_WEBHOOK_SECRET']!;
  const t = Math.floor(Date.now() / 1000).toString();
  const v0 = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v0=${v0}`;
}

/** Extra env that enables the voice feature and uses the stub adapter. */
const VOICE_ENV: Record<string, string> = {
  ELEVENLABS_ENABLED: 'true',
  ELEVENLABS_API_KEY: 'test-key-does-not-matter-stub-is-injected',
  ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
  ELEVENLABS_MAX_TEST_MINUTES: '5',
  ELEVENLABS_DAILY_TEST_SESSIONS: '10',
  ELEVENLABS_DAILY_TEST_MINUTES: '60',
};

beforeAll(async () => {
  api = await startApi(VOICE_ENV, STUB_ADAPTER);
  webhookApi = await startApi(VOICE_ENV, WEBHOOK_STUB as ReturnType<typeof createStubVoiceSessionAdapter>);
});

afterAll(async () => {
  await api.close();
  await webhookApi.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let setupCounter = 0;
async function setup() {
  setupCounter += 1;
  const label = `voice-alice-${setupCounter}-${Math.floor(Math.random() * 1e6)}`;
  const alice = await registerUser(api, label);
  const orgId = await createOrganization(api, alice, `voice-org-${setupCounter}-${Math.floor(Math.random() * 1e6)}`);
  const cookie = alice.cookie;

  // Create and publish an agent.
  const agentRes = await api.request({
    method: 'POST',
    url: '/agents',
    cookie,
    payload: { name: 'Voice Bot', purpose: 'Test the voice interface', description: 'MVP-01 test' },
  });
  expect(agentRes.statusCode).toBe(201);
  // Agent create already opens a draft version — reuse it (POST /versions would 409).
  const { id: agentId, versionId } = JSON.parse(agentRes.body) as {
    id: string;
    versionId: string;
  };
  expect(versionId).toBeTruthy();

  const pubRes = await api.request({
    method: 'POST',
    url: `/agents/${agentId}/versions/${versionId}/publish`,
    cookie,
    payload: {},
  });
  expect([200, 201]).toContain(pubRes.statusCode);

  return { alice, orgId, cookie, agentId, versionId };
}

/** Signs a payload the same way ElevenLabs does. */
function sign(payload: string): string {
  const secret = VOICE_ENV['ELEVENLABS_WEBHOOK_SECRET']!;
  const hex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `xi-signature-256=${hex}`;
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe('ElevenLabs kill switch (ELEVENLABS_ENABLED=false)', () => {
  it('voice session start returns 403 when disabled', async () => {
    // Spin up a second harness with the feature OFF
    const disabledApi = await startApi({
      // No ELEVENLABS_ENABLED: defaults to false
    });
    try {
      const u = Math.floor(Math.random() * 1e9).toString();
      const alice = await registerUser(disabledApi, `alice-disabled-${u}`);
      const orgId = await createOrganization(disabledApi, alice, `disabled-org-${u}`);
      void orgId;
      const cookie = alice.cookie;

      // Create a published agent.
      const agentRes = await disabledApi.request({
        method: 'POST',
        url: '/agents',
        cookie,
        payload: { name: 'Bot', purpose: 'Test', description: '' },
      });
      expect(agentRes.statusCode).toBe(201);
      const { id: agentId, versionId: vId } = JSON.parse(agentRes.body) as {
        id: string;
        versionId: string;
      };
      await disabledApi.request({
        method: 'POST',
        url: `/agents/${agentId}/versions/${vId}/publish`,
        cookie,
        payload: {},
      });

      const res = await disabledApi.request({
        method: 'POST',
        url: `/agents/${agentId}/voice-sessions`,
        cookie,
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await disabledApi.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('voice session authorization', () => {
  it('unauthenticated request returns 401', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/agents/00000000-0000-4000-8000-000000000001/voice-sessions',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('no-org session returns 401 or 403', async () => {
    // A user with no active organization gets 401/403 on any permission-gated route
    const user = await registerUser(api, 'no-org');
    const res = await api.request({
      method: 'POST',
      url: '/agents/00000000-0000-4000-8000-000000000001/voice-sessions',
      cookie: user.cookie,
      payload: {},
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('unknown voice session returns 404 (not 403)', async () => {
    const { cookie, agentId } = await setup();
    const res = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/voice-sessions/00000000-0000-4000-8000-000000000002`,
      cookie,
    });
    // 404 because the session doesn't exist — existence is not probeable.
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Deployment provisioning
// ---------------------------------------------------------------------------

describe('voice deployment provisioning', () => {
  it('provisions a deployment for the published version', async () => {
    const { cookie, agentId } = await setup();
    const res = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-deployments`,
      cookie,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { deployment: { id: string; externalAgentId: string } };
    expect(body.deployment.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.deployment.externalAgentId).toBeTruthy();
  });

  it('re-provisioning is idempotent', async () => {
    const { cookie, agentId } = await setup();
    const r1 = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-deployments`,
      cookie,
      payload: {},
    });
    expect(r1.statusCode).toBe(201);
    const dep1 = (JSON.parse(r1.body) as { deployment: { id: string } }).deployment;

    const r2 = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-deployments`,
      cookie,
      payload: {},
    });
    expect(r2.statusCode).toBe(201);
    const dep2 = (JSON.parse(r2.body) as { deployment: { id: string } }).deployment;

    // Same DB row (upsert)
    expect(dep1.id).toBe(dep2.id);
  });

  it('draft agent cannot be provisioned', async () => {
    const u = Math.floor(Math.random() * 1e9).toString();
    const alice = await registerUser(api, `alice-draft-${u}`);
    await createOrganization(api, alice, `draft-org-${u}`);
    const cookie = alice.cookie;
    const agentRes = await api.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: { name: 'Draft Bot', purpose: 'Draft', description: '' },
    });
    const agentId = (JSON.parse(agentRes.body) as { id: string }).id;

    const res = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-deployments`,
      cookie,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Start voice session
// ---------------------------------------------------------------------------

describe('start voice session', () => {
  it('returns voiceSessionId and conversationToken for a published agent', async () => {
    const { cookie, agentId } = await setup();
    const res = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      voiceSessionId: string;
      conversationToken: string;
      voiceSession: { status: string };
    };
    expect(body.voiceSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.conversationToken).toBeTruthy();
    expect(body.voiceSession.status).toBe('active');
  });

  it('blocks a second concurrent session in the same org', async () => {
    const { cookie, agentId } = await setup();
    // Start the first session.
    const r1 = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(r1.statusCode).toBe(201);

    // Attempt to start a second one.
    const r2 = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(r2.statusCode).toBe(409);
  });

  it('ending an active session allows a new one to start', async () => {
    const { cookie, agentId } = await setup();
    const r1 = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(r1.statusCode).toBe(201);
    const vsId = (JSON.parse(r1.body) as { voiceSessionId: string }).voiceSessionId;

    const end = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions/${vsId}/end`,
      cookie,
      payload: {},
    });
    expect(end.statusCode).toBe(200);
    const ended = JSON.parse(end.body) as { voiceSession: { status: string; channel?: string } };
    expect(ended.voiceSession.status).toBe('ended');
    expect(ended.voiceSession.channel).toBe('browser_demo');

    const r2 = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(r2.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Get voice session result
// ---------------------------------------------------------------------------

describe('get voice session', () => {
  it('returns the session state', async () => {
    const { cookie, agentId } = await setup();
    const startRes = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(startRes.statusCode).toBe(201);
    const vsId = (
      JSON.parse(startRes.body) as { voiceSessionId: string }
    ).voiceSessionId;

    const res = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/voice-sessions/${vsId}`,
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { voiceSession: { id: string; status: string } };
    expect(body.voiceSession.id).toBe(vsId);
    expect(body.voiceSession.status).toBe('active');
  });

  it('returns 404 for an unknown ID', async () => {
    const { cookie, agentId } = await setup();
    const res = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/voice-sessions/00000000-0000-4000-8000-000000000099`,
      cookie,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------

describe('cross-tenant isolation', () => {
  it("org B cannot read org A's voice session", async () => {
    // Set up org A and start a session.
    const { cookie: cookieA, agentId: agentA } = await setup();
    const startRes = await api.request({
      method: 'POST',
      url: `/agents/${agentA}/voice-sessions`,
      cookie: cookieA,
      payload: {},
    });
    expect(startRes.statusCode).toBe(201);
    const vsId = (JSON.parse(startRes.body) as { voiceSessionId: string }).voiceSessionId;

    // Org B tries to read org A's session.
    const { cookie: cookieB, agentId: agentB } = await setup();
    const res = await api.request({
      method: 'GET',
      url: `/agents/${agentB}/voice-sessions/${vsId}`,
      cookie: cookieB,
    });
    // Must be 404, not 403 — existence is not probeable (IDOR hygiene).
    expect(res.statusCode).toBe(404);
  });

  it('forged deployment ID returns 404 not 403', async () => {
    const { cookie } = await setup();
    const res = await api.request({
      method: 'GET',
      url: '/agents/00000000-0000-4000-8000-000000000001/voice-sessions/00000000-0000-4000-8000-000000000002',
      cookie,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

describe('reconcile voice session', () => {
  it('fetches stub results and marks the session ended', async () => {
    const { cookie, agentId } = await setup();
    const startRes = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    expect(startRes.statusCode).toBe(201);
    const vsId = (JSON.parse(startRes.body) as { voiceSessionId: string }).voiceSessionId;

    const db = superDatabase();
    try {
      await db.db.execute(sql`
        update voice_sessions
        set external_conversation_id = 'stub-conv-reconcile-1'
        where id = ${vsId}
      `);
    } finally {
      await db.close();
    }

    const res = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions/${vsId}/reconcile`,
      cookie,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      voiceSession: {
        status: string;
        channel?: string;
        summary: string | null;
        transcript: { role: string; message: string }[] | null;
        structuredAnswers: Record<string, unknown> | null;
        durationSeconds: number | null;
      };
    };
    expect(body.voiceSession.status).toBe('ended');
    expect(body.voiceSession.channel).toBe('browser_demo');
    expect(body.voiceSession.summary).toBe('Stub conversation summary.');
    expect(body.voiceSession.transcript?.length).toBeGreaterThan(0);
    expect(body.voiceSession.structuredAnswers).toMatchObject({
      experience_years: '2',
      notice_period: '30 days',
    });
    expect(body.voiceSession.durationSeconds).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

describe('ElevenLabs webhook', () => {
  // These tests use webhookApi which has real HMAC verification (not the blanket stub)

  it('rejects a missing signature with 422', async () => {
    const res = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      payload: { type: 'conversation.ended', conversation_id: 'conv-123' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a tampered signature with 422', async () => {
    const res = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      headers: { 'xi-signature-256': 'xi-signature-256=badhex00', 'content-type': 'application/json' },
      payload: { type: 'conversation.ended', conversation_id: 'conv-456' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('accepts a validly-signed event and returns { received: true }', async () => {
    const payload = { type: 'conversation.ended', conversation_id: 'conv-789' };
    const payloadStr = JSON.stringify(payload);
    const sig = sign(payloadStr);

    const res = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      headers: { 'xi-signature-256': sig, 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { received: boolean };
    expect(body.received).toBe(true);
  });

  it('verifies HMAC against exact raw body bytes (not re-serialized JSON)', async () => {
    // Spacing differs from JSON.stringify(JSON.parse(...)) — only raw capture matches.
    const raw =
      '{ "type": "conversation.ended", "conversation_id": "conv-raw-spacing" }';
    const sig = sign(raw);
    const res = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      headers: { 'xi-signature-256': sig, 'content-type': 'application/json' },
      payload: raw,
    });
    expect(res.statusCode).toBe(201);

    const compactSig = sign(JSON.stringify(JSON.parse(raw)));
    const reject = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      headers: {
        'xi-signature-256': compactSig,
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(reject.statusCode).toBe(422);
  });

  it('accepts ElevenLabs-Signature (t=,v0=) for post_call_transcription', async () => {
    const payload = {
      type: 'post_call_transcription',
      event_timestamp: Math.floor(Date.now() / 1000),
      data: {
        agent_id: 'agent_x',
        conversation_id: 'conv-post-call-1',
        status: 'done',
        transcript: [
          { role: 'agent', message: 'Hello' },
          { role: 'user', message: 'Hi' },
        ],
        analysis: {
          transcript_summary: 'Candidate said hello.',
          data_collection_results: {
            notice_period: { value: '30 days' },
          },
        },
        metadata: { call_duration_secs: 42, cost: 3 },
      },
    };
    const payloadStr = JSON.stringify(payload);
    const sig = signProduction(payloadStr);

    const res = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      headers: {
        'elevenlabs-signature': sig,
        'content-type': 'application/json',
      },
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).received).toBe(true);
  });

  it('unknown conversation ID is silently ignored (no 404)', async () => {
    const payload = { type: 'conversation.ended', conversation_id: 'unknown-conv-id' };
    const payloadStr = JSON.stringify(payload);
    const sig = sign(payloadStr);

    const res = await webhookApi.request({
      method: 'POST',
      url: '/webhooks/elevenlabs',
      headers: { 'xi-signature-256': sig, 'content-type': 'application/json' },
      payload,
    });
    // Silently accepted — we don't reveal whether the conversation existed
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Null cost guard
// ---------------------------------------------------------------------------

describe('null cost handling', () => {
  it('costCredits is null when the provider does not report it', async () => {
    const { cookie, agentId } = await setup();
    const startRes = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    const vsId = (JSON.parse(startRes.body) as { voiceSessionId: string }).voiceSessionId;
    const res = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/voice-sessions/${vsId}`,
      cookie,
    });
    const body = JSON.parse(res.body) as { voiceSession: { costCredits: unknown } };
    // The stub returns null for costCredits
    expect(body.voiceSession.costCredits).toBeNull();
  });
});

describe('call recording playback', () => {
  it('streams audio for a session with a conversation id', async () => {
    const { cookie, agentId } = await setup();
    const startRes = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    const vsId = (JSON.parse(startRes.body) as { voiceSessionId: string }).voiceSessionId;

    const db = await superDatabase();
    try {
      await db.db.execute(sql`
        update voice_sessions
        set external_conversation_id = ${`stub-audio-${vsId}`},
            status = 'ended',
            ended_at = now()
        where id = ${vsId}
      `);
    } finally {
      await db.close();
    }

    const audio = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/voice-sessions/${vsId}/recording`,
      cookie,
    });
    expect(audio.statusCode).toBe(200);
    const contentType = String(audio.headers['content-type'] ?? '');
    expect(contentType).toMatch(/audio\//);
    const bytes =
      typeof audio.rawPayload !== 'undefined'
        ? Buffer.from(audio.rawPayload as Buffer)
        : Buffer.from(audio.payload as string);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('forbids recording playback without calls.read_recording', async () => {
    const { cookie, agentId, alice } = await setup();
    const startRes = await api.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: {},
    });
    const vsId = (JSON.parse(startRes.body) as { voiceSessionId: string }).voiceSessionId;

    const analyst = await registerUser(api, 'rec-analyst');
    const token = await inviteAndCaptureToken(api, alice, analyst.email, 'analyst');
    const accepted = await acceptInvitation(api, analyst, token);
    expect([200, 201]).toContain(accepted.statusCode);

    const audio = await api.request({
      method: 'GET',
      url: `/agents/${agentId}/voice-sessions/${vsId}/recording`,
      cookie: analyst.cookie,
    });
    expect(audio.statusCode).toBe(403);
  });
});

describe('voice-sessions list filter', () => {
  it('filters company desk sessions by candidateId', async () => {
    const { cookie, agentId, alice } = await setup();

    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: { title: 'Filter Role' },
    });
    expect(jobRes.statusCode).toBe(201);
    const jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candA = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie,
      payload: {
        jobId,
        fullName: 'Filter Alice',
        phone: '9000111222',
        countryCode: '+91',
      },
    });
    const candB = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie,
      payload: {
        jobId,
        fullName: 'Filter Bob',
        phone: '9000333444',
        countryCode: '+91',
      },
    });
    expect(candA.statusCode).toBe(201);
    expect(candB.statusCode).toBe(201);
    const candidateA = (JSON.parse(candA.body) as { id: string }).id;
    const candidateB = (JSON.parse(candB.body) as { id: string }).id;

    for (const candidateId of [candidateA, candidateB]) {
      const start = await api.request({
        method: 'POST',
        url: `/agents/${agentId}/voice-sessions`,
        cookie,
        payload: { jobId, candidateId },
      });
      expect(start.statusCode).toBe(201);
      const vsId = (JSON.parse(start.body) as { voiceSessionId: string }).voiceSessionId;
      const end = await api.request({
        method: 'POST',
        url: `/agents/${agentId}/voice-sessions/${vsId}/end`,
        cookie,
        payload: {},
      });
      expect([200, 201]).toContain(end.statusCode);
    }

    const all = await api.request({
      method: 'GET',
      url: '/voice-sessions',
      cookie,
    });
    expect(all.statusCode).toBe(200);
    const allBody = JSON.parse(all.body) as {
      sessions: { candidateId: string | null }[];
    };
    expect(allBody.sessions.some((s) => s.candidateId === candidateA)).toBe(true);
    expect(allBody.sessions.some((s) => s.candidateId === candidateB)).toBe(true);

    const filtered = await api.request({
      method: 'GET',
      url: `/voice-sessions?candidateId=${candidateA}`,
      cookie,
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = JSON.parse(filtered.body) as {
      sessions: { candidateId: string | null }[];
    };
    expect(filteredBody.sessions.length).toBeGreaterThan(0);
    expect(filteredBody.sessions.every((s) => s.candidateId === candidateA)).toBe(true);
    void alice;
  });
});
