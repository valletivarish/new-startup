/**
 * ElevenLabs browser-voice endpoints (MVP-01).
 *
 * Routes (all under the /backend prefix applied by the Next.js rewrite):
 *
 *   POST  /agents/:agentId/voice-deployments         agents.deploy
 *   POST  /agents/:agentId/voice-sessions            agents.test
 *   GET   /agents/:agentId/voice-sessions/:vsId      agents.sessions.read
 *   POST  /agents/:agentId/voice-sessions/:vsId/reconcile  agents.sessions.manage
 *   POST  /webhooks/elevenlabs                        @Public (signature-verified)
 *
 * Authorization follows the same pattern as agents.controller: every route
 * declares exactly one marker, the guard fails closed without one, and
 * route-coverage.test.ts verifies completeness.
 *
 * The webhook handler reconstructs the raw payload string for HMAC
 * verification. Because Fastify JSON-parses the body before NestJS sees it,
 * we re-serialize the body — which is safe for JSON since ElevenLabs payloads
 * contain no ordering-sensitive keys.
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { z } from 'zod';

import { Public, RequirePermission } from '../../authz/decorators.js';
import { requireOrganization } from '../../authz/auth-context.js';
import type { RequestWithAuth } from '../../authz/authz.guard.js';
import { ApiError } from '../../errors.js';
import { parse } from '../../validate.js';
import { VOICE_SESSION_SERVICE, VOICE_SESSION_ADAPTER } from '../../tokens.more.js';
import type { VoiceSessionService, WebhookEvent } from './voice-session.service.js';
import type { VoiceSessionAdapter } from './adapter.js';

const Uuid = z.string().uuid();

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
  };
}

// ---------------------------------------------------------------------------
// Deployments controller (provision an ElevenLabs agent for a published version)
// ---------------------------------------------------------------------------

@Controller('agents/:agentId/voice-deployments')
export class VoiceDeploymentsController {
  constructor(
    @Inject(VOICE_SESSION_SERVICE) private readonly svc: VoiceSessionService,
  ) {}

  /**
   * Provision or re-sync the ElevenLabs agent for the currently-published
   * version. Idempotent — calling it again updates the external agent.
   */
  @RequirePermission('agents.deploy')
  @Post()
  async provision(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ) {
    const actor = actorOf(req);
    const input = parse(
      z.object({
        voiceId: z.string().optional(),
        knowledgeSnapshot: z
          .object({ name: z.string().min(1).max(200), content: z.string().min(1) })
          .optional(),
      }),
      body ?? {},
    );
    const deployment = await this.svc.provisionDeployment(
      actor,
      parse(Uuid, agentId),
      {
        voiceId: input.voiceId,
        knowledgeSnapshot: input.knowledgeSnapshot,
      },
    );
    return { deployment };
  }
}

// ---------------------------------------------------------------------------
// Voice sessions controller
// ---------------------------------------------------------------------------

@Controller('agents/:agentId/voice-sessions')
export class VoiceSessionsController {
  constructor(
    @Inject(VOICE_SESSION_SERVICE) private readonly svc: VoiceSessionService,
  ) {}

  /**
   * Start a test voice session. Returns { voiceSessionId, conversationToken }.
   * The token is a short-lived secret — it is returned ONCE in this response.
   *
   * Cost guards are enforced by the service:
   *   - ELEVENLABS_ENABLED kill switch
   *   - ≤1 active session per org
   *   - Daily session/minute caps
   */
  @RequirePermission('agents.test')
  @Post()
  async start(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ) {
    const actor = actorOf(req);
    const input = parse(
      z
        .object({
          jobId: z.string().uuid().optional(),
          candidateId: z.string().uuid().optional(),
        })
        .strict()
        .refine(
          (value) =>
            (value.jobId === undefined) === (value.candidateId === undefined),
          {
            message: 'jobId and candidateId must be provided together',
            path: ['jobId'],
          },
        ),
      body ?? {},
    );
    const result = await this.svc.startVoiceSession(actor, parse(Uuid, agentId), {
      jobId: input.jobId,
      candidateId: input.candidateId,
    });
    return {
      voiceSessionId: result.voiceSessionId,
      conversationToken: result.conversationToken,
      voiceSession: result.voiceSession,
    };
  }

  /**
   * Get the current state of a voice session (no token returned).
   */
  @RequirePermission('agents.sessions.read')
  @Get(':vsId')
  async get(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Param('vsId') vsId: string,
  ) {
    const actor = actorOf(req);
    void agentId; // The org-scoped lookup in the service handles ownership
    const session = await this.svc.getVoiceSession(actor, parse(Uuid, vsId));
    return { voiceSession: session };
  }

  /**
   * Pull the latest result from the ElevenLabs API and write it to the DB.
   * Safe to call multiple times.
   */
  @RequirePermission('agents.sessions.manage')
  @Post(':vsId/reconcile')
  @HttpCode(200)
  async reconcile(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Param('vsId') vsId: string,
  ) {
    const actor = actorOf(req);
    void agentId;
    const session = await this.svc.reconcileVoiceSession(actor, parse(Uuid, vsId));
    return { voiceSession: session };
  }
}

// ---------------------------------------------------------------------------
// Webhook controller — @Public, verified internally
// ---------------------------------------------------------------------------

@Controller('webhooks')
export class VoiceWebhookController {
  constructor(
    @Inject(VOICE_SESSION_SERVICE) private readonly svc: VoiceSessionService,
    @Inject(VOICE_SESSION_ADAPTER) private readonly adapter: VoiceSessionAdapter,
  ) {}

  /**
   * ElevenLabs webhook endpoint.
   *
   * Security: @Public (no session) but signature-verified via HMAC-SHA256.
   * A forged or tampered request receives 400 (not 401 — we don't confirm
   * that a real secret exists).
   *
   * NOTE on raw body: Fastify parses the body as JSON before this handler
   * runs. We re-serialize it for HMAC verification. This is safe for
   * ElevenLabs payloads which are flat JSON objects without ordering
   * semantics. Production hardening (Fastify rawBody plugin) is listed in
   * the completion report.
   */
  @Public()
  @Post('elevenlabs')
  async webhook(
    @Body() body: unknown,
    @Headers('xi-signature-256') signatureHeader: string | undefined,
  ) {
    // Re-serialize for signature verification.
    const rawPayload = JSON.stringify(body);
    const sig = signatureHeader ?? '';

    if (!this.adapter.verifyWebhookSignature(rawPayload, sig)) {
      throw ApiError.validation([
        { field: 'xi-signature-256', message: 'Invalid or missing webhook signature' },
      ]);
    }

    // Parse the event.
    const bodyObj = body as Record<string, unknown>;
    const event: WebhookEvent = {
      type: String(bodyObj['type'] ?? bodyObj['event_type'] ?? ''),
      conversationId: String(
        bodyObj['conversation_id'] ??
          bodyObj['conversationId'] ??
          (bodyObj['data'] as Record<string, unknown> | undefined)?.['conversation_id'] ??
          '',
      ) || undefined,
      agentId: String(bodyObj['agent_id'] ?? bodyObj['agentId'] ?? '') || undefined,
      data: bodyObj['data'],
    };

    // Dispatch — not org-scoped at this level (the service resolves the org).
    await this.svc.handleWebhookEvent(null, event);

    return { received: true };
  }
}
