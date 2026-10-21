/**
 * Support routes, one controller per door:
 *   /support/*          dashboard (session; any member: support.use)
 *   /v1/tickets         API keys with the `support` scope (SDK, MCP)
 *   /admin/support/*    the founder's inbox (PLATFORM_ADMIN_EMAILS; 404 for anyone else)
 *   /public/support/*   logged-out website/docs chat (per-IP rate limits, email required)
 *   /webhooks/inbound-email  signed inbound email (INBOUND_EMAIL_SECRET)
 */

import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '@platform/db';

import { Authenticated, Public, RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import type { Env } from '../config.js';
import type { CostService } from '../costs/costs.service.js';
import { ApiError } from '../errors.js';
import { withIdempotency } from '../integrations/idempotency.js';
import { decodeCursor, PaginationQuery, toPage } from '../pagination.js';
import { DATABASE, ENV } from '../tokens.js';
import { COST_SERVICE, SUPPORT_SERVICE } from '../tokens.more.js';
import { parse } from '../validate.js';
import { V1TicketCreate, V1TicketMessageCreate } from '../integrations/v1-schemas.js';
import { verifyInboundSignature } from './inbound-email.js';
import { TICKET_STATUSES, type SupportActor, type SupportService } from './support.service.js';

const Id = z.string().uuid();
const Token = z.string().regex(/^[0-9A-Za-z]{32}$/);
const Body_ = z.string().trim().min(1).max(5000);

const DashboardCreate = V1TicketCreate.extend({ channel: z.enum(['dashboard', 'chat']).default('dashboard') });
const V1MessageCreate = V1TicketMessageCreate;
const PublicCreate = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  body: Body_,
});
const AdminFilter = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  unassigned: z.enum(['1', 'true']).optional(),
});
const StatusBody = z.object({ status: z.enum(TICKET_STATUSES) });
const LinkBody = z.object({ organizationId: Id });
const InboundMail = z.object({
  from: z.string().min(3).max(500),
  to: z.union([z.string().max(2000), z.array(z.string().max(500)).max(50)]),
  subject: z.string().max(1000).default(''),
  text: z.string().max(200_000).default(''),
  inReplyTo: z.string().max(1000).optional(),
});

/** Per IP: a visitor opens a few chats, polls every 4 s, and types at human speed. */
const CREATE_LIMIT = { rateLimit: { max: 5, timeWindow: '10 minutes' } };
const POLL_LIMIT = { rateLimit: { max: 40, timeWindow: '1 minute' } };
const REPLY_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function actorOf(req: RequestWithAuth): SupportActor {
  const ctx = requireOrganization(req.authContext ?? (() => { throw ApiError.unauthorized(); })());
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
    email: ctx.userEmail,
    name: ctx.userName,
  };
}

const related = (i: { jobId?: string | undefined; candidateId?: string | undefined; callId?: string | undefined }) => ({
  ...(i.jobId ? { jobId: i.jobId } : {}),
  ...(i.candidateId ? { candidateId: i.candidateId } : {}),
  ...(i.callId ? { callId: i.callId } : {}),
});

@Controller('support')
export class SupportController {
  constructor(@Inject(SUPPORT_SERVICE) private readonly support: SupportService) {}

  @Post('tickets')
  @RequirePermission('support.use')
  async create(@Req() req: RequestWithAuth, @Res({ passthrough: true }) reply: FastifyReply, @Body() body: unknown) {
    const input = parse(DashboardCreate, body);
    void reply.status(201);
    return this.support.create(actorOf(req), { subject: input.subject, body: input.body, channel: input.channel, ...related(input) });
  }

  /** The signed-in person's own tickets, newest first. */
  @Get('tickets')
  @RequirePermission('support.use')
  async list(@Req() req: RequestWithAuth) {
    const rows = await this.support.list(actorOf(req), { mine: true, limit: 100 });
    return { tickets: rows.slice(0, 100).map(({ created_at: _c, ...t }) => t) };
  }

  @Get('tickets/:id')
  @RequirePermission('support.use')
  get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.support.get(actorOf(req), parse(Id, id));
  }

  @Post('tickets/:id/messages')
  @RequirePermission('support.use')
  async reply(@Req() req: RequestWithAuth, @Res({ passthrough: true }) res: FastifyReply, @Param('id') id: string, @Body() body: unknown) {
    const { body: text } = parse(V1MessageCreate, body);
    void res.status(201);
    return this.support.reply(actorOf(req), parse(Id, id), text);
  }

  @Post('tickets/:id/close')
  @RequirePermission('support.use')
  close(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.support.close(actorOf(req), parse(Id, id));
  }
}

@Controller('v1/tickets')
export class V1TicketsController {
  constructor(
    @Inject(SUPPORT_SERVICE) private readonly support: SupportService,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  @Post()
  @RequirePermission('support.use')
  async create(@Req() req: RequestWithAuth, @Res({ passthrough: true }) reply: FastifyReply, @Body() body: unknown) {
    const input = parse(V1TicketCreate, body);
    const a = actorOf(req);
    const out = await withIdempotency(this.database, a, req, async () => ({
      status: 201,
      body: await this.support.create(a, { subject: input.subject, body: input.body, channel: input.channel, ...related(input) }),
    }));
    void reply.status(out.status);
    return out.body;
  }

  /** The company's tickets, newest first (cursor pagination). */
  @Get()
  @RequirePermission('support.use')
  async list(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const { limit, cursor } = parse(PaginationQuery, query);
    const rows = await this.support.list(actorOf(req), {
      mine: false,
      limit,
      ...(cursor ? { cursor: decodeCursor(cursor) } : {}),
    });
    const page = toPage(rows, limit);
    return { tickets: page.items.map(({ created_at: _c, ...t }) => t), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequirePermission('support.use')
  get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.support.get(actorOf(req), parse(Id, id));
  }

  @Post(':id/messages')
  @RequirePermission('support.use')
  async reply(@Req() req: RequestWithAuth, @Res({ passthrough: true }) res: FastifyReply, @Param('id') rawId: string, @Body() body: unknown) {
    const id = parse(Id, rawId);
    const { body: text } = parse(V1MessageCreate, body);
    const a = actorOf(req);
    const out = await withIdempotency(this.database, a, req, async () => ({
      status: 201,
      body: await this.support.reply(a, id, text),
    }));
    void res.status(out.status);
    return out.body;
  }
}

@Controller('admin/support')
export class AdminSupportController {
  constructor(
    @Inject(SUPPORT_SERVICE) private readonly support: SupportService,
    @Inject(COST_SERVICE) private readonly costs: CostService,
  ) {}

  private admin(req: RequestWithAuth): { userId: string; email: string } {
    const ctx = req.authContext;
    if (!ctx) throw ApiError.unauthorized();
    if (!this.costs.isPlatformAdmin(ctx.userEmail)) throw ApiError.notFound('Page');
    return { userId: ctx.userId, email: ctx.userEmail };
  }

  @Authenticated()
  @Get('tickets')
  async list(@Req() req: RequestWithAuth, @Query() query: unknown) {
    const { userId } = this.admin(req);
    const f = parse(AdminFilter, query);
    return { tickets: await this.support.adminList(userId, { status: f.status, unassigned: Boolean(f.unassigned) }) };
  }

  @Authenticated()
  @Get('tickets/:id')
  get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.support.adminGet(this.admin(req).userId, parse(Id, id));
  }

  @Authenticated()
  @Post('tickets/:id/messages')
  async reply(@Req() req: RequestWithAuth, @Res({ passthrough: true }) res: FastifyReply, @Param('id') id: string, @Body() body: unknown) {
    const admin = this.admin(req);
    const { body: text } = parse(V1MessageCreate, body);
    void res.status(201);
    return this.support.adminReply(admin, parse(Id, id), text);
  }

  @Authenticated()
  @Patch('tickets/:id')
  setStatus(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: unknown) {
    const { userId } = this.admin(req);
    return this.support.adminSetStatus(userId, parse(Id, id), parse(StatusBody, body).status);
  }

  /** Give an unassigned (no-account) ticket to a company. */
  @Authenticated()
  @Post('tickets/:id/link')
  link(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: unknown) {
    const { userId } = this.admin(req);
    return this.support.adminLink(userId, parse(Id, id), parse(LinkBody, body).organizationId);
  }

  @Authenticated()
  @Get('organizations')
  async organizations(@Req() req: RequestWithAuth) {
    return { organizations: await this.support.adminOrganizations(this.admin(req).userId) };
  }
}

@Controller('public/support')
export class PublicSupportController {
  constructor(@Inject(SUPPORT_SERVICE) private readonly support: SupportService) {}

  /** Starts a chat. The token in the answer is the visitor's only key to it: keep it. */
  @Public()
  @RouteConfig(CREATE_LIMIT)
  @Post('chats')
  async create(@Res({ passthrough: true }) reply: FastifyReply, @Body() body: unknown) {
    const input = parse(PublicCreate, body);
    const out = await this.support.publicCreate(input);
    void reply.status(201);
    return out;
  }

  @Public()
  @RouteConfig(POLL_LIMIT)
  @Get('chats/:token')
  get(@Param('token') token: string) {
    return this.support.publicGet(this.token(token));
  }

  @Public()
  @RouteConfig(REPLY_LIMIT)
  @Post('chats/:token/messages')
  async reply(@Res({ passthrough: true }) res: FastifyReply, @Param('token') token: string, @Body() body: unknown) {
    const { body: text } = parse(V1MessageCreate, body);
    const out = await this.support.publicReply(this.token(token), text);
    void res.status(201);
    return out;
  }

  private token(raw: string): string {
    const parsed = Token.safeParse(raw);
    if (!parsed.success) throw ApiError.notFound('Chat');
    return parsed.data;
  }
}

@Controller('webhooks')
export class InboundEmailController {
  constructor(
    @Inject(SUPPORT_SERVICE) private readonly support: SupportService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Verified by HMAC signature (INBOUND_EMAIL_SECRET); 404 while no secret is set. */
  @Public()
  @Post('inbound-email')
  async inbound(@Req() req: FastifyRequest, @Body() body: unknown) {
    if (!this.env.INBOUND_EMAIL_SECRET) throw ApiError.notFound('Route');
    const header = req.headers['hrvoice-signature'];
    const raw = (req as { rawBody?: string }).rawBody ?? '';
    if (!verifyInboundSignature(this.env.INBOUND_EMAIL_SECRET, Array.isArray(header) ? header[0] : header, raw)) {
      throw ApiError.unauthorized('Bad signature');
    }
    return this.support.inboundEmail(parse(InboundMail, body));
  }
}
