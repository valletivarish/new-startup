/**
 * Settings → Connected systems → Zoho Recruit. Cookie sessions only (an API
 * key can't connect or change a hiring system). Reads need integrations.read;
 * connect, change and disconnect need create/update/delete.
 *
 * The OAuth redirect URI is `${WEB_URL}/backend/integrations/zoho/callback`:
 * the web app proxies /backend to this API, so the callback arrives with the
 * admin's session cookie and the one-time state is checked against that
 * person and company.
 */

import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { requireOrganization } from '../../authz/auth-context.js';
import type { RequestWithAuth } from '../../authz/authz.guard.js';
import { RequirePermission } from '../../authz/decorators.js';
import { ApiError } from '../../errors.js';
import { ZOHO_SERVICE } from '../../tokens.more.js';
import { parse } from '../../validate.js';
import type { ZohoService } from './zoho.service.js';

const ConnectBody = z.object({
  /** "People who apply to our jobs in Zoho Recruit agreed to be phoned about their application." */
  consent: z.literal(true, { error: 'Confirm that applicants agreed to be phoned before connecting.' }),
});

const LinksBody = z.object({
  links: z
    .array(
      z.object({
        zohoJobId: z.string().trim().min(1).max(64),
        zohoJobTitle: z.string().trim().min(1).max(300),
        jobId: z.string().uuid().optional(),
        autoCall: z.boolean().default(false),
      }),
    )
    .max(100)
    .refine((l) => new Set(l.map((x) => x.zohoJobId)).size === l.length, 'Each Zoho job can be linked once.'),
});

const CallbackQuery = z.record(z.string(), z.string().max(2000));

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(req.authContext ?? (() => { throw ApiError.unauthorized(); })());
  if (ctx.apiKey) throw ApiError.forbidden('API keys cannot manage connected systems.');
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
    permissions: ctx.organization.permissions,
  };
}

@Controller('integrations/zoho')
export class ZohoController {
  constructor(@Inject(ZOHO_SERVICE) private readonly zoho: ZohoService) {}

  private live() {
    if (!this.zoho.available()) throw ApiError.notFound('Zoho Recruit connection');
  }

  @Get()
  @RequirePermission('integrations.read')
  async status(@Req() req: RequestWithAuth) {
    const a = actorOf(req);
    return this.zoho.status({ ...a, canSeeNames: a.permissions.has('candidates.read') });
  }

  @Post('connect')
  @RequirePermission('integrations.create')
  async connect(@Req() req: RequestWithAuth, @Body() body: unknown) {
    this.live();
    parse(ConnectBody, body);
    return this.zoho.startConnect(actorOf(req));
  }

  /** Zoho sends the admin's browser here; we answer with a redirect back to Settings. */
  @Get('callback')
  @RequirePermission('integrations.create')
  async callback(@Req() req: RequestWithAuth, @Query() query: unknown, @Res() reply: FastifyReply) {
    this.live();
    const result = await this.zoho.finishConnect(actorOf(req), parse(CallbackQuery, query));
    return reply.redirect(`/settings?section=connected&zoho=${result}`, 302);
  }

  @Get('job-openings')
  @RequirePermission('integrations.read')
  async jobOpenings(@Req() req: RequestWithAuth) {
    this.live();
    return { jobOpenings: await this.zoho.jobOpenings(actorOf(req)) };
  }

  @Put('links')
  @RequirePermission('integrations.update')
  async setLinks(@Req() req: RequestWithAuth, @Body() body: unknown) {
    this.live();
    const a = actorOf(req);
    const { links } = parse(LinksBody, body);
    // Creating a job for a Zoho opening is creating a job.
    if (links.some((l) => !l.jobId) && !a.permissions.has('jobs.create')) {
      throw ApiError.forbidden('Only people who can create jobs can add a new job for a Zoho opening.');
    }
    await this.zoho.setLinks(a, links);
    return this.zoho.status({ ...a, canSeeNames: a.permissions.has('candidates.read') });
  }

  @Post('sync')
  @HttpCode(202)
  @RequirePermission('integrations.update')
  async sync(@Req() req: RequestWithAuth) {
    this.live();
    await this.zoho.requestSync(actorOf(req));
    return { queued: true };
  }

  @Post('notes/retry')
  @RequirePermission('integrations.update')
  async retryNotes(@Req() req: RequestWithAuth) {
    this.live();
    return { retried: await this.zoho.retryNotes(actorOf(req)) };
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('integrations.delete')
  async disconnect(@Req() req: RequestWithAuth) {
    await this.zoho.disconnect(actorOf(req));
  }
}
