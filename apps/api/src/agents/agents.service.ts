/**
 * Agent and version management.
 *
 * Every query runs inside the caller's tenant context AND carries an explicit
 * `organization_id` filter — the three-layer rule from Phase 1 applies
 * unchanged to Phase 2 tables.
 *
 * Concurrency is handled by database constraints rather than application
 * assumptions: partial unique indexes guarantee at most one draft and one
 * published version per agent, so two simultaneous publishes cannot both
 * succeed no matter how the requests interleave.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import { AgentConfiguration, defaultConfiguration } from './configuration.js';
import { getPack } from './packs/index.js';
import type { AgentType } from './packs/types.js';
import {
  assertAgentTransition,
  assertVersionTransition,
  type AgentStatus,
} from './lifecycle.js';
import { assertCanCreateAgent } from './quota.js';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly purpose: string;
  readonly type: string;
  readonly status: string;
  readonly currentVersionId: string | null;
  readonly currentVersion: number | null;
  readonly createdAt: string;
}

export interface VersionRow {
  readonly id: string;
  readonly agentId: string;
  readonly version: number;
  readonly status: string;
  readonly configuration: unknown;
  readonly publishedAt: string | null;
  readonly createdAt: string;
}

export interface AgentsService {
  list(actor: Actor): Promise<readonly AgentRow[]>;
  get(actor: Actor, agentId: string): Promise<AgentRow>;
  create(
    actor: Actor,
    input: {
      name: string;
      description?: string;
      purpose?: string;
      type?: string;
      agentType: AgentType;
      mustAskQuestions: readonly string[];
      transferPhones: readonly string[];
    },
  ): Promise<{ id: string; versionId: string }>;
  update(
    actor: Actor,
    agentId: string,
    input: { name?: string; description?: string; purpose?: string },
  ): Promise<void>;
  transition(actor: Actor, agentId: string, to: AgentStatus): Promise<void>;

  /** Knowledge sources this agent may draw on. */
  listKnowledge(actor: Actor, agentId: string): Promise<readonly { id: string; name: string }[]>;
  attachKnowledge(actor: Actor, agentId: string, sourceId: string): Promise<void>;
  detachKnowledge(actor: Actor, agentId: string, sourceId: string): Promise<void>;

  listVersions(actor: Actor, agentId: string): Promise<readonly VersionRow[]>;
  getVersion(actor: Actor, agentId: string, versionId: string): Promise<VersionRow>;
  createDraft(
    actor: Actor,
    agentId: string,
    configuration: unknown,
  ): Promise<{ id: string; version: number }>;
  updateDraft(actor: Actor, agentId: string, versionId: string, configuration: unknown): Promise<void>;
  publish(actor: Actor, agentId: string, versionId: string): Promise<void>;
}

type AgentRecord = {
  id: string;
  name: string;
  description: string;
  purpose: string;
  type: string;
  status: string;
  current_version_id: string | null;
  current_version: number | null;
  created_at: string;
};

type VersionRecord = {
  id: string;
  agent_id: string;
  version: number;
  status: string;
  configuration: unknown;
  published_at: string | null;
  created_at: string;
};

function toAgent(r: AgentRecord): AgentRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    purpose: r.purpose,
    type: r.type,
    status: r.status,
    currentVersionId: r.current_version_id,
    currentVersion: r.current_version,
    createdAt: r.created_at,
  };
}

function toVersion(r: VersionRecord): VersionRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    version: r.version,
    status: r.status,
    configuration: r.configuration,
    publishedAt: r.published_at,
    createdAt: r.created_at,
  };
}

/** Validates configuration against the contract; invalid input is a 422. */
function parseConfiguration(input: unknown): AgentConfiguration {
  const result = AgentConfiguration.safeParse(input);
  if (!result.success) {
    throw ApiError.validation(
      result.error.issues.map((i) => ({
        field: `configuration.${i.path.join('.')}`,
        message: i.message,
      })),
    );
  }
  return result.data;
}

export function createAgentsService(
  database: Database,
  audit: AuditService,
  agentLimit: number,
): AgentsService {
  /** Load an agent within the caller's organization, or an identical 404. */
  async function loadAgent(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    actor: Actor,
    agentId: string,
    forUpdate = false,
  ): Promise<AgentRecord> {
    const rows = await tx.execute<AgentRecord>(sql`
      select a.id, a.name, a.description, a.purpose, a.type, a.status,
             a.current_version_id, v.version as current_version,
             a.created_at::text
      from agents a
      left join agent_versions v on v.id = a.current_version_id
      where a.id = ${agentId} and a.organization_id = ${actor.organizationId}
      ${forUpdate ? sql`for update of a` : sql``}
    `);
    const agent = rows[0];
    // A foreign agent id and a nonexistent one are indistinguishable.
    if (!agent) throw ApiError.notFound('Agent');
    return agent;
  }

  return {
    async list(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<AgentRecord>(sql`
            select a.id, a.name, a.description, a.purpose, a.type, a.status,
                   a.current_version_id, v.version as current_version,
                   a.created_at::text
            from agents a
            left join agent_versions v on v.id = a.current_version_id
            where a.organization_id = ${actor.organizationId}
            order by a.created_at desc
          `),
      );
      return rows.map(toAgent);
    },

    async get(actor, agentId) {
      const agent = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => loadAgent(tx, actor, agentId),
      );
      return toAgent(agent);
    },

    async create(actor, input) {
      const pack = getPack(input.agentType);
      const purpose = input.purpose ?? pack.description;
      const criteria = input.mustAskQuestions.map((label, i) => ({
        id: `q${i + 1}`,
        label,
        required: true,
      }));
      const configuration = AgentConfiguration.parse({
        ...defaultConfiguration(input.name, purpose),
        ...pack.defaultConfigSlice,
        agentType: input.agentType,
        purpose,
        identity: {
          displayName: input.name,
          languages: ['en-IN'],
          primaryLanguage: 'en-IN',
        },
        evaluation: { enabled: criteria.length > 0, criteria },
        escalation: {
          enabled: input.transferPhones.length > 0,
          trigger: 'on_request',
          transferPhones: input.transferPhones,
        },
      });

      const created = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await assertCanCreateAgent(async () => {
            const rows = await tx.execute<{ count: number }>(sql`
              select count(*)::int as count
              from agents
              where organization_id = ${actor.organizationId}
            `);
            return rows[0]?.count ?? 0;
          }, agentLimit);

          let agentId: string;
          try {
            const rows = await tx.execute<{ id: string }>(sql`
              insert into agents
                (organization_id, name, description, purpose, type, created_by_user_id)
              values (${actor.organizationId}, ${input.name},
                      ${input.description ?? ''}, ${purpose},
                      ${input.type ?? input.agentType}, ${actor.userId})
              returning id
            `);
            const id = rows[0]?.id;
            if (!id) throw new Error('agent insert returned no id');
            agentId = id;
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                `An agent named "${input.name}" already exists`,
              );
            }
            throw error;
          }

          // Every agent starts with a draft version 1, so there is always
          // something to edit and publish.
          const versionRows = await tx.execute<{ id: string }>(sql`
            insert into agent_versions
              (organization_id, agent_id, version, configuration, status, created_by_user_id)
            values (${actor.organizationId}, ${agentId}, 1,
                    ${JSON.stringify(configuration)}::jsonb, 'draft', ${actor.userId})
            returning id
          `);
          const versionId = versionRows[0]?.id;
          if (!versionId) throw new Error('version insert returned no id');
          return { id: agentId, versionId };
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.created',
        resourceType: 'agent',
        resourceId: created.id,
        metadata: { name: input.name, type: input.type ?? input.agentType },
      });
      return created;
    },

    async update(actor, agentId, input) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const agent = await loadAgent(tx, actor, agentId, true);
          if (agent.status === 'archived') {
            throw ApiError.conflict('An archived agent cannot be modified');
          }
          await tx.execute(sql`
            update agents set
              name = coalesce(${input.name ?? null}, name),
              description = coalesce(${input.description ?? null}, description),
              purpose = coalesce(${input.purpose ?? null}, purpose),
              updated_at = now()
            where id = ${agentId} and organization_id = ${actor.organizationId}
          `);
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.updated',
        resourceType: 'agent',
        resourceId: agentId,
      });
    },

    async transition(actor, agentId, to) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const agent = await loadAgent(tx, actor, agentId, true);
          assertAgentTransition(agent.status, to);

          // Publishing the AGENT requires a published version to serve.
          if (to === 'published' && !agent.current_version_id) {
            throw ApiError.conflict(
              'Publish a version before publishing the agent',
            );
          }

          await tx.execute(sql`
            update agents set status = ${to}, updated_at = now()
            where id = ${agentId} and organization_id = ${actor.organizationId}
          `);

          if (to === 'archived') {
            // Archiving retires every version with the agent.
            await tx.execute(sql`
              update agent_versions set status = 'archived', updated_at = now()
              where agent_id = ${agentId}
                and organization_id = ${actor.organizationId}
                and status in ('draft', 'superseded')
            `);
          }
        },
      );

      const eventType =
        to === 'paused'
          ? 'agent.paused'
          : to === 'archived'
            ? 'agent.archived'
            : 'agent.published';
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType,
        resourceType: 'agent',
        resourceId: agentId,
        metadata: { status: to },
      });
    },

    async listKnowledge(actor, agentId) {
      return withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadAgent(tx, actor, agentId);
          const rows = await tx.execute<{ id: string; name: string }>(sql`
            select s.id, s.name
            from agent_knowledge_sources a
            join knowledge_sources s
              on s.id = a.source_id and s.organization_id = a.organization_id
            where a.agent_id = ${agentId}
              and a.organization_id = ${actor.organizationId}
              and s.status <> 'archived'
            order by s.name
          `);
          return rows.map((r) => ({ id: r.id, name: r.name }));
        },
      );
    },

    async attachKnowledge(actor, agentId, sourceId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadAgent(tx, actor, agentId);

          // The source must exist IN THIS ORGANIZATION. Without this check a
          // caller could name another tenant's source id and have the agent
          // reference it — RLS would then hide the rows, but the association
          // itself would be wrong. Validate rather than rely on the backstop.
          const source = await tx.execute<{ id: string }>(sql`
            select id from knowledge_sources
            where id = ${sourceId} and organization_id = ${actor.organizationId}
              and status <> 'archived'
          `);
          if (source.length === 0) throw ApiError.notFound('Knowledge source');

          await tx.execute(sql`
            insert into agent_knowledge_sources (organization_id, agent_id, source_id)
            values (${actor.organizationId}, ${agentId}, ${sourceId})
            on conflict (agent_id, source_id) do nothing
          `);
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.knowledge.attached',
        resourceType: 'agent',
        resourceId: agentId,
        metadata: { sourceId },
      });
    },

    async detachKnowledge(actor, agentId, sourceId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadAgent(tx, actor, agentId);
          await tx.execute(sql`
            delete from agent_knowledge_sources
            where agent_id = ${agentId} and source_id = ${sourceId}
              and organization_id = ${actor.organizationId}
          `);
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.knowledge.detached',
        resourceType: 'agent',
        resourceId: agentId,
        metadata: { sourceId },
      });
    },

    async listVersions(actor, agentId) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await loadAgent(tx, actor, agentId);
          return tx.execute<VersionRecord>(sql`
            select id, agent_id, version, status, configuration,
                   published_at::text, created_at::text
            from agent_versions
            where agent_id = ${agentId} and organization_id = ${actor.organizationId}
            order by version desc
          `);
        },
      );
      return rows.map(toVersion);
    },

    async getVersion(actor, agentId, versionId) {
      const version = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const rows = await tx.execute<VersionRecord>(sql`
            select id, agent_id, version, status, configuration,
                   published_at::text, created_at::text
            from agent_versions
            where id = ${versionId} and agent_id = ${agentId}
              and organization_id = ${actor.organizationId}
          `);
          const found = rows[0];
          if (!found) throw ApiError.notFound('Agent version');
          return found;
        },
      );
      return toVersion(version);
    },

    async createDraft(actor, agentId, configuration) {
      const parsed = parseConfiguration(configuration);

      const created = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const agent = await loadAgent(tx, actor, agentId, true);
          if (agent.status === 'archived') {
            throw ApiError.conflict('An archived agent cannot be modified');
          }

          try {
            const rows = await tx.execute<{ id: string; version: number }>(sql`
              insert into agent_versions
                (organization_id, agent_id, version, configuration, status, created_by_user_id)
              select ${actor.organizationId}, ${agentId},
                     coalesce(max(version), 0) + 1,
                     ${JSON.stringify(parsed)}::jsonb, 'draft', ${actor.userId}
              from agent_versions
              where agent_id = ${agentId} and organization_id = ${actor.organizationId}
              returning id, version
            `);
            const row = rows[0];
            if (!row) throw new Error('draft insert returned no row');
            return row;
          } catch (error) {
            // The partial unique index makes "one draft per agent" a database
            // guarantee rather than a check-then-insert race.
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                'This agent already has an open draft version',
              );
            }
            throw error;
          }
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.version.created',
        resourceType: 'agent_version',
        resourceId: created.id,
        metadata: { agentId, version: created.version },
      });
      return created;
    },

    async updateDraft(actor, agentId, versionId, configuration) {
      const parsed = parseConfiguration(configuration);
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const rows = await tx.execute<{ status: string }>(sql`
            select status from agent_versions
            where id = ${versionId} and agent_id = ${agentId}
              and organization_id = ${actor.organizationId}
            for update
          `);
          const version = rows[0];
          if (!version) throw ApiError.notFound('Agent version');
          if (version.status !== 'draft') {
            // The database trigger would refuse this too; failing here gives
            // the caller a clear 409 instead of a driver error.
            throw ApiError.conflict(
              'Only a draft version can be edited. Create a new draft instead.',
            );
          }
          await tx.execute(sql`
            update agent_versions
            set configuration = ${JSON.stringify(parsed)}::jsonb, updated_at = now()
            where id = ${versionId} and organization_id = ${actor.organizationId}
          `);
        },
      );
    },

    async publish(actor, agentId, versionId) {
      const published = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const agent = await loadAgent(tx, actor, agentId, true);
          if (agent.status === 'archived') {
            throw ApiError.conflict('An archived agent cannot be published');
          }

          const rows = await tx.execute<{ status: string; version: number }>(sql`
            select status, version from agent_versions
            where id = ${versionId} and agent_id = ${agentId}
              and organization_id = ${actor.organizationId}
            for update
          `);
          const version = rows[0];
          if (!version) throw ApiError.notFound('Agent version');
          assertVersionTransition(version.status, 'published');

          // Retire the incumbent first: the partial unique index permits only
          // one published version per agent, so this ordering is required and
          // the index is what makes concurrent publishes safe.
          await tx.execute(sql`
            update agent_versions set status = 'superseded', updated_at = now()
            where agent_id = ${agentId}
              and organization_id = ${actor.organizationId}
              and status = 'published'
          `);

          await tx.execute(sql`
            update agent_versions
            set status = 'published', published_at = now(),
                published_by_user_id = ${actor.userId}, updated_at = now()
            where id = ${versionId} and organization_id = ${actor.organizationId}
          `);

          await tx.execute(sql`
            update agents
            set current_version_id = ${versionId},
                status = case when status = 'draft' then 'published' else status end,
                updated_at = now()
            where id = ${agentId} and organization_id = ${actor.organizationId}
          `);

          return version.version;
        },
      );

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'agent.version.published',
        resourceType: 'agent_version',
        resourceId: versionId,
        metadata: { agentId, version: published },
      });
    },
  };
}
