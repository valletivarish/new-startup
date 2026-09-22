import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
import { contentTypeFromFileName, validateUpload } from '../knowledge/formats.js';
import { extractDocumentText } from '../knowledge/document-text.js';

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
    jobId: row.jobId,
    fullName: row.fullName,
    countryCode: row.countryCode,
    source: row.source,
    screeningStatus: row.screeningStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const Uuid = z.string().uuid();

const ResumeFile = z.object({
  name: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  content: z.string().min(1).max(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 1024),
  contentEncoding: z.literal('base64'),
});

const CreateCandidate = z
  .object({
    jobId: z.string().uuid(),
    fullName: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(30).optional(),
    countryCode: z.string().trim().min(1).max(8).default('+91'),
    email: z.string().trim().email().max(320).optional(),
    resumeText: z.string().trim().max(50_000).optional(),
    resumeFile: ResumeFile.optional(),
  })
  .strict()
  .refine((v) => !(v.resumeText && v.resumeFile), {
    message: 'Send either pasted resume text or a resume file, not both.',
    path: ['resumeFile'],
  });

const UpdateCandidate = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(30).nullable().optional(),
    countryCode: z.string().trim().min(1).max(8).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    resumeText: z.string().trim().max(50_000).nullable().optional(),
  })
  .strict();

async function resolveResumeText(input: {
  resumeText?: string;
  resumeFile?: z.infer<typeof ResumeFile>;
}): Promise<string | undefined> {
  if (input.resumeText) return input.resumeText;
  if (!input.resumeFile) return undefined;

  const bytes = Buffer.from(input.resumeFile.content, 'base64');
  const guessed =
    contentTypeFromFileName(input.resumeFile.name) ?? input.resumeFile.contentType;
  const contentType = validateUpload({
    name: input.resumeFile.name,
    contentType: guessed,
    bytes,
  });
  const text = await extractDocumentText(contentType, bytes);
  if (text.length > 50_000) {
    throw ApiError.validation([
      {
        field: 'resumeFile',
        message: 'This resume is too long after reading. Try a shorter file.',
      },
    ]);
  }
  return text;
}

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
  async list(
    @Req() req: RequestWithAuth,
    @Query('jobId') jobIdRaw?: string,
  ) {
    if (!jobIdRaw) {
      throw ApiError.validation([
        {
          field: 'jobId',
          message: 'jobId query parameter is required',
        },
      ]);
    }
    const jobId = parse(Uuid, jobIdRaw);
    const rows = await this.candidates.list(actorOf(req), { jobId });
    if (canReadPii(req)) await this.auditPiiAccess(req);
    return {
      candidates: rows.map((row) => this.presentCandidate(req, row)),
    };
  }

  @RequirePermission('candidates.create')
  @Post()
  @HttpCode(201)
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const input = parse(CreateCandidate, body);
    let resumeText: string | undefined;
    try {
      resumeText = await resolveResumeText(input);
    } catch (e) {
      // Scanned resumes are common in India — still create the person when a
      // mobile is provided so Call phone can proceed without readable PDF text.
      if (input.resumeFile && input.phone?.trim()) {
        resumeText = undefined;
      } else if (input.resumeFile) {
        throw ApiError.validation([
          {
            field: 'resumeFile',
            message:
              'Could not read text from this file. Add a +91 mobile, or paste the resume text instead.',
          },
        ]);
      } else {
        throw e;
      }
    }
    return this.candidates.create(actorOf(req), {
      jobId: input.jobId,
      fullName: input.fullName,
      phone: input.phone,
      countryCode: input.countryCode,
      email: input.email,
      resumeText,
    });
  }

  @RequirePermission('candidates.export')
  @Get(':id/export')
  async export(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const actor = actorOf(req);
    const row = await this.candidates.exportRecord(actor, parse(Uuid, id));
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'authz.sensitive_access',
      metadata: {
        permission: 'candidates.export',
        method: req.method,
        url: req.url,
        candidateId: row.id,
      },
    });
    return {
      exportedAt: new Date().toISOString(),
      candidate: row,
    };
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

  @RequirePermission('candidates.delete')
  @Delete(':id')
  @HttpCode(200)
  async remove(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const actor = actorOf(req);
    const candidateId = parse(Uuid, id);
    await this.candidates.delete(actor, candidateId);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'candidates.deleted',
      metadata: { candidateId },
    });
    return { deleted: true };
  }
}
