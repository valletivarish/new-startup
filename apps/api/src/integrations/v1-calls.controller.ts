/** Public /v1 calls: queue a screen for a candidate, then poll its status. */

import { Controller, Get, Header, Inject, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { sql, withTenantContext, type Database } from '@platform/db';
import type { VoiceSessionService } from '../providers/elevenlabs/voice-session.service.js';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { DATABASE } from '../tokens.js';
import { CALL_REQUESTS_SERVICE, VOICE_SESSION_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import type { CallRequestsService } from './call-requests.service.js';
import { withIdempotency } from './idempotency.js';

const Id = z.string().uuid();

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  const perms = ctx.organization.permissions;
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
    apiKeyId: ctx.apiKey?.id ?? null,
    isTest: ctx.apiKey?.mode === 'test',
    allowTranscript: perms.has('calls.read_transcript'),
    allowRecording: perms.has('calls.read_recording'),
  };
}

@Controller('v1')
export class V1CallsController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CALL_REQUESTS_SERVICE) private readonly calls: CallRequestsService,
    @Inject(VOICE_SESSION_SERVICE) private readonly voice: VoiceSessionService,
  ) {}

  @Post('jobs/:jobId/candidates/:id/calls')
  @RequirePermission('calls.initiate')
  async create(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('jobId') rawJobId: string,
    @Param('id') rawId: string,
  ) {
    const jobId = parse(Id, rawJobId);
    const candidateId = parse(Id, rawId);
    const a = actorOf(req);
    const out = await withIdempotency(this.database, a, req, async () => ({
      status: 202,
      body: await this.calls.request(a, { jobId, candidateId, source: 'api' }),
    }));
    void reply.status(out.status);
    return out.body;
  }

  @Get('calls/:id')
  @RequirePermission('calls.read')
  get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.calls.get(actorOf(req), parse(Id, id));
  }

  /** Recording audio. `id` is the call request id, or a voice session id for dashboard calls. */
  @Get('calls/:id/recording')
  @RequirePermission('calls.read_recording')
  @Header('Cache-Control', 'private, no-store')
  async recording(@Req() req: RequestWithAuth, @Param('id') rawId: string) {
    const id = parse(Id, rawId);
    const a = actorOf(req);
    const rows = await withTenantContext(
      this.database.db,
      { organizationId: a.organizationId, userId: a.userId },
      (tx) =>
        tx.execute<{ voice_session_id: string | null }>(sql`
          select voice_session_id from call_requests
          where id = ${id} and organization_id = ${a.organizationId}
        `),
    );
    const vsId = rows[0] ? rows[0].voice_session_id : id;
    if (!vsId) throw ApiError.notFound('Call recording');
    const audio = await this.voice.getVoiceSessionRecording(a, vsId);
    return new StreamableFile(audio.body, { type: audio.contentType, disposition: 'inline' });
  }
}
