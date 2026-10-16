/**
 * Platform-admin cost dashboard API (/admin/costs/*).
 *
 * Signed-in users only, and then only emails in PLATFORM_ADMIN_EMAILS. Anyone
 * else gets 404 so the route's existence is not advertised to customers.
 */

import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Authenticated } from '../authz/decorators.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { COST_SERVICE } from '../tokens.more.js';
import type { CostService } from './costs.service.js';

const ServicePatch = z
  .object({
    rateInr: z.number().min(0).max(1_000_000).optional(),
    status: z.enum(['in_use', 'testing', 'off']).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

const Rating = z
  .object({
    rating: z.number().int().min(1).max(5),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

const EngineBody = z
  .object({ engine: z.enum(['elevenlabs_agent', 'own_loop_elevenlabs_voice', 'own_loop_sarvam_voice']) })
  .strict();

const MonthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

@Controller('admin/costs')
export class AdminCostsController {
  constructor(@Inject(COST_SERVICE) private readonly costs: CostService) {}

  private adminUserId(req: RequestWithAuth): string {
    const ctx = req.authContext;
    if (!ctx) throw ApiError.unauthorized();
    if (!this.costs.isPlatformAdmin(ctx.userEmail)) throw ApiError.notFound('Page');
    return ctx.userId;
  }

  @Authenticated()
  @Get('services')
  async services(@Req() req: RequestWithAuth) {
    return { services: await this.costs.adminListServices(this.adminUserId(req)) };
  }

  @Authenticated()
  @Patch('services/:key')
  async updateService(@Req() req: RequestWithAuth, @Param('key') key: string, @Body() body: unknown) {
    const userId = this.adminUserId(req);
    const patch = parse(ServicePatch, body);
    return { service: await this.costs.adminUpdateService(userId, key, patch) };
  }

  @Authenticated()
  @Get('summary')
  async summary(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const userId = this.adminUserId(req);
    const { month } = parse(MonthQuery, query);
    return { summary: await this.costs.adminSummary(userId, `${month ?? currentMonth()}-01`) };
  }

  @Authenticated()
  @Get('calls')
  async calls(@Req() req: RequestWithAuth) {
    return { calls: await this.costs.adminListCalls(this.adminUserId(req), 100) };
  }

  /** The job must be in the admin's active workspace (test jobs live there). */
  @Authenticated()
  @Post('jobs/:jobId/engine')
  async setEngine(@Req() req: RequestWithAuth, @Param('jobId') jobId: string, @Body() body: unknown) {
    const userId = this.adminUserId(req);
    const organizationId = req.authContext?.organization?.organizationId;
    if (!organizationId) throw ApiError.notFound('Job');
    const { engine } = parse(EngineBody, body);
    await this.costs.setJobEngine(organizationId, userId, parse(z.string().uuid(), jobId), engine);
    return { ok: true, engine };
  }

  @Authenticated()
  @Post('calls/:voiceSessionId/rating')
  async rate(
    @Req() req: RequestWithAuth,
    @Param('voiceSessionId') voiceSessionId: string,
    @Body() body: unknown,
  ) {
    const userId = this.adminUserId(req);
    const id = parse(z.string().uuid(), voiceSessionId);
    const { rating, note } = parse(Rating, body);
    await this.costs.adminRateCall(userId, id, rating, note ?? null);
    return { ok: true };
  }
}
