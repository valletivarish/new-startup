/**
 * Tool catalogue endpoints.
 *
 * Reading the catalogue is `agents.read`; changing it — installing, enabling,
 * granting to an agent — is `agents.update`. Which tools an agent may call is
 * agent configuration, so it is gated by the permission that governs agent
 * configuration. Phase 4 introduces no new permissions.
 *
 * Reading tool executions is `agents.sessions.read`: an execution record
 * belongs to a conversation, and conversation contents are already treated as
 * sensitive by the matrix.
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
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { TOOLS_SERVICE } from '../tokens.more.js';
import type { ToolsService } from './tools.service.js';

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ??
      (() => {
        throw ApiError.unauthorized();
      })(),
  );
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
  };
}

const Uuid = z.string().uuid();
const SetEnabled = z.object({ enabled: z.boolean() }).strict();
const GrantInput = z.object({ toolId: z.string().uuid() }).strict();

@Controller('tools')
export class ToolsController {
  constructor(@Inject(TOOLS_SERVICE) private readonly tools: ToolsService) {}

  @RequirePermission('agents.read')
  @Get()
  async list(@Req() req: RequestWithAuth) {
    return { tools: await this.tools.list(actorOf(req)) };
  }

  /** Copies the built-in declarations into this organization's catalogue. */
  @RequirePermission('agents.update')
  @Post('install-builtins')
  async install(@Req() req: RequestWithAuth) {
    return { tools: await this.tools.installBuiltIns(actorOf(req)) };
  }

  @RequirePermission('agents.update')
  @Patch(':id')
  async setEnabled(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(SetEnabled, body);
    await this.tools.setEnabled(actorOf(req), parse(Uuid, id), input.enabled);
    return { updated: true };
  }
}

@Controller('agents/:agentId/tools')
export class AgentToolsController {
  constructor(@Inject(TOOLS_SERVICE) private readonly tools: ToolsService) {}

  @RequirePermission('agents.read')
  @Get()
  async list(@Req() req: RequestWithAuth, @Param('agentId') agentId: string) {
    return {
      tools: await this.tools.listForAgent(actorOf(req), parse(Uuid, agentId)),
    };
  }

  @RequirePermission('agents.update')
  @Post()
  async grant(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ) {
    const input = parse(GrantInput, body);
    await this.tools.grant(actorOf(req), parse(Uuid, agentId), input.toolId);
    return { granted: true };
  }

  @RequirePermission('agents.update')
  @Delete(':toolId')
  async revoke(
    @Req() req: RequestWithAuth,
    @Param('agentId') agentId: string,
    @Param('toolId') toolId: string,
  ) {
    await this.tools.revoke(
      actorOf(req),
      parse(Uuid, agentId),
      parse(Uuid, toolId),
    );
    return { revoked: true };
  }
}

@Controller('sessions/:sessionId/tool-executions')
export class ToolExecutionsController {
  constructor(@Inject(TOOLS_SERVICE) private readonly tools: ToolsService) {}

  @RequirePermission('agents.sessions.read')
  @Get()
  async list(@Req() req: RequestWithAuth, @Param('sessionId') sessionId: string) {
    return {
      executions: await this.tools.listExecutions(
        actorOf(req),
        parse(Uuid, sessionId),
      ),
    };
  }
}
