/**
 * Dashboard management of company API keys. Cookie sessions only: an API
 * key can never list, mint or revoke keys, whatever its scopes.
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
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { API_KEYS_SERVICE } from '../tokens.more.js';
import type { ApiKeysService } from './api-keys.service.js';
import { API_SCOPES } from './scopes.js';

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
  return { organizationId: ctx.organization.organizationId, userId: ctx.userId };
}

@Controller('organization/api-keys')
export class ApiKeysController {
  constructor(@Inject(API_KEYS_SERVICE) private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermission('integrations.read')
  async list(@Req() req: RequestWithAuth) {
    return { keys: await this.keys.list(dashboardActor(req)) };
  }

  @Post()
  @RequirePermission('integrations.create')
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const actor = dashboardActor(req);
    return this.keys.create(actor, parse(CreateBody, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('integrations.delete')
  async revoke(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const actor = dashboardActor(req);
    await this.keys.revoke(actor, parse(z.string().uuid(), id));
  }
}
