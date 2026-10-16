/** "Ask the candidate" links: minted with an API key, opened by the candidate with no login. */

import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { Public, RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import type { Env } from '../config.js';
import { ApiError } from '../errors.js';
import { ENV } from '../tokens.js';
import { CANDIDATE_LINKS_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import type { CandidateLinksService } from './candidate-links.service.js';

const Id = z.string().uuid();
const Token = z.string().regex(/^[0-9A-Za-z]{32}$/);

const LinkCreate = z.object({
  candidateId: Id.optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
});

const LinkSubmit = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30),
  countryCode: z.string().trim().min(1).max(8).default('+91'),
  when: z.union([z.literal('now'), z.string().datetime({ offset: true })]),
});

/** 10 requests a minute per IP, through the app-wide limiter. */
const LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

@Controller('v1/jobs')
export class V1CandidateLinksController {
  constructor(
    @Inject(CANDIDATE_LINKS_SERVICE) private readonly links: CandidateLinksService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post(':jobId/candidate-links')
  @RequirePermission('candidates.create')
  create(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('jobId') rawJobId: string,
    @Body() body: unknown,
  ) {
    const jobId = parse(Id, rawJobId);
    const input = parse(LinkCreate, body ?? {});
    const ctx = requireOrganization(
      req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
    );
    const actor = {
      organizationId: ctx.organization.organizationId,
      userId: ctx.userId,
      isTest: ctx.apiKey?.mode === 'test',
    };
    // No Idempotency-Key handling here on purpose: the stored response body would keep the raw
    // token for 24h. A duplicate link is harmless (one use each, 7 day expiry).
    return this.links
      .create(actor, jobId, {
        ...(input.candidateId ? { candidateId: input.candidateId } : {}),
        ...(input.fullName ? { fullName: input.fullName } : {}),
        ...(input.email ? { email: input.email } : {}),
      })
      .then(({ token, expiresAt }) => {
        void reply.status(201);
        return { url: `${this.env.WEB_URL}/c/${token}`, expiresAt };
      });
  }
}

@Controller('public/candidate-links')
export class PublicCandidateLinksController {
  constructor(@Inject(CANDIDATE_LINKS_SERVICE) private readonly links: CandidateLinksService) {}

  @Public()
  @RouteConfig(LIMIT)
  @Get(':token')
  async get(@Param('token') token: string) {
    return this.links.describe(this.token(token));
  }

  @Public()
  @RouteConfig(LIMIT)
  @Post(':token')
  async submit(
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('token') token: string,
    @Body() body: unknown,
  ) {
    // Consent first, so a missing flag is `consent_required`, not a generic 422.
    if ((body as { consent?: unknown } | null)?.consent !== true) throw ApiError.consentRequired();
    const input = parse(LinkSubmit, body);
    const out = await this.links.submit(this.token(token), {
      fullName: input.fullName,
      phone: input.phone,
      countryCode: input.countryCode,
      when: input.when === 'now' ? 'now' : new Date(input.when),
    });
    void reply.status(201);
    return out;
  }

  /** A malformed token is just another unknown one. */
  private token(raw: string): string {
    const parsed = Token.safeParse(raw);
    if (!parsed.success) throw ApiError.notFound('Link');
    return parsed.data;
  }
}
