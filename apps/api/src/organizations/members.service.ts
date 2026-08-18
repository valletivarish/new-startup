/**
 * Membership management, carrying the structural invariants the permission
 * matrix cannot express (11_PERMISSION_MATRIX, "Structural invariants"):
 *
 *   1. Every organization keeps at least one active Owner. The last Owner
 *      cannot be demoted, suspended, or removed.
 *   2. Only an Owner may grant or revoke the Owner role.
 *   3. An Administrator cannot modify an Owner's membership.
 *   4. No member may change their own role (no self-escalation, and no
 *      self-demotion that would dodge invariant 1).
 *   5. Role changes, suspension, and removal invalidate the affected user's
 *      sessions in this organization immediately.
 *
 * Every read and write here runs inside the caller's tenant context, so RLS
 * guarantees the rows belong to the caller's organization even if a bug
 * dropped an explicit filter. Row locks (FOR UPDATE) serialise concurrent
 * role changes so two simultaneous demotions cannot race past the
 * last-owner check.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import {
  canAssignRole,
  canModifyMembershipOf,
  isSystemRole,
  type SystemRole,
} from '@platform/permissions';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SessionService } from '../auth/session.service.js';

export interface MemberRow {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly roleKey: string;
  readonly status: string;
  readonly joinedAt: string;
}

interface Actor {
  readonly organizationId: string;
  readonly userId: string;
  readonly roleKey: string;
}

export interface MembersService {
  list(actor: Actor): Promise<readonly MemberRow[]>;
  changeRole(actor: Actor, membershipId: string, roleKey: string): Promise<void>;
  changeStatus(actor: Actor, membershipId: string, status: 'active' | 'suspended'): Promise<void>;
  remove(actor: Actor, membershipId: string): Promise<void>;
}

// Type alias, not interface: drizzle's execute<T> constraint requires
// assignability to Record<string, unknown>, which interfaces don't satisfy.
type TargetRow = {
  membership_id: string;
  user_id: string;
  role_key: string;
  status: string;
};

export function createMembersService(
  database: Database,
  audit: AuditService,
  sessions: SessionService,
): MembersService {
  /**
   * Service-level denial: audited (matrix invariant 7 — every permission-
   * denied event writes an AuditEvent, not only guard-level misses), then
   * returned as the ApiError for the caller to throw.
   */
  async function denied(
    actor: Actor,
    reason: string,
    membershipId: string,
    message: string,
  ): Promise<ApiError> {
    await audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType: 'authz.denied',
      resourceType: 'membership',
      resourceId: membershipId,
      metadata: { reason },
    });
    return ApiError.forbidden(message);
  }
  /**
   * Load and lock the target membership; identical 404 for foreign ids.
   * Filters by organization_id explicitly — RLS is the backstop, and the
   * memberships bootstrap policy's OR-user_id arm means RLS alone is not
   * sufficient scoping for this table (audit finding).
   */
  async function lockTarget(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    organizationId: string,
    membershipId: string,
  ): Promise<TargetRow> {
    const rows = await tx.execute<TargetRow>(sql`
      select m.id as membership_id, m.user_id, r.key as role_key, m.status
      from organization_memberships m
      join roles r on r.id = m.role_id
      where m.id = ${membershipId}
        and m.organization_id = ${organizationId}
      for update of m
    `);
    const target = rows[0];
    if (!target) throw ApiError.notFound('Member');
    return target;
  }

  /**
   * Count OTHER active owners, LOCKING every owner row first.
   *
   * The lock is what makes the last-owner invariant race-safe: two concurrent
   * demotions of the last two owners both need locks on each other's rows, so
   * one transaction serialises behind the other and re-reads a count of zero
   * (audit finding — the previous version locked only the target row and the
   * race could leave an organization ownerless).
   */
  async function otherActiveOwners(
    tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
    organizationId: string,
    excludingMembershipId: string,
  ): Promise<number> {
    const rows = await tx.execute<{ id: string }>(sql`
      select m.id
      from organization_memberships m
      join roles r on r.id = m.role_id
      where m.organization_id = ${organizationId}
        and r.organization_id is null
        and r.key = 'owner'
        and m.status = 'active'
        and m.id <> ${excludingMembershipId}
      for update of m
    `);
    return rows.length;
  }

  async function assertCanModifyAudited(
    actor: Actor,
    target: TargetRow,
  ): Promise<void> {
    if (!isSystemRole(actor.roleKey) || !isSystemRole(target.role_key)) {
      throw await denied(actor, 'membership.unknown_role', target.membership_id,
        'You do not have permission to do this');
    }
    // Invariant 3: an Administrator cannot touch an Owner.
    if (!canModifyMembershipOf(actor.roleKey, target.role_key)) {
      throw await denied(actor, 'membership.admin_cannot_modify_owner',
        target.membership_id, 'Only an Owner can modify an Owner');
    }
  }

  return {
    async list(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{
            membership_id: string;
            user_id: string;
            name: string;
            email: string;
            role_key: string;
            status: string;
            joined_at: string;
          }>(sql`
            select m.id as membership_id, m.user_id, u.name, u.email,
                   r.key as role_key, m.status, m.joined_at::text
            from organization_memberships m
            join users u on u.id = m.user_id
            join roles r on r.id = m.role_id
            where m.organization_id = ${actor.organizationId}
            order by m.joined_at
          `),
      );
      return rows.map((r) => ({
        membershipId: r.membership_id,
        userId: r.user_id,
        name: r.name,
        email: r.email,
        roleKey: r.role_key,
        status: r.status,
        joinedAt: r.joined_at,
      }));
    },

    async changeRole(actor, membershipId, roleKey) {
      if (!isSystemRole(roleKey)) {
        throw ApiError.validation([{ field: 'roleKey', message: 'Unknown role' }]);
      }

      const affectedUser = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const target = await lockTarget(tx, actor.organizationId, membershipId);

          // Invariant 4: no self-role-change, in either direction.
          if (target.user_id === actor.userId) {
            throw await denied(actor, 'membership.self_role_change', membershipId,
              'You cannot change your own role');
          }
          await assertCanModifyAudited(actor, target);

          // Invariant 2: granting OR revoking Owner is Owner-only.
          // actor.roleKey was verified as a SystemRole in assertCanModify.
          if (!canAssignRole(actor.roleKey as SystemRole, roleKey)) {
            throw await denied(actor, 'membership.owner_grant_refused', membershipId,
              'Only an Owner can grant the Owner role');
          }

          // Invariant 1: demoting the last active Owner is refused.
          if (
            target.role_key === 'owner' &&
            roleKey !== 'owner' &&
            (await otherActiveOwners(tx, actor.organizationId, membershipId)) === 0
          ) {
            throw ApiError.conflict(
              'An organization must keep at least one active Owner',
            );
          }

          await tx.execute(sql`
            update organization_memberships m
            set role_id = r.id, updated_at = now()
            from roles r
            where m.id = ${membershipId}
              and m.organization_id = ${actor.organizationId}
              and r.organization_id is null and r.key = ${roleKey}
          `);
          return { userId: target.user_id, previousRole: target.role_key };
        },
      );

      // Invariant 5: the demoted/promoted user's sessions here end now.
      await sessions.invalidateForUserInOrganization(
        affectedUser.userId,
        actor.organizationId,
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'membership.role_changed',
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { from: affectedUser.previousRole, to: roleKey },
      });
    },

    async changeStatus(actor, membershipId, status) {
      const affected = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const target = await lockTarget(tx, actor.organizationId, membershipId);
          if (target.user_id === actor.userId) {
            throw await denied(actor, 'membership.self_suspend', membershipId,
              'You cannot suspend yourself');
          }
          await assertCanModifyAudited(actor, target);

          if (
            status === 'suspended' &&
            target.role_key === 'owner' &&
            (await otherActiveOwners(tx, actor.organizationId, membershipId)) === 0
          ) {
            throw ApiError.conflict(
              'An organization must keep at least one active Owner',
            );
          }

          await tx.execute(sql`
            update organization_memberships
            set status = ${status}, updated_at = now()
            where id = ${membershipId}
              and organization_id = ${actor.organizationId}
          `);
          return target.user_id;
        },
      );

      if (status === 'suspended') {
        await sessions.invalidateForUserInOrganization(
          affected,
          actor.organizationId,
        );
      }
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType:
          status === 'suspended' ? 'membership.suspended' : 'membership.reactivated',
        resourceType: 'membership',
        resourceId: membershipId,
      });
    },

    async remove(actor, membershipId) {
      const affected = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const target = await lockTarget(tx, actor.organizationId, membershipId);
          if (target.user_id === actor.userId) {
            throw await denied(actor, 'membership.self_remove', membershipId,
              'You cannot remove yourself; transfer ownership first');
          }
          await assertCanModifyAudited(actor, target);

          if (
            target.role_key === 'owner' &&
            (await otherActiveOwners(tx, actor.organizationId, membershipId)) === 0
          ) {
            throw ApiError.conflict(
              'An organization must keep at least one active Owner',
            );
          }

          await tx.execute(sql`
            delete from organization_memberships
            where id = ${membershipId}
              and organization_id = ${actor.organizationId}
          `);
          return target.user_id;
        },
      );

      await sessions.invalidateForUserInOrganization(
        affected,
        actor.organizationId,
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'membership.removed',
        resourceType: 'membership',
        resourceId: membershipId,
      });
    },
  };
}
