/**
 * The tool catalogue (Phase 4).
 *
 *   Organization → Tool → (agent_tools) → Agent
 *
 * A row here is a DECLARATION, not code. Execution requires BOTH an enabled
 * organization-scoped row AND a registered implementation in the executor —
 * so a tool definition can never cause arbitrary code to run, and a compromised
 * row cannot invent behaviour that does not already exist in the platform.
 *
 * `required_permission` is the link to the authorization layer: the runtime
 * checks it against the SESSION's permissions before executing, so a model
 * cannot talk an agent into an action the acting membership lacks
 * (`07_CODING_RULES` §12).
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { agents } from './agents.js';

export const tools = pgTable(
  'tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Matches a registered implementation key. Unique per organization. */
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** JSON Schema validated before execution and before returning to the model. */
    inputSchema: jsonb('input_schema').notNull(),
    outputSchema: jsonb('output_schema').notNull(),
    /**
     * The platform permission the ACTING SESSION must hold. Not a permission
     * the model holds — the model holds none.
     */
    requiredPermission: text('required_permission').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('tools_org_name_unique').on(t.organizationId, t.name),
    index('tools_org_enabled_idx').on(t.organizationId, t.enabled),
  ],
);

/**
 * Which agents may call which tools.
 *
 * Availability is per AGENT, not per organization: an agent that can read
 * knowledge should not automatically be able to take business actions just
 * because another agent in the same organization can.
 */
export const agentTools = pgTable(
  'agent_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_tools_unique').on(t.agentId, t.toolId),
    index('agent_tools_org_idx').on(t.organizationId),
  ],
);

/**
 * Every tool execution attempt, authorized or not.
 *
 * Append-only. A DENIED attempt is as important to record as a successful
 * one — it is the evidence that the authorization layer did its job, and the
 * signal if something is repeatedly trying.
 */
export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    toolName: text('tool_name').notNull(),
    callId: text('call_id').notNull(),
    /** authorized | denied | completed | failed */
    status: text('status').notNull(),
    /** Why authorization was refused. Business language, no internals. */
    denialReason: text('denial_reason'),
    durationMs: integer('duration_ms'),
    /** Size only — output itself is not duplicated here. */
    outputChars: integer('output_chars'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('tool_executions_org_session_idx').on(t.organizationId, t.sessionId),
    index('tool_executions_created_idx').on(t.createdAt),
  ],
);
