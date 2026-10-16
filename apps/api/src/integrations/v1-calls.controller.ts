/** Public /v1 calls: queue a screen for a candidate, then poll its status. */

import { Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '@platform/db';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { DATABASE } from '../tokens.js';
import { CALL_REQUESTS_SERVICE } from '../tokens.more.js';
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
}
