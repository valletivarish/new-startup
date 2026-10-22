/**
 * Careers-page embed routes.
 *
 *   /jobs/:jobId/careers-page          the job page's panel: make, read, change, revoke the key
 *                                      (cookie sessions only; API keys never reach non-/v1 routes)
 *   /public/embed/:key                 the form's heading (company name, job title)
 *   /public/embed/:key/applications    the form's submission
 *
 * The public routes answer CORS only for the key's allowed origins, and refuse any other
 * Origin (or none) with 403 before doing anything else.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Options,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { Public, RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { CAREERS_EMBED_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import { indianMobile, MAX_ORIGINS, type CareersEmbedService } from './careers-embed.service.js';

const Id = z.string().uuid();
const Origins = z.object({ allowedOrigins: z.array(z.string().max(300)).max(MAX_ORIGINS * 2) });

const Application = z.object({
  fullName: z.string().trim().min(1, 'Enter your name.').max(200),
  phone: z
    .string()
    .max(30)
    .transform((v, ctx) => {
      const mobile = indianMobile(v);
      if (!mobile) ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit Indian mobile number.' });
      return mobile ?? '';
    }),
  email: z
    .string()
    .trim()
    .max(320)
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email, or leave it empty.'),
  consent: z.literal(true),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().max(500).optional(),
});

/** Per IP, through the app-wide limiter. Applying is the expensive one (it can place a call). */
const READ_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const APPLY_LIMIT = { rateLimit: { max: 5, timeWindow: '1 minute' } };

function dashboardActor(req: RequestWithAuth) {
  const ctx = requireOrganization(req.authContext ?? (() => { throw ApiError.unauthorized(); })());
  if (ctx.apiKey) throw ApiError.forbidden('API keys cannot manage careers page forms.');
  return { organizationId: ctx.organization.organizationId, userId: ctx.userId };
}

@Controller('jobs/:jobId/careers-page')
export class CareersPageController {
  constructor(@Inject(CAREERS_EMBED_SERVICE) private readonly embed: CareersEmbedService) {}

  @Get()
  @RequirePermission('integrations.read')
  async get(@Req() req: RequestWithAuth, @Param('jobId') jobId: string) {
    return this.embed.get(dashboardActor(req), parse(Id, jobId));
  }

  @Post()
  @RequirePermission('integrations.create')
  async create(@Req() req: RequestWithAuth, @Param('jobId') jobId: string, @Body() body: unknown) {
    const { allowedOrigins } = parse(Origins, body);
    return { key: await this.embed.create(dashboardActor(req), parse(Id, jobId), allowedOrigins) };
  }

  @Patch()
  @RequirePermission('integrations.update')
  async update(@Req() req: RequestWithAuth, @Param('jobId') jobId: string, @Body() body: unknown) {
    const { allowedOrigins } = parse(Origins, body);
    return { key: await this.embed.setOrigins(dashboardActor(req), parse(Id, jobId), allowedOrigins) };
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('integrations.delete')
  async revoke(@Req() req: RequestWithAuth, @Param('jobId') jobId: string) {
    await this.embed.revoke(dashboardActor(req), parse(Id, jobId));
  }
}

@Controller('public/embed')
export class PublicEmbedController {
  constructor(@Inject(CAREERS_EMBED_SERVICE) private readonly embed: CareersEmbedService) {}

  @Public()
  @RouteConfig(READ_LIMIT)
  @Options(':key')
  async preflightForm(@Res() reply: FastifyReply, @Param('key') key: string, @Headers('origin') origin?: string) {
    await this.preflight(reply, key, origin);
  }

  @Public()
  @RouteConfig(READ_LIMIT)
  @Options(':key/applications')
  async preflightApply(@Res() reply: FastifyReply, @Param('key') key: string, @Headers('origin') origin?: string) {
    await this.preflight(reply, key, origin);
  }

  @Public()
  @RouteConfig(READ_LIMIT)
  @Get(':key')
  async describe(
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('key') key: string,
    @Headers('origin') origin?: string,
  ) {
    const form = await this.embed.authorize(key, origin);
    cors(reply, origin!);
    return this.embed.describe(form);
  }

  @Public()
  @RouteConfig(APPLY_LIMIT)
  @Post(':key/applications')
  async apply(
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('key') key: string,
    @Body() body: unknown,
    @Headers('origin') origin?: string,
  ) {
    const form = await this.embed.authorize(key, origin);
    // From here on errors carry the CORS header, so the form can show them.
    cors(reply, origin!);
    if ((body as { consent?: unknown } | null)?.consent !== true) throw ApiError.consentRequired();
    const input = parse(Application, body);
    void reply.status(201);
    if (input.website) return { callAfter: null };
    return this.embed.apply(form, {
      fullName: input.fullName,
      phone: input.phone,
      ...(input.email ? { email: input.email } : {}),
    });
  }

  private async preflight(reply: FastifyReply, key: string, origin: string | undefined) {
    if (origin && (await this.embed.allows(key, origin))) {
      cors(reply, origin);
      void reply
        .header('access-control-allow-methods', 'GET, POST')
        .header('access-control-allow-headers', 'content-type')
        .header('access-control-max-age', '600');
    } else {
      void reply.header('vary', 'Origin');
    }
    void reply.status(204).send();
  }
}

function cors(reply: FastifyReply, origin: string) {
  void reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
}
