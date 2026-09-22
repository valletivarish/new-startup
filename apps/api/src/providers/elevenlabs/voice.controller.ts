/**
 * ElevenLabs browser-voice endpoints (MVP-01).
 *
 * Routes (all under the /backend prefix applied by the Next.js rewrite):
 *
 *   POST  /agents/:agentId/voice-deployments         agents.deploy
 *   POST  /agents/:agentId/voice-sessions            agents.test | calls.initiate
 *   GET   /agents/:agentId/voice-sessions/:vsId      agents.sessions.read
 *   POST  /agents/:agentId/voice-sessions/:vsId/reconcile  agents.test | calls.initiate
 *   POST  /agents/:agentId/voice-sessions/:vsId/end  agents.test | calls.initiate
 *   GET   /agents/:agentId/voice-sessions/:vsId/recording  calls.read_recording
 *   GET   /telephony/status                          agents.test | calls.initiate
 *   POST  /webhooks/elevenlabs                        @Public (signature-verified)
 *
 * Authorization follows the same pattern as agents.controller: every route
 * declares exactly one marker, the guard fails closed without one, and
 * route-coverage.test.ts verifies completeness.
 *
 * The webhook handler verifies HMAC against the raw request body captured in
 * server.ts (preParsing). Falls back to JSON re-serialize only if raw capture
 * is unavailable (should not happen in production).
 */

import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Headers,
  HttpCode,
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';

import { Public, RequireAnyPermission, RequirePermission } from '../../authz/decorators.js';
import { requireOrganization } from '../../authz/auth-context.js';
import type { RequestWithAuth } from '../../authz/authz.guard.js';
import { ApiError } from '../../errors.js';
import { parse } from '../../validate.js';
import { VOICE_SESSION_SERVICE, VOICE_SESSION_ADAPTER } from '../../tokens.more.js';
import type { VoiceSessionService, WebhookEvent } from './voice-session.service.js';
import type { VoiceSessionAdapter } from './adapter.js';
import type { VoiceSessionResult } from './types.js';
import { scrubHireAdvice } from '../../hiring/review-chat.js';

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

function canReadTranscript(req: RequestWithAuth): boolean {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return ctx.organization.permissions.has('calls.read_transcript');
}

function redactVoiceSession(
  session: VoiceSessionResult,
  allowTranscript: boolean,
): VoiceSessionResult {
  const scrubbed: VoiceSessionResult = {
    ...session,
    summary: session.summary ? scrubHireAdvice(session.summary) : null,
  };
  if (allowTranscript) return scrubbed;
  return {
    ...scrubbed,
    transcript: null,
    summary: null,
    structuredAnswers: null,
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
    return { deployment: deployment.deployment };
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
  @RequireAnyPermission('agents.test', 'calls.initiate')
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
    return {
      voiceSession: redactVoiceSession(session, canReadTranscript(req)),
    };
  }

  /**
   * Pull the latest result from the ElevenLabs API and write it to the DB.
   * Safe to call multiple times.
   */
  @RequireAnyPermission('agents.test', 'calls.initiate')
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
    return {
      voiceSession: redactVoiceSession(session, canReadTranscript(req)),
    };
  }

  /**
   * End an active screen so another Call phone / browser demo can start.
   */
  @RequireAnyPermission('agents.test', 'calls.initiate')
  @Post(':vsId/end')
  @HttpCode(200)
  async end(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Param('vsId') vsId: string,
  ) {
    const actor = actorOf(req);
    void agentId;
    const session = await this.svc.endVoiceSession(actor, parse(Uuid, vsId));
    return {
      voiceSession: redactVoiceSession(session, canReadTranscript(req)),
    };
  }

  /**
   * Play the call recording. Gated separately from transcript (calls.read_recording).
   */
  @RequirePermission('calls.read_recording')
  @Get(':vsId/recording')
  @Header('Cache-Control', 'private, no-store')
  async recording(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Param('vsId') vsId: string,
  ): Promise<StreamableFile> {
    const actor = actorOf(req);
    void agentId;
    const audio = await this.svc.getVoiceSessionRecording(actor, parse(Uuid, vsId));
    return new StreamableFile(audio.body, {
      type: audio.contentType,
      disposition: 'inline',
    });
  }
}

/** Company-wide Calls desk — hiring browser demos and (later) phone screens. */
@Controller('voice-sessions')
export class VoiceCallsController {
  constructor(
    @Inject(VOICE_SESSION_SERVICE) private readonly svc: VoiceSessionService,
  ) {}

  @RequirePermission('agents.sessions.read')
  @Get()
  async list(
    @Req() req: RequestWithAuth,
    @Query('candidateId') candidateIdRaw?: string,
  ) {
    const actor = actorOf(req);
    const candidateId =
      candidateIdRaw && candidateIdRaw.trim()
        ? parse(z.string().uuid(), candidateIdRaw.trim())
        : undefined;
    const sessions = await this.svc.listVoiceSessions(actor, {
      limit: 50,
      candidateId,
    });
    const allow = canReadTranscript(req);
    return {
      sessions: sessions.map((session) => redactVoiceSession(session, allow)),
    };
  }
}

@Controller('telephony')
export class TelephonyStatusController {
  constructor(
    @Inject(VOICE_SESSION_SERVICE) private readonly svc: VoiceSessionService,
  ) {}

  @RequireAnyPermission('agents.test', 'calls.initiate')
  @Get('status')
  status() {
    const outboundPhone = this.svc.isOutboundConfigured();
    const openOutbound = outboundPhone && this.svc.isOpenOutbound();
    return {
      outboundPhone,
      browserDemo: true,
      openOutbound,
      message: !outboundPhone
        ? 'Live phone calling is not connected for this company yet. You can run a browser demo screen now. Ask us when you are ready to connect a phone line.'
        : openOutbound
          ? 'Live phone calling is connected. Use Call phone on a candidate with a valid mobile number.'
          : 'Phone calling is connected. Finish business verification on the phone account if a dial is rejected. Browser screens still work.',
    };
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
   * HMAC is checked against the raw body bytes captured in server.ts.
   */
  @Public()
  @Post('elevenlabs')
  async webhook(
    @Body() body: unknown,
    @Headers('elevenlabs-signature') elevenLabsSignature: string | undefined,
    @Headers('xi-signature-256') legacySignature: string | undefined,
    @Req() req: RequestWithAuth & { rawBody?: string },
  ) {
    const rawPayload =
      typeof req.rawBody === 'string' && req.rawBody.length > 0
        ? req.rawBody
        : JSON.stringify(body);
    const sig = (elevenLabsSignature ?? legacySignature ?? '').trim();

    if (!this.adapter.verifyWebhookSignature(rawPayload, sig)) {
      throw ApiError.validation([
        {
          field: 'elevenlabs-signature',
          message: 'Invalid or missing webhook signature',
        },
      ]);
    }

    // Parse the event.
    const bodyObj = body as Record<string, unknown>;
    const dataObj =
      bodyObj['data'] && typeof bodyObj['data'] === 'object'
        ? (bodyObj['data'] as Record<string, unknown>)
        : undefined;
    const event: WebhookEvent = {
      type: String(bodyObj['type'] ?? bodyObj['event_type'] ?? ''),
      conversationId: String(
        bodyObj['conversation_id'] ??
          bodyObj['conversationId'] ??
          dataObj?.['conversation_id'] ??
          dataObj?.['conversationId'] ??
          '',
      ) || undefined,
      agentId:
        String(
          bodyObj['agent_id'] ??
            bodyObj['agentId'] ??
            dataObj?.['agent_id'] ??
            '',
        ) || undefined,
      data: bodyObj['data'],
    };

    // Dispatch — not org-scoped at this level (the service resolves the org).
    await this.svc.handleWebhookEvent(null, event);

    return { received: true };
  }
}
