/**
 * The tool registry — what a given organization and agent may call.
 *
 * Every read goes through `withTenantContext`, so the RLS backstop applies in
 * addition to the explicit `organization_id` filter. A tool belonging to
 * another organization is not "forbidden" here; it simply does not exist, which
 * is the correct answer to give and the correct amount to reveal.
 *
 * The registry answers WHAT EXISTS. It never answers whether something may
 * run — that is the authorizer's job, deliberately kept in a separate file so
 * the two questions cannot be confused at a call site.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import type { Actor } from '../agents/agents.service.js';

export interface ToolRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly requiredPermission: string;
  readonly enabled: boolean;
  readonly version: number;
}

export interface ToolRegistry {
  /** Every tool declared for the organization. */
  list(actor: Actor): Promise<readonly ToolRecord[]>;
  get(actor: Actor, name: string): Promise<ToolRecord | null>;
  /** Only the tools this agent has been granted. */
  listForAgent(actor: Actor, agentId: string): Promise<readonly ToolRecord[]>;
  /** Tools granted to the agent that owns a session. */
  listForSession(actor: Actor, sessionId: string): Promise<readonly ToolRecord[]>;
}

type Row = {
  id: string;
  name: string;
  description: string;
  input_schema: unknown;
  output_schema: unknown;
  required_permission: string;
  enabled: boolean;
  version: string | number;
};

function toRecord(row: Row): ToolRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    requiredPermission: row.required_permission,
    enabled: row.enabled,
    version: Number(row.version),
  };
}

export function createToolRegistry(database: Database): ToolRegistry {
  const read = <T>(actor: Actor, run: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(
      database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      run,
    );

  return {
    async list(actor) {
      return read(actor, async (tx) => {
        const rows = await tx.execute<Row>(sql`
          select id, name, description, input_schema, output_schema,
                 required_permission, enabled, version
          from tools
          where organization_id = ${actor.organizationId}
          order by name
        `);
        return rows.map(toRecord);
      });
    },

    async get(actor, name) {
      return read(actor, async (tx) => {
        const rows = await tx.execute<Row>(sql`
          select id, name, description, input_schema, output_schema,
                 required_permission, enabled, version
          from tools
          where organization_id = ${actor.organizationId} and name = ${name}
          limit 1
        `);
        const row = rows[0];
        return row ? toRecord(row) : null;
      });
    },

    async listForAgent(actor, agentId) {
      return read(actor, async (tx) => {
        const rows = await tx.execute<Row>(sql`
          select t.id, t.name, t.description, t.input_schema, t.output_schema,
                 t.required_permission, t.enabled, t.version
          from tools t
          join agent_tools at on at.tool_id = t.id
          where t.organization_id = ${actor.organizationId}
            and at.organization_id = ${actor.organizationId}
            and at.agent_id = ${agentId}
          order by t.name
        `);
        return rows.map(toRecord);
      });
    },

    async listForSession(actor, sessionId) {
      return read(actor, async (tx) => {
        const rows = await tx.execute<Row>(sql`
          select t.id, t.name, t.description, t.input_schema, t.output_schema,
                 t.required_permission, t.enabled, t.version
          from tools t
          join agent_tools at on at.tool_id = t.id
          join agent_sessions s on s.agent_id = at.agent_id
          where s.id = ${sessionId}
            and s.organization_id = ${actor.organizationId}
            and t.organization_id = ${actor.organizationId}
            and at.organization_id = ${actor.organizationId}
          order by t.name
        `);
        return rows.map(toRecord);
      });
    },
  };
}
