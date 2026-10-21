/**
 * Settings → Developers: company API keys, webhook endpoints, the delivery
 * log and usage. Cookie sessions only: an API key can never reach these,
 * whatever its scopes (the /v1 routes are its way in).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { API_KEYS_SERVICE, USAGE_SERVICE, WEBHOOKS_SERVICE } from '../tokens.more.js';
import type { ApiKeysService } from './api-keys.service.js';
import { API_SCOPES } from './scopes.js';
import type { UsageService } from './usage.service.js';
import { V1WebhookEndpointCreate } from './v1-schemas.js';
import type { WebhooksService } from './webhooks.service.js';

const MonthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

const CreateBody = z.object({
  name: z.string().trim().min(1).max(100),
  mode: z.enum(['live', 'test']),
  scopes: z.array(z.enum(API_SCOPES)).min(1).transform((s) => [...new Set(s)]),
});

function dashboardActor(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  if (ctx.apiKey) throw ApiError.forbidden('API keys cannot manage API keys.');
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
    permissions: ctx.organization.permissions,
  };
}

@Controller('organization')
export class ApiKeysController {
  constructor(
    @Inject(API_KEYS_SERVICE) private readonly keys: ApiKeysService,
    @Inject(WEBHOOKS_SERVICE) private readonly webhooks: WebhooksService,
    @Inject(USAGE_SERVICE) private readonly usage: UsageService,
  ) {}

  @Get('api-keys')
  @RequirePermission('integrations.read')
  async list(@Req() req: RequestWithAuth) {
    return { keys: await this.keys.list(dashboardActor(req)) };
  }

  @Post('api-keys')
  @RequirePermission('integrations.create')
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const actor = dashboardActor(req);
    return this.keys.create(actor, parse(CreateBody, body));
  }

  @Delete('api-keys/:id')
  @HttpCode(204)
  @RequirePermission('integrations.delete')
  async revoke(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const actor = dashboardActor(req);
    await this.keys.revoke(actor, parse(z.string().uuid(), id));
  }

  // Webhooks: the same service as /v1/webhook-endpoints, without idempotency.

  @Get('webhooks')
  @RequirePermission('integrations.read')
  async listWebhooks(@Req() req: RequestWithAuth) {
    return { endpoints: await this.webhooks.list(dashboardActor(req)) };
  }

  /** The signing secret is in this response only. */
  @Post('webhooks')
  @RequirePermission('integrations.create')
  async createWebhook(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const actor = dashboardActor(req);
    const input = parse(V1WebhookEndpointCreate, body);
    // Call events carry the transcript, as on /v1.
    if (input.events.some((e) => e.startsWith('call.')) && !actor.permissions.has('calls.read_transcript')) {
      throw ApiError.forbidden('Webhooks send transcripts, so only people who can read transcripts can add one.');
    }
    return this.webhooks.create(actor, input);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @RequirePermission('integrations.delete')
  async removeWebhook(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.webhooks.remove(dashboardActor(req), parse(z.string().uuid(), id));
  }

  /** The latest 50 deliveries. */
  @Get('webhooks/deliveries')
  @RequirePermission('integrations.read')
  async deliveries(@Req() req: RequestWithAuth) {
    return { deliveries: (await this.webhooks.deliveries(dashboardActor(req))).slice(0, 50) };
  }

  @Post('webhooks/deliveries/:id/resend')
  @RequirePermission('integrations.update')
  async resend(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.webhooks.resend(dashboardActor(req), parse(z.string().uuid(), id));
  }

  /** Calls placed and completed screens for a month (YYYY-MM, default this month in IST). */
  @Get('usage')
  @RequirePermission('usage.read')
  async monthUsage(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const { organizationId } = dashboardActor(req);
    const { month } = parse(MonthQuery, query);
    return this.usage.month(
      organizationId,
      month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7),
    );
  }
}
