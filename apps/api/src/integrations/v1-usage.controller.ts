/** Public /v1/usage: this month's calls and billable screens for the key's company. */

import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { USAGE_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import type { UsageService } from './usage.service.js';

const MonthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

@Controller('v1/usage')
export class V1UsageController {
  constructor(@Inject(USAGE_SERVICE) private readonly usage: UsageService) {}

  @Get()
  @RequirePermission('usage.read')
  get(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const ctx = requireOrganization(
      req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
    );
    const { month } = parse(MonthQuery, query);
    return this.usage.month(
      ctx.organization.organizationId,
      month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7),
    );
  }
}
