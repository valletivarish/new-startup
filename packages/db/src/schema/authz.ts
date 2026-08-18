/**
 * Authorization catalogue: roles, permissions, and the matrix between them.
 *
 * This is our own layer and is never delegated to the authentication library
 * (ADR-002 founder clarification, ADR-004).
 *
 * `permissions` and `role_permissions` are RLS-exempt global catalogues.
 *
 * `roles` carries RLS with a policy of
 *   `organization_id IS NULL OR organization_id = current_org_id()`
 * because the table holds two different kinds of row: system roles
 * (`organization_id IS NULL`, available to every organization and therefore
 * exempt per A6) and future organization-defined custom roles, which A6's
 * wording — "system roles" — does not exempt. The policy is the only way to
 * honour that distinction in one table.
 */

import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations.js';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL marks a system role available to every organization. */
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    /** Stable machine key, e.g. `owner`, `agent_manager`. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per system role key.
    uniqueIndex('roles_system_key_unique')
      .on(t.key)
      .where(sql`${t.organizationId} IS NULL`),
    // Custom role keys are unique within their organization.
    uniqueIndex('roles_org_key_unique')
      .on(t.organizationId, t.key)
      .where(sql`${t.organizationId} IS NOT NULL`),
    index('roles_organization_id_idx').on(t.organizationId),
  ],
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `resource.action`, e.g. `candidates.read_pii`. */
    key: text('key').notNull().unique(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    description: text('description').notNull().default(''),
    /** Personal data. Every successful read writes an audit event. */
    isSensitive: boolean('is_sensitive').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('permissions_resource_idx').on(t.resource)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('role_permissions_permission_id_idx').on(t.permissionId),
  ],
);
