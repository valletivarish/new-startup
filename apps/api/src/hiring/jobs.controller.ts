import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { JOBS_SERVICE } from '../tokens.more.js';
import type { JobsService } from './jobs.service.js';

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
  };
}

const Uuid = z.string().uuid();

const CreateJob = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    agentId: z.string().uuid().optional(),
  })
  .strict();

const UpdateJob = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(['draft', 'open', 'closed']).optional(),
    agentId: z.string().uuid().nullable().optional(),
  })
  .strict();

@Controller('jobs')
export class JobsController {
  constructor(@Inject(JOBS_SERVICE) private readonly jobs: JobsService) {}

  @RequirePermission('jobs.read')
  @Get()
  async list(@Req() req: RequestWithAuth) {
    return { jobs: await this.jobs.list(actorOf(req)) };
  }

  @RequirePermission('jobs.create')
  @Post()
  @HttpCode(201)
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    return this.jobs.create(actorOf(req), parse(CreateJob, body));
  }

  @RequirePermission('jobs.read')
  @Get(':id')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.jobs.get(actorOf(req), parse(Uuid, id));
  }

  @RequirePermission('jobs.update')
  @Patch(':id')
  async update(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.jobs.update(actorOf(req), parse(Uuid, id), parse(UpdateJob, body));
    return { updated: true };
  }
}
