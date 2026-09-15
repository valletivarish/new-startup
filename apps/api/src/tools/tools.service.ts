/**
 * Tool catalogue management.
 *
 * Managing the catalogue is an AGENT-CONFIGURATION act, so it reuses
 * `agents.read` / `agents.update` rather than introducing new permissions.
 * Phase 4 adds none: every tool declares a `required_permission` drawn from
 * the existing 54, which keeps the matrix the single place where "who may do
 * what" is answered.
 *
 * Installation copies the built-in DECLARATIONS into the organization's
 * catalogue. It never copies code — the implementation always resolves by name
 * from `builtin-tools.ts`, so a row can enable or disable a tool but can never
 * define one.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../agents/agents.service.js';
import { BUILT_IN_TOOLS } from './builtin-tools.js';
import type { ToolRecord, ToolRegistry } from './registry.js';

export interface ToolExecutionRow {
  readonly id: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly callId: string;
  readonly status: string;
  readonly denialReason: string | null;
  readonly durationMs: number | null;
  readonly outputChars: number | null;
  readonly createdAt: string;
}

export interface ToolsService {
  /** Idempotent: re-running refreshes descriptions and schemas in place. */
  installBuiltIns(actor: Actor): Promise<readonly ToolRecord[]>;
  list(actor: Actor): Promise<readonly ToolRecord[]>;
  setEnabled(actor: Actor, toolId: string, enabled: boolean): Promise<void>;
  listForAgent(actor: Actor, agentId: string): Promise<readonly ToolRecord[]>;
  grant(actor: Actor, agentId: string, toolId: string): Promise<void>;
  revoke(actor: Actor, agentId: string, toolId: string): Promise<void>;
  listExecutions(
    actor: Actor,
    sessionId: string,
  ): Promise<readonly ToolExecutionRow[]>;
}

export function createToolsService(
  database: Database,
  registry: ToolRegistry,
  audit: AuditService,
): ToolsService {
  const write = <T>(actor: Actor, run: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(
      database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      run,
    );

  /** Confirms the agent belongs to this organization. A foreign id is a 404. */
  async function assertAgent(actor: Actor, agentId: string): Promise<void> {
    const found = await write(actor, async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        select id from agents
        where id = ${agentId} and organization_id = ${actor.organizationId}
        limit 1
      `);
      return rows[0] ?? null;
    });
    if (!found) throw ApiError.notFound('Agent');
  }

  async function assertTool(actor: Actor, toolId: string): Promise<string> {
    const found = await write(actor, async (tx) => {
      const rows = await tx.execute<{ id: string; name: string }>(sql`
        select id, name from tools
        where id = ${toolId} and organization_id = ${actor.organizationId}
        limit 1
      `);
      return rows[0] ?? null;
    });
    if (!found) throw ApiError.notFound('Tool');
    return found.name;
  }

  return {
    async installBuiltIns(actor) {
      await write(actor, async (tx) => {
        for (const tool of BUILT_IN_TOOLS) {
          await tx.execute(sql`
            insert into tools
              (organization_id, name, description, input_schema, output_schema,
               required_permission, enabled)
            values
              (${actor.organizationId}, ${tool.name}, ${tool.description},
               ${JSON.stringify(tool.inputSchema)}::jsonb,
               ${JSON.stringify(tool.outputSchema)}::jsonb,
               ${tool.requiredPermission}, true)
            on conflict (organization_id, name) do update set
              description = excluded.description,
              input_schema = excluded.input_schema,
              output_schema = excluded.output_schema,
              required_permission = excluded.required_permission,
              version = tools.version + 1,
              updated_at = now()
          `);
        }
      });

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'tools.installed',
        resourceType: 'tool',
        metadata: { count: BUILT_IN_TOOLS.length },
      });

      return registry.list(actor);
    },

    async list(actor) {
      return registry.list(actor);
    },

    async setEnabled(actor, toolId, enabled) {
      const name = await assertTool(actor, toolId);
      await write(actor, async (tx) => {
        await tx.execute(sql`
          update tools set enabled = ${enabled}, updated_at = now()
          where id = ${toolId} and organization_id = ${actor.organizationId}
        `);
      });
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: enabled ? 'tool.enabled' : 'tool.disabled',
        resourceType: 'tool',
        resourceId: toolId,
        metadata: { name },
      });
    },

    async listForAgent(actor, agentId) {
      await assertAgent(actor, agentId);
      return registry.listForAgent(actor, agentId);
    },

    async grant(actor, agentId, toolId) {
      await assertAgent(actor, agentId);
      const name = await assertTool(actor, toolId);
      await write(actor, async (tx) => {
        await tx.execute(sql`
          insert into agent_tools (organization_id, agent_id, tool_id)
          values (${actor.organizationId}, ${agentId}, ${toolId})
          on conflict (agent_id, tool_id) do nothing
        `);
      });
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.tool_granted',
        resourceType: 'agent',
        resourceId: agentId,
        metadata: { toolId, name },
      });
    },

    async revoke(actor, agentId, toolId) {
      await assertAgent(actor, agentId);
      await write(actor, async (tx) => {
        await tx.execute(sql`
          delete from agent_tools
          where agent_id = ${agentId} and tool_id = ${toolId}
            and organization_id = ${actor.organizationId}
        `);
      });
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.tool_revoked',
        resourceType: 'agent',
        resourceId: agentId,
        metadata: { toolId },
      });
    },

    async listExecutions(actor, sessionId) {
      return write(actor, async (tx) => {
        const rows = await tx.execute<{
          id: string;
          session_id: string;
          tool_name: string;
          call_id: string;
          status: string;
          denial_reason: string | null;
          duration_ms: number | null;
          output_chars: number | null;
          created_at: string;
        }>(sql`
          select id, session_id, tool_name, call_id, status, denial_reason,
                 duration_ms, output_chars, created_at
          from tool_executions
          where session_id = ${sessionId}
            and organization_id = ${actor.organizationId}
          order by created_at asc, id asc
        `);
        return rows.map((r) => ({
          id: r.id,
          sessionId: r.session_id,
          toolName: r.tool_name,
          callId: r.call_id,
          status: r.status,
          denialReason: r.denial_reason,
          durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
          outputChars: r.output_chars === null ? null : Number(r.output_chars),
          createdAt: r.created_at,
        }));
      });
    },
  };
}
