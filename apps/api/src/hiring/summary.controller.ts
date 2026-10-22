import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Database } from '@platform/db';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { DATABASE } from '../tokens.js';
import { loadHiringSummary } from './summary.js';

/** The Jobs home in one request (replaces one candidate list per job). */
@Controller('hiring')
export class HiringSummaryController {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  @RequirePermission('jobs.read')
  @Get('summary')
  async summary(@Req() req: RequestWithAuth) {
    const ctx = requireOrganization(
      req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
    );
    const permissions = ctx.organization.permissions;
    return loadHiringSummary(
      this.database,
      { organizationId: ctx.organization.organizationId, userId: ctx.userId },
      {
        canReadCandidates: permissions.has('candidates.read'),
        canReadAgents: permissions.has('agents.read'),
      },
    );
  }
}
