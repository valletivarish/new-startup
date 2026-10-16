/** Public /v1 jobs and candidates for API-key clients. Thin layer over the dashboard services. */

import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '@platform/db';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import type { CandidatesService } from '../hiring/candidates.service.js';
import type { JobsService } from '../hiring/jobs.service.js';
import { PaginationQuery } from '../pagination.js';
import { DATABASE } from '../tokens.js';
import { CANDIDATES_SERVICE, JOBS_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import { withIdempotency } from './idempotency.js';
import { toV1Candidate, toV1Job } from './public-mappers.js';
import { V1CandidateBatch, V1CandidateCreate, V1JobCreate, V1JobPatch } from './v1-schemas.js';

const Id = z.string().uuid();

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
    isTest: ctx.apiKey?.mode === 'test',
    pii: ctx.organization.permissions.has('candidates.read_pii'),
  };
}

/** Consent is checked first so a missing flag is `consent_required`, not a generic 422. */
function assertConsent(items: unknown[]): void {
  for (const item of items) {
    if ((item as { consent?: unknown } | null)?.consent !== true) throw ApiError.consentRequired();
  }
}

@Controller('v1/jobs')
export class V1JobsController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(JOBS_SERVICE) private readonly jobs: JobsService,
    @Inject(CANDIDATES_SERVICE) private readonly candidates: CandidatesService,
  ) {}

  /** Runs `handler` under the Idempotency-Key header and writes the status it returns. */
  private async write(
    req: RequestWithAuth,
    reply: FastifyReply,
    handler: () => Promise<{ status: number; body: unknown }>,
  ) {
    const a = actorOf(req);
    const out = await withIdempotency(this.database, a, req, handler);
    void reply.status(out.status);
    return out.body;
  }

  @Get()
  @RequirePermission('jobs.read')
  async list(@Req() req: RequestWithAuth) {
    const a = actorOf(req);
    return { jobs: (await this.jobs.list(a)).map(toV1Job) };
  }

  @Post()
  @RequirePermission('jobs.create')
  create(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parse(V1JobCreate, body);
    const a = actorOf(req);
    return this.write(req, reply, async () => {
      const { id } = await this.jobs.create(a, {
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.mustAskQuestions ? { mustAskQuestions: input.mustAskQuestions } : {}),
        ...(input.language ? { screeningLanguage: input.language } : {}),
        isTest: a.isTest,
        autoLinkAgent: true,
      });
      return { status: 201, body: toV1Job(await this.jobs.get(a, id)) };
    });
  }

  @Get(':id')
  @RequirePermission('jobs.read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return toV1Job(await this.jobs.get(actorOf(req), parse(Id, id)));
  }

  @Patch(':id')
  @RequirePermission('jobs.update')
  patch(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const id = parse(Id, rawId);
    const input = parse(V1JobPatch, body);
    const a = actorOf(req);
    return this.write(req, reply, async () => {
      await this.jobs.update(a, id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.mustAskQuestions ? { mustAskQuestions: input.mustAskQuestions } : {}),
        ...(input.language ? { screeningLanguage: input.language } : {}),
      });
      return { status: 200, body: toV1Job(await this.jobs.get(a, id)) };
    });
  }

  /** One candidate, or `{ candidates: [...] }` (1..100). Same externalId on a job updates in place. */
  @Post(':jobId/candidates')
  @RequirePermission('candidates.create')
  addCandidates(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('jobId') rawJobId: string,
    @Body() body: unknown,
  ) {
    const jobId = parse(Id, rawJobId);
    const isBatch = Array.isArray((body as { candidates?: unknown } | null)?.candidates);
    assertConsent(isBatch ? (body as { candidates: unknown[] }).candidates : [body]);
    const items = isBatch
      ? parse(V1CandidateBatch, body).candidates
      : [parse(V1CandidateCreate, body)];
    const a = actorOf(req);

    return this.write(req, reply, async () => {
      const results = await this.candidates.createBatch(
        a,
        items.map((c) => ({
          jobId,
          fullName: c.fullName,
          countryCode: c.countryCode,
          ...(c.phone ? { phone: c.phone } : {}),
          ...(c.email ? { email: c.email } : {}),
          ...(c.resumeText ? { resumeText: c.resumeText } : {}),
          ...(c.externalId ? { externalId: c.externalId } : {}),
          consentSource: 'customer' as const,
          isTest: a.isTest,
        })),
      );
      const out = [];
      for (const r of results) {
        out.push({
          ...toV1Candidate(await this.candidates.get(a, r.id), a.pii),
          created: r.created,
        });
      }
      return isBatch
        ? { status: 201, body: { candidates: out } }
        : { status: out[0]!.created ? 201 : 200, body: out[0] };
    });
  }

  @Get(':jobId/candidates')
  @RequirePermission('candidates.read')
  async listCandidates(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Query() query: unknown,
  ) {
    const q = parse(PaginationQuery, query);
    const a = actorOf(req);
    const page = await this.candidates.listPage(a, {
      jobId: parse(Id, jobId),
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
    });
    return { candidates: page.candidates.map((c) => toV1Candidate(c, a.pii)), nextCursor: page.nextCursor };
  }

  @Get(':jobId/candidates/:id')
  @RequirePermission('candidates.read')
  async getCandidate(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Param('id') id: string,
  ) {
    const a = actorOf(req);
    const row = await this.candidates.get(a, parse(Id, id));
    if (row.jobId !== parse(Id, jobId)) throw ApiError.notFound('Candidate');
    return toV1Candidate(row, a.pii);
  }
}
