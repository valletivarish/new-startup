/** Public /v1 webhook endpoints and the delivery log (scope `webhooks`). */

import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '@platform/db';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { DATABASE } from '../tokens.js';
import { WEBHOOKS_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import { WEBHOOK_EVENTS } from './events.js';
import { withIdempotency } from './idempotency.js';
import type { WebhooksService } from './webhooks.service.js';

const Id = z.string().uuid();
const EndpointCreate = z.object({
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).transform((e) => [...new Set(e)]),
});
const DeliveryQuery = z.object({ status: z.enum(['pending', 'delivered', 'failed']).optional() });

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return { organizationId: ctx.organization.organizationId, userId: ctx.userId };
}

@Controller('v1')
export class V1WebhooksController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(WEBHOOKS_SERVICE) private readonly webhooks: WebhooksService,
  ) {}

  /** Runs `handler` under the Idempotency-Key header and writes the status it returns. */
  private async write(
    req: RequestWithAuth,
    reply: FastifyReply,
    handler: () => Promise<{ status: number; body: unknown }>,
  ) {
    const out = await withIdempotency(this.database, actorOf(req), req, handler);
    void reply.status(out.status);
    return out.body;
  }

  /** The secret is in this response only. */
  @Post('webhook-endpoints')
  @RequirePermission('integrations.create')
  create(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parse(EndpointCreate, body);
    return this.write(req, reply, async () => ({
      status: 201,
      body: await this.webhooks.create(actorOf(req), input),
    }));
  }

  @Get('webhook-endpoints')
  @RequirePermission('integrations.read')
  async list(@Req() req: RequestWithAuth) {
    return { endpoints: await this.webhooks.list(actorOf(req)) };
  }

  @Delete('webhook-endpoints/:id')
  @RequirePermission('integrations.delete')
  remove(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') rawId: string,
  ) {
    const id = parse(Id, rawId);
    return this.write(req, reply, async () => {
      await this.webhooks.remove(actorOf(req), id);
      return { status: 200, body: { deleted: true } };
    });
  }

  @Get('webhook-deliveries')
  @RequirePermission('integrations.read')
  async deliveries(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const { status } = parse(DeliveryQuery, query);
    return { deliveries: await this.webhooks.deliveries(actorOf(req), status) };
  }

  @Post('webhook-deliveries/:id/resend')
  @RequirePermission('integrations.update')
  resend(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') rawId: string,
  ) {
    const id = parse(Id, rawId);
    return this.write(req, reply, async () => ({
      status: 201,
      body: await this.webhooks.resend(actorOf(req), id),
    }));
  }
}
