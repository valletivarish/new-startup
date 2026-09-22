import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import type { Env } from '../config.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { AUDIT_SERVICE, ENV } from '../tokens.js';
import {
  CANDIDATES_SERVICE,
  JOBS_SERVICE,
  KNOWLEDGE_SERVICE,
  VOICE_SESSION_SERVICE,
} from '../tokens.more.js';
import type { AuditService } from '../audit/audit.service.js';
import type { KnowledgeService } from '../knowledge/knowledge.service.js';
import type { CandidateScreeningResults, JobsService } from './jobs.service.js';
import type { CandidatesService } from './candidates.service.js';
import type { VoiceSessionService } from '../providers/elevenlabs/voice-session.service.js';
import { assistJobDescription } from './jd-assist.js';
import {
  answerReviewQuestionWithLlm,
  scrubHireAdvice,
  streamReviewQuestionWithLlm,
} from './review-chat.js';

function orgPermissions(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ?? (() => { throw ApiError.unauthorized(); })(),
  );
  return ctx.organization.permissions;
}

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
  if (!orgPermissions(req).has('candidates.read')) {
    throw ApiError.forbidden();
  }
}

function canReadPii(req: RequestWithAuth): boolean {
  return orgPermissions(req).has('candidates.read_pii');
}

function canReadTranscript(req: RequestWithAuth): boolean {
  return orgPermissions(req).has('calls.read_transcript');
}

function canReadRecording(req: RequestWithAuth): boolean {
  return orgPermissions(req).has('calls.read_recording');
}

/** Analysts may see status/cost but not conversation content. */
function redactScreeningResults(
  results: CandidateScreeningResults,
  allowTranscript: boolean,
  allowRecording: boolean,
): CandidateScreeningResults {
  return {
    ...results,
    transcript: allowTranscript ? results.transcript : null,
    summary:
      allowTranscript && results.summary
        ? scrubHireAdvice(results.summary)
        : allowTranscript
          ? results.summary
          : null,
    structuredAnswers: allowTranscript ? results.structuredAnswers : null,
    // Fit % is derived from answers — hide with transcript ACL.
    fitPercent: allowTranscript ? results.fitPercent : null,
    recordingAvailable: allowRecording ? results.recordingAvailable : false,
  };
}

const Uuid = z.string().uuid();

const MustAskQuestions = z.array(z.string().trim().min(1).max(300)).max(30);

const CreateJob = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    agentId: z.string().uuid().optional(),
    mustAskQuestions: MustAskQuestions.optional(),
    screeningLanguage: z.enum(['en', 'hi']).optional(),
  })
  .strict();

const UpdateJob = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(['draft', 'open', 'closed']).optional(),
    agentId: z.string().uuid().nullable().optional(),
    mustAskQuestions: MustAskQuestions.optional(),
    screeningLanguage: z.enum(['en', 'hi']).optional(),
  })
  .strict();

const AttachJobKnowledge = z
  .object({
    sourceId: z.string().uuid(),
  })
  .strict();

const JdAssistBody = z
  .object({
    mode: z.enum(['generate', 'format', 'questions']),
    notes: z.string(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const JdTextBody = z
  .object({
    text: z.string().trim().min(20).max(40_000),
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
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const BulkUpdateAssignmentStatus = z
  .object({
    updates: z
      .array(
        z
          .object({
            candidateId: z.string().uuid(),
            status: z.enum(['new', 'screening', 'reviewed']),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const ImportPreviewBody = z
  .object({
    csvText: z.string().min(1).max(2_000_000),
  })
  .strict();

const ImportConfirmBody = z
  .object({
    rows: z
      .array(
        z
          .object({
            fullName: z.string().trim().min(1).max(200),
            countryCode: z.string().trim().min(1).max(8),
            phone: z.string().trim().min(1).max(30),
            email: z.string().trim().email().max(320).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();

@Controller('jobs')
export class JobsController {
  constructor(
    @Inject(JOBS_SERVICE) private readonly jobs: JobsService,
    @Inject(CANDIDATES_SERVICE) private readonly candidates: CandidatesService,
    @Inject(VOICE_SESSION_SERVICE) private readonly voice: VoiceSessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(KNOWLEDGE_SERVICE) private readonly knowledge: KnowledgeService,
  ) {}

  private async auditTranscriptAccess(req: RequestWithAuth): Promise<void> {
    const actor = actorOf(req);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'authz.sensitive_access',
      metadata: {
        permission: 'calls.read_transcript',
        method: req.method,
        url: req.url,
      },
    });
  }

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

  /** List JD / role docs attached to this job (call auto-resolves these — no picker). */
  @RequirePermission('jobs.read')
  @Get(':id/knowledge')
  async listKnowledge(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return {
      sources: await this.jobs.listKnowledge(actorOf(req), parse(Uuid, id)),
    };
  }

  /** Attach a knowledge source (JD) to the job during screening setup. */
  @RequirePermission('jobs.update')
  @Post(':id/knowledge')
  @HttpCode(201)
  async attachKnowledge(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(AttachJobKnowledge, body);
    await this.jobs.attachKnowledge(
      actorOf(req),
      parse(Uuid, id),
      input.sourceId,
    );
    return { attached: true };
  }

  /**
   * Generate or format a job description via Gemini.
   * Does not persist — HR reviews in the textarea then saves via jd/text.
   */
  @RequirePermission('jobs.update')
  @Post(':jobId/jd/assist')
  @HttpCode(200)
  async assistJd(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(JdAssistBody, body);
    const actor = actorOf(req);
    const job = await this.jobs.get(actor, parse(Uuid, jobId));
    const language = job.screeningLanguage === 'hi' ? 'hi' : 'en';
    return assistJobDescription(
      {
        mode: input.mode,
        title: input.title?.trim() || job.title,
        notes: input.notes,
        language,
      },
      {
        apiKey: this.env.GEMINI_API_KEY,
        model: this.env.GEMINI_MODEL,
      },
    );
  }

  /**
   * Save typed/pasted JD as a text/plain knowledge document and attach to the job.
   * Also writes `jobs.description` so list + reopen show the same text.
   */
  @RequirePermission('jobs.update')
  @Post(':jobId/jd/text')
  @HttpCode(201)
  async saveJdText(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(JdTextBody, body);
    const actor = actorOf(req);
    const jobUuid = parse(Uuid, jobId);
    const job = await this.jobs.get(actor, jobUuid);

    // Persist on the job row — reopen + Jobs list read this field.
    await this.jobs.update(actor, jobUuid, { description: input.text });

    const attached = await this.jobs.listKnowledge(actor, jobUuid);
    let sourceId = attached[0]?.id;

    if (!sourceId) {
      const ref = jobUuid.replace(/-/g, '').slice(0, 8).toUpperCase();
      const preferred = `${job.title} description · ${ref}`;
      const legacy = `${job.title} description`;
      try {
        const created = await this.knowledge.createSource(actor, {
          name: preferred,
          description: 'Job description and role docs for screening',
        });
        sourceId = created.id;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'conflict') {
          throw error;
        }
        const sources = await this.knowledge.listSources(actor);
        const match =
          sources.find((s) => s.name === preferred) ??
          sources.find((s) => s.name === legacy);
        if (!match) throw error;
        sourceId = match.id;
      }
    }

    const document = await this.knowledge.createDocument(actor, {
      sourceId,
      name: 'job-description.txt',
      contentType: 'text/plain',
      content: input.text,
      contentEncoding: 'utf8',
    });
    await this.jobs.attachKnowledge(actor, jobUuid, sourceId);
    return { sourceId, documentId: document.id };
  }

  /**
   * Parse CSV/paste text into normalized candidate rows with validation flags.
   * Job context is the path — HR never re-selects JD here.
   */
  @RequirePermission('candidates.create')
  @Post(':jobId/candidates/import/preview')
  @HttpCode(200)
  async previewCandidateImport(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(ImportPreviewBody, body);
    return this.candidates.previewImport(
      actorOf(req),
      parse(Uuid, jobId),
      input.csvText,
    );
  }

  /**
   * Create candidates for valid confirmed rows only. Invalid rows are skipped
   * and returned with issues so HR can fix and re-confirm.
   */
  @RequirePermission('candidates.create')
  @Post(':jobId/candidates/import/confirm')
  @HttpCode(201)
  async confirmCandidateImport(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(ImportConfirmBody, body);
    return this.candidates.confirmImport(
      actorOf(req),
      parse(Uuid, jobId),
      input.rows,
    );
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
    @Query() query: unknown,
  ) {
    requireCandidatesRead(req);
    const includePhone = canReadPii(req);
    if (includePhone) {
      await this.auditPiiAccess(req);
    }
    const ListQuery = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().max(500).optional(),
      status: z.enum(['new', 'screening', 'reviewed']).optional(),
      q: z.string().trim().min(1).max(120).optional(),
    });
    const q = parse(ListQuery, query ?? {});
    const page = await this.jobs.listCandidates(actorOf(req), parse(Uuid, jobId), {
      limit: q.limit,
      cursor: q.cursor,
      status: q.status,
      q: q.q,
    });
    return {
      candidates: page.candidates.map((row) => ({
        id: row.id,
        candidateId: row.candidateId,
        status: row.status,
        callStatus: row.callStatus,
        callReceived: row.callReceived,
        candidate: {
          id: row.candidateId,
          fullName: row.fullName,
          source: row.source,
          ...(includePhone ? { phone: row.phone } : {}),
        },
      })),
      nextCursor: page.nextCursor,
      totals: page.totals,
    };
  }

  @RequirePermission('jobs.read')
  @Get(':jobId/candidates/:candidateId/results')
  async getCandidateResults(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
  ) {
    requireCandidatesRead(req);
    const actor = actorOf(req);
    const jobUuid = parse(Uuid, jobId);
    const candidateUuid = parse(Uuid, candidateId);
    let packet = await this.jobs.getCandidateResults(actor, jobUuid, candidateUuid);

    // Pull the latest transcript/summary/answers if the screen finished but
    // results have not landed yet (webhook delay or missed end).
    const latest = packet.results;
    const answersMissing =
      latest.structuredAnswers == null ||
      Object.keys(latest.structuredAnswers).length === 0;
    if (
      latest.voiceSessionId &&
      latest.status !== 'failed' &&
      (latest.transcript == null ||
        latest.summary == null ||
        (latest.status === 'ended' && answersMissing))
    ) {
      try {
        await this.voice.reconcileVoiceSession(actor, latest.voiceSessionId);
        packet = await this.jobs.getCandidateResults(actor, jobUuid, candidateUuid);
      } catch {
        // Keep whatever we already have — viewing results must not fail hard.
      }
    }

    const allowTranscript = canReadTranscript(req);
    const allowRecording = canReadRecording(req);
    if (allowTranscript) {
      await this.auditTranscriptAccess(req);
    }
    return {
      results: redactScreeningResults(packet.results, allowTranscript, allowRecording),
      sessions: packet.sessions.map((s) =>
        redactScreeningResults(s, allowTranscript, allowRecording),
      ),
    };
  }

  /**
   * Ask about screening results using only stored call facts.
   * Never recommends hire/reject. Requires transcript ACL.
   */
  @RequirePermission('jobs.read')
  @Post(':jobId/candidates/:candidateId/review-chat')
  @HttpCode(200)
  async reviewChat(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ) {
    requireCandidatesRead(req);
    if (!canReadTranscript(req)) {
      throw ApiError.forbidden();
    }
    await this.auditTranscriptAccess(req);
    const input = parse(
      z
        .object({
          message: z.string().trim().min(1).max(2000),
          voiceSessionId: z.string().uuid().optional(),
        })
        .strict(),
      body ?? {},
    );
    const actor = actorOf(req);
    const packet = await this.jobs.getCandidateResults(
      actor,
      parse(Uuid, jobId),
      parse(Uuid, candidateId),
    );
    const answered = await answerReviewQuestionWithLlm(
      packet.sessions,
      input.message,
      input.voiceSessionId,
      {
        apiKey: this.env.GEMINI_API_KEY,
        model: this.env.GEMINI_MODEL,
      },
    );
    return answered;
  }

  /**
   * Streaming review chat (SSE). Same facts/rules as review-chat;
   * deltas arrive as the model writes so the desk feels instant.
   */
  @RequirePermission('jobs.read')
  @Post(':jobId/candidates/:candidateId/review-chat/stream')
  async reviewChatStream(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: false }) reply: FastifyReply,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ) {
    requireCandidatesRead(req);
    if (!canReadTranscript(req)) {
      throw ApiError.forbidden();
    }
    await this.auditTranscriptAccess(req);
    const input = parse(
      z
        .object({
          message: z.string().trim().min(1).max(2000),
          voiceSessionId: z.string().uuid().optional(),
        })
        .strict(),
      body ?? {},
    );
    const actor = actorOf(req);
    const packet = await this.jobs.getCandidateResults(
      actor,
      parse(Uuid, jobId),
      parse(Uuid, candidateId),
    );

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const writeEvent = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      for await (const event of streamReviewQuestionWithLlm(
        packet.sessions,
        input.message,
        input.voiceSessionId,
        {
          apiKey: this.env.GEMINI_API_KEY,
          model: this.env.GEMINI_MODEL,
        },
      )) {
        writeEvent(event);
      }
    } catch {
      writeEvent({
        type: 'done',
        reply: 'Could not answer that right now. Try again in a moment.',
        voiceSessionId: null,
      });
    }
    reply.raw.end();
  }

  /**
   * Live phone outbound for a job/candidate. Requires outbound phone config.
   * Never pretends a call was placed when the line is not connected.
   * Recruiters hold calls.initiate (not agents.test) for day-to-day screens.
   */
  @RequirePermission('calls.initiate')
  @Post(':jobId/candidates/:candidateId/outbound-call')
  @HttpCode(201)
  async startOutboundCall(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
  ) {
    const actor = actorOf(req);
    const job = await this.jobs.get(actor, parse(Uuid, jobId));
    if (!job.agentId) {
      throw ApiError.conflict(
        'Link a hiring agent to this job before placing a phone call.',
      );
    }
    return this.voice.startOutboundPhoneCall(actor, job.agentId, {
      jobId: job.id,
      candidateId: parse(Uuid, candidateId),
    });
  }

  @RequirePermission('candidates.read')
  @Get(':jobId/candidates/:candidateId/stage-history')
  async candidateStageHistory(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Param('candidateId') candidateId: string,
  ) {
    const events = await this.jobs.listCandidateStageHistory(
      actorOf(req),
      parse(Uuid, jobId),
      parse(Uuid, candidateId),
    );
    return { events };
  }

  @RequirePermission('jobs.update')
  @Post(':jobId/candidates/bulk-status')
  async bulkUpdateCandidateStatus(
    @Req() req: RequestWithAuth,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    const input = parse(BulkUpdateAssignmentStatus, body);
    const jobUuid = parse(Uuid, jobId);
    const actor = actorOf(req);
    const results = await this.jobs.updateCandidateStatuses(
      actor,
      jobUuid,
      input.updates,
    );
    await Promise.all(
      results.map((row) =>
        this.audit.record({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          eventType: 'hiring.candidate_status_changed',
          resourceType: 'candidate',
          resourceId: row.candidateId,
          metadata: {
            jobId: jobUuid,
            from: row.previous,
            to: row.status,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        }),
      ),
    );
    return { updated: results.length, results };
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
    const jobUuid = parse(Uuid, jobId);
    const candidateUuid = parse(Uuid, candidateId);
    const actor = actorOf(req);
    const result = await this.jobs.updateCandidateStatus(
      actor,
      jobUuid,
      candidateUuid,
      input.status,
    );
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'hiring.candidate_status_changed',
      resourceType: 'candidate',
      resourceId: candidateUuid,
      metadata: {
        jobId: jobUuid,
        from: result.previous,
        to: result.status,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
    return { updated: true, previous: result.previous, status: result.status };
  }
}
