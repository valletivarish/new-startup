/**
 * Platform-admin cost dashboard API (/admin/costs/*).
 *
 * Signed-in users only, and then only emails in PLATFORM_ADMIN_EMAILS. Anyone
 * else gets 404 so the route's existence is not advertised to customers.
 */

import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Authenticated } from '../authz/decorators.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { COST_SERVICE, USAGE_SERVICE } from '../tokens.more.js';
import type { UsageService } from '../integrations/usage.service.js';
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

const LimitsBody = z
  .object({
    callsPerDay: z.number().int().min(0).max(1_000_000),
    maxConcurrent: z.number().int().min(0).max(10_000),
    monthlyCap: z.number().int().min(0).max(100_000_000).nullable(),
    pricePerScreenInr: z.number().min(0).max(1_000_000).nullable(),
  })
  .strict();

const csvCell = (v: string | number | null): string =>
  v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

@Controller('admin/costs')
export class AdminCostsController {
  constructor(
    @Inject(COST_SERVICE) private readonly costs: CostService,
    @Inject(USAGE_SERVICE) private readonly usage: UsageService,
  ) {}

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

  @Authenticated()
  @Get('orgs/:orgId/limits')
  async getLimits(@Req() req: RequestWithAuth, @Param('orgId') orgId: string) {
    this.adminUserId(req);
    return { limits: await this.usage.getLimits(parse(z.string().uuid(), orgId)) };
  }

  @Authenticated()
  @Put('orgs/:orgId/limits')
  async setLimits(@Req() req: RequestWithAuth, @Param('orgId') orgId: string, @Body() body: unknown) {
    this.adminUserId(req);
    return {
      limits: await this.usage.setLimits(parse(z.string().uuid(), orgId), parse(LimitsBody, body)),
    };
  }

  /** One row per company: completed screens x per-screen price for the month. */
  @Authenticated()
  @Get('invoice.csv')
  async invoice(
    @Req() req: RequestWithAuth,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const userId = this.adminUserId(req);
    const month = parse(MonthQuery, query).month ?? currentMonth();
    const lines = ['organization,month,completed_screens,price_per_screen_inr,amount_inr'];
    for (const org of await this.costs.adminListOrganizations(userId)) {
      const u = await this.usage.month(org.id, month);
      lines.push(
        [org.name, month, u.completedScreens, u.pricePerScreenInr, u.amountInr].map(csvCell).join(','),
      );
    }
    void reply.header('content-type', 'text/csv; charset=utf-8');
    return lines.join('\n') + '\n';
  }
}
