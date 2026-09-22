/**
 * Organization lifecycle and the caller's organization list.
 *
 * `organizations` is RLS-exempt (A6), so every query here filters explicitly
 * — the application layer IS the protection for this one table, which is why
 * nothing in this file accepts an organization id from the caller for reads:
 * ids come from the validated session context or from the membership rows of
 * the authenticated user.
 */

import { randomUUID } from 'node:crypto';
import {
  sql,
  withActorContext,
  withTenantContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly roleKey: string;
}

export interface OrganizationsService {
  /** Organizations the user belongs to, with their role in each (ADR-005). */
  listForUser(userId: string): Promise<readonly OrganizationSummary[]>;

  /** Create an organization; the creator becomes Owner. */
  create(params: {
    readonly userId: string;
    readonly name: string;
    readonly slug?: string;
  }): Promise<{ readonly id: string; readonly slug: string }>;

  /**
   * Guarantee the user has a company workspace.
   * If they already belong to one, return the first (stable for single-org).
   * Otherwise create one named `name` and return it.
   */
  ensureForUser(params: {
    readonly userId: string;
    readonly name: string;
  }): Promise<{
    readonly id: string;
    readonly slug: string;
    readonly created: boolean;
  }>;

  get(organizationId: string): Promise<{
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly status: string;
  }>;

  update(params: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly name?: string;
  }): Promise<void>;

  /** Owner-only hard delete. Memberships and tenant rows cascade. */
  remove(organizationId: string, actorUserId: string): Promise<void>;

  /** Validate membership and return the org id to activate, or throw. */
  validateMembership(userId: string, organizationId: string): Promise<void>;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 3 ? base : `org-${randomUUID().slice(0, 8)}`;
}

export function createOrganizationsService(
  database: Database,
  audit: AuditService,
): OrganizationsService {
  const service: OrganizationsService = {
    async listForUser(userId) {
      // Actor context: the membership policy exposes exactly this user's
      // rows. Organizations and system roles are globally readable.
      const rows = await withActorContext(database.db, userId, async (tx) =>
        tx.execute<{
          id: string;
          name: string;
          slug: string;
          status: string;
          role_key: string;
        }>(sql`
          select o.id, o.name, o.slug, o.status, r.key as role_key
          from organization_memberships m
          join organizations o on o.id = m.organization_id
          join roles r on r.id = m.role_id
          where m.user_id = ${userId} and m.status = 'active'
          order by o.name
        `),
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        roleKey: r.role_key,
      }));
    },

    async create({ userId, name, slug }) {
      const finalSlug = slug ?? slugify(name);
      // Client-generated id so the organization row and the creator's Owner
      // membership commit in ONE transaction under the new org's tenant
      // context (audit finding: the previous two-transaction shape could
      // crash between them and leave an ownerless organization). Entering
      // tenant context for an org created inside the same transaction is the
      // one legitimate bootstrap exception, documented in tenant-context.ts.
      const id = randomUUID();

      try {
        await withTenantContext(
          database.db,
          { organizationId: id, userId },
          async (tx) => {
            await tx.execute(sql`
              insert into organizations (id, name, slug)
              values (${id}, ${name}, ${finalSlug})
            `);
            await tx.execute(sql`
              insert into organization_memberships (organization_id, user_id, role_id)
              select ${id}, ${userId}, r.id
              from roles r where r.organization_id is null and r.key = 'owner'
            `);
          },
        );
      } catch (error) {
        // Unique-violation on the slug — raced or taken. No half-created
        // organization survives; the transaction rolled back atomically.
        if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
          throw ApiError.conflict(`Slug "${finalSlug}" is already in use`);
        }
        throw error;
      }

      await audit.record({
        organizationId: id,
        actorUserId: userId,
        eventType: 'organization.created',
        resourceType: 'organization',
        resourceId: id,
        metadata: { name },
      });

      return { id, slug: finalSlug };
    },

    async ensureForUser({ userId, name }) {
      const existing = await service.listForUser(userId);
      const first = existing[0];
      if (first) {
        return { id: first.id, slug: first.slug, created: false };
      }
      const created = await service.create({ userId, name });
      return { id: created.id, slug: created.slug, created: true };
    },

    async get(organizationId) {
      const rows = await withoutTenantContext(database.db, async (tx) =>
        tx.execute<{
          id: string;
          name: string;
          slug: string;
          status: string;
        }>(sql`
          select id, name, slug, status from organizations
          where id = ${organizationId}
        `),
      );
      const org = rows[0];
      if (!org) throw ApiError.notFound('Company');
      return org;
    },

    async update({ organizationId, actorUserId, name }) {
      if (name !== undefined) {
        await withoutTenantContext(database.db, async (tx) => {
          await tx.execute(sql`
            update organizations set name = ${name}, updated_at = now()
            where id = ${organizationId}
          `);
        });
        await audit.record({
          organizationId,
          actorUserId,
          eventType: 'organization.updated',
          resourceType: 'organization',
          resourceId: organizationId,
          metadata: { name },
        });
      }
    },

    async remove(organizationId, actorUserId) {
      await audit.record({
        organizationId,
        actorUserId,
        eventType: 'organization.deleted',
        resourceType: 'organization',
        resourceId: organizationId,
      });
      await withoutTenantContext(database.db, async (tx) => {
        await tx.execute(
          sql`delete from organizations where id = ${organizationId}`,
        );
      });
    },

    async validateMembership(userId, organizationId) {
      const rows = await withActorContext(database.db, userId, async (tx) =>
        tx.execute<{ id: string }>(sql`
          select m.id from organization_memberships m
          join organizations o on o.id = m.organization_id
          where m.user_id = ${userId}
            and m.organization_id = ${organizationId}
            and m.status = 'active'
            and o.status = 'active'
        `),
      );
      if (rows.length === 0) {
        // Same response whether the org does not exist or the user simply
        // is not in it — existence is not inferable (IDOR hygiene).
        throw ApiError.notFound('Company');
      }
    },
  };
  return service;
}
