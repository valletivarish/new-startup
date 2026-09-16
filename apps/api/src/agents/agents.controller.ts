/**
 * Agent, version, session, event, and runtime endpoints.
 *
 * Every route declares exactly one permission marker (the guard fails closed
 * without one, and the route-coverage test fails the build). Resource lookups
 * are always scoped to the caller's organization, so a foreign id is a 404
 * rather than a 403 — existence is not probeable.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { RequireAnyPermission, RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import {
  AGENTS_SERVICE,
  AGENT_RUNTIME,
  SESSIONS_SERVICE,
} from '../tokens.more.js';
import type { AgentsService } from './agents.service.js';
import { listEnabledPacks } from './packs/index.js';
import type { SessionsService } from './sessions.service.js';
import type { AgentRuntime } from '@platform/providers';
import { InboundEventInput } from './events.js';

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

const CreateAgent = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    purpose: z.string().trim().min(1).max(2000).optional(),
    type: z.string().trim().max(64).optional(),
    agentType: z
      .enum(['hiring', 'support', 'sales', 'appointments', 'reminders', 'custom'])
      .default('hiring'),
    mustAskQuestions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
    transferPhones: z.array(z.string().trim().min(5).max(20)).max(10).default([]),
    knowledgeSourceIds: z
      .array(z.string().uuid())
      .max(100)
      .default([])
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

const UpdateAgent = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  purpose: z.string().trim().min(1).max(2000).optional(),
});

@Controller('agents')
export class AgentsController {
  constructor(
    @Inject(AGENTS_SERVICE) private readonly agents: AgentsService,
  ) {}

  // ---- Agents -------------------------------------------------------------

  @RequirePermission('agents.read')
  @Get()
  async list(@Req() req: RequestWithAuth) {
    return { agents: await this.agents.list(actorOf(req)) };
  }

  @RequireAnyPermission('agents.read', 'agents.create')
  @Get('packs')
  listPacks() {
    return { packs: listEnabledPacks() };
  }

  @RequirePermission('agents.create')
  @Post()
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    return this.agents.create(actorOf(req), parse(CreateAgent, body));
  }

  @RequirePermission('agents.read')
  @Get(':id')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.agents.get(actorOf(req), parse(Uuid, id));
  }

  @RequirePermission('agents.update')
  @Patch(':id')
  async update(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.agents.update(actorOf(req), parse(Uuid, id), parse(UpdateAgent, body));
    return { updated: true };
  }

  // Lifecycle transitions are separate endpoints, not a PATCH of `status`:
  // each carries its own permission, and publishing is not the same
  // authority as pausing.

  @RequirePermission('agents.deploy')
  @Post(':id/publish')
  async publishAgent(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.agents.transition(actorOf(req), parse(Uuid, id), 'published');
    return { status: 'published' };
  }

  @RequirePermission('agents.pause')
  @Post(':id/pause')
  async pause(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.agents.transition(actorOf(req), parse(Uuid, id), 'paused');
    return { status: 'paused' };
  }

  @RequirePermission('agents.archive')
  @Post(':id/archive')
  async archive(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.agents.transition(actorOf(req), parse(Uuid, id), 'archived');
    return { status: 'archived' };
  }

  // ---- Knowledge association ---------------------------------------------
  //
  // Knowledge is REFERENCED, never copied: one organization source can back
  // several agents, each keeping its own configuration.

  @RequirePermission('agents.read')
  @Get(':id/knowledge')
  async listKnowledge(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { sources: await this.agents.listKnowledge(actorOf(req), parse(Uuid, id)) };
  }

  @RequirePermission('agents.update')
  @Post(':id/knowledge')
  async attachKnowledge(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ sourceId: z.string().uuid() }), body);
    await this.agents.attachKnowledge(actorOf(req), parse(Uuid, id), input.sourceId);
    return { attached: true };
  }

  @RequirePermission('agents.update')
  @Delete(':id/knowledge/:sourceId')
  async detachKnowledge(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
  ) {
    await this.agents.detachKnowledge(
      actorOf(req),
      parse(Uuid, id),
      parse(Uuid, sourceId),
    );
    return { detached: true };
  }

  // ---- Versions -----------------------------------------------------------

  @RequirePermission('agents.read')
  @Get(':id/versions')
  async listVersions(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { versions: await this.agents.listVersions(actorOf(req), parse(Uuid, id)) };
  }

  @RequirePermission('agents.read')
  @Get(':id/versions/:versionId')
  async getVersion(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.agents.getVersion(actorOf(req), parse(Uuid, id), parse(Uuid, versionId));
  }

  /** Creating a draft version IS updating the agent — hence agents.update. */
  @RequirePermission('agents.update')
  @Post(':id/versions')
  async createDraft(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ configuration: z.unknown() }), body);
    return this.agents.createDraft(actorOf(req), parse(Uuid, id), input.configuration);
  }

  @RequirePermission('agents.update')
  @Patch(':id/versions/:versionId')
  async updateDraft(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ configuration: z.unknown() }), body);
    await this.agents.updateDraft(
      actorOf(req),
      parse(Uuid, id),
      parse(Uuid, versionId),
      input.configuration,
    );
    return { updated: true };
  }

  /** Publishing a version is deploying it — the existing agents.deploy. */
  @RequirePermission('agents.deploy')
  @Post(':id/versions/:versionId/publish')
  async publishVersion(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    await this.agents.publish(actorOf(req), parse(Uuid, id), parse(Uuid, versionId));
    return { published: true };
  }
}

@Controller('sessions')
export class AgentSessionsController {
  constructor(
    @Inject(SESSIONS_SERVICE) private readonly sessions: SessionsService,
    @Inject(AGENT_RUNTIME) private readonly runtime: AgentRuntime,
  ) {}

  @RequirePermission('agents.sessions.manage')
  @Post()
  async create(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const input = parse(
      z.object({
        agentId: z.string().uuid(),
        channel: z.enum(['text']).optional(),
        businessContext: z.record(z.string(), z.unknown()).optional(),
        correlationId: z.string().trim().max(200).optional(),
      }),
      body,
    );
    return this.sessions.create(actorOf(req), input);
  }

  @RequirePermission('agents.sessions.read')
  @Get()
  async list(@Req() req: RequestWithAuth, @Query('agentId') agentId?: string) {
    const filter = agentId ? parse(Uuid, agentId) : undefined;
    return { sessions: await this.sessions.list(actorOf(req), filter) };
  }

  @RequirePermission('agents.sessions.read')
  @Get(':id')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.sessions.get(actorOf(req), parse(Uuid, id));
  }

  @RequirePermission('agents.sessions.manage')
  @Delete(':id')
  async end(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(
      z.object({ reason: z.string().trim().max(60).default('completed') }),
      body ?? {},
    );
    await this.sessions.end(actorOf(req), parse(Uuid, id), input.reason);
    return { ended: true };
  }

  @RequirePermission('agents.sessions.read')
  @Get(':id/events')
  async events(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { events: await this.sessions.listEvents(actorOf(req), parse(Uuid, id)) };
  }

  /**
   * Ingest an inbound event and run it through the runtime.
   *
   * This is the single entry point a text client, and later a voice gateway,
   * uses to advance a conversation.
   */
  @RequirePermission('agents.sessions.manage')
  @Post(':id/events')
  async ingest(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(InboundEventInput, body);
    const result = await this.runtime.process(actorOf(req), parse(Uuid, id), {
      type: input.type,
      payload: input.payload,
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
      ...(input.correlationId !== undefined
        ? { correlationId: input.correlationId }
        : {}),
    });
    return {
      inboundEvent: result.inboundEvent,
      outboundEvents: result.outboundEvents,
      deduplicated: result.deduplicated,
    };
  }
}
