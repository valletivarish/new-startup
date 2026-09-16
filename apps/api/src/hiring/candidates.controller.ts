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
import { AUDIT_SERVICE } from '../tokens.js';
import { CANDIDATES_SERVICE } from '../tokens.more.js';
import type { AuditService } from '../audit/audit.service.js';
import type { CandidateRow, CandidatesService } from './candidates.service.js';

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
  };
}

function canReadPii(req: RequestWithAuth): boolean {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return ctx.organization.permissions.has('candidates.read_pii');
}

type PublicCandidate = Omit<CandidateRow, 'phone' | 'email' | 'resumeText'>;

function toPublicCandidate(row: CandidateRow): PublicCandidate {
  return {
    id: row.id,
    fullName: row.fullName,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const Uuid = z.string().uuid();

const CreateCandidate = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(30).optional(),
    email: z.string().trim().email().max(320).optional(),
    resumeText: z.string().trim().max(50_000).optional(),
  })
  .strict();

const UpdateCandidate = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(30).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    resumeText: z.string().trim().max(50_000).nullable().optional(),
  })
  .strict();

@Controller('candidates')
export class CandidatesController {
  constructor(
    @Inject(CANDIDATES_SERVICE) private readonly candidates: CandidatesService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private async auditPiiAccess(req: RequestWithAuth): Promise<void> {
    const actor = actorOf(req);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'authz.sensitive_access',
      metadata: {
        permission: 'candidates.read_pii',
        method: req.method,
        url: req.url,
      },
    });
  }

  private presentCandidate(
    req: RequestWithAuth,
    row: CandidateRow,
  ): PublicCandidate | CandidateRow {
    if (!canReadPii(req)) return toPublicCandidate(row);
    return row;
  }

  @RequirePermission('candidates.read')
  @Get()
  async list(@Req() req: RequestWithAuth) {
    const rows = await this.candidates.list(actorOf(req));
    if (canReadPii(req)) await this.auditPiiAccess(req);
    return {
      candidates: rows.map((row) => this.presentCandidate(req, row)),
    };
  }

  @RequirePermission('candidates.create')
  @Post()
  @HttpCode(201)
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    return this.candidates.create(actorOf(req), parse(CreateCandidate, body));
  }

  @RequirePermission('candidates.read')
  @Get(':id')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const row = await this.candidates.get(actorOf(req), parse(Uuid, id));
    if (canReadPii(req)) await this.auditPiiAccess(req);
    return this.presentCandidate(req, row);
  }

  @RequirePermission('candidates.update')
  @Patch(':id')
  async update(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.candidates.update(
      actorOf(req),
      parse(Uuid, id),
      parse(UpdateCandidate, body),
    );
    return { updated: true };
  }
}
