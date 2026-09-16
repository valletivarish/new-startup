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

function requireCandidatesRead(req: RequestWithAuth): void {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  if (!ctx.organization.permissions.has('candidates.read')) {
    throw ApiError.forbidden();
  }
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

const AssignCandidate = z
  .object({
    candidateId: z.string().uuid(),
  })
  .strict();

const UpdateAssignmentStatus = z
  .object({
    status: z.enum(['new', 'screening', 'reviewed']),
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

  @RequirePermission('jobs.update')
  @Post(':jobId/candidates')
  @HttpCode(201)
  async assignCandidate(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(AssignCandidate, body);
    return this.jobs.assignCandidate(
      actorOf(req),
      parse(Uuid, jobId),
      input.candidateId,
    );
  }

  @RequirePermission('jobs.read')
  @Get(':jobId/candidates')
  async listCandidates(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
  ) {
    requireCandidatesRead(req);
    const rows = await this.jobs.listCandidates(actorOf(req), parse(Uuid, jobId));
    return {
      candidates: rows.map((row) => ({
        id: row.id,
        candidateId: row.candidateId,
        status: row.status,
        candidate: {
          id: row.candidateId,
          fullName: row.fullName,
          source: row.source,
        },
      })),
    };
  }

  @RequirePermission('jobs.update')
  @Patch(':jobId/candidates/:candidateId')
  async updateCandidateStatus(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ) {
    const input = parse(UpdateAssignmentStatus, body);
    await this.jobs.updateCandidateStatus(
      actorOf(req),
      parse(Uuid, jobId),
      parse(Uuid, candidateId),
      input.status,
    );
    return { updated: true };
  }
}
