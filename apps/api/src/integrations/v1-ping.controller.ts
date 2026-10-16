/** Health check for API clients: proves the key works and names its company. */

import { Controller, Get, Req } from '@nestjs/common';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';

@Controller('v1')
export class V1PingController {
  @Get('ping')
  @RequirePermission('jobs.read')
  ping(@Req() req: RequestWithAuth) {
    const ctx = requireOrganization(
      req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
    );
    return {
      organizationId: ctx.organization.organizationId,
      apiKey: ctx.apiKey ? { id: ctx.apiKey.id, mode: ctx.apiKey.mode } : null,
    };
  }
}
