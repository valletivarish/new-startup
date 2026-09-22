/**
 * Invitations (ADR-005).
 *
 * Token model: 32 random bytes, base64url-encoded. The database holds only
 * the SHA-256 hash. The raw token is revealed once at create time (email +
 * API acceptUrl for copy) and never stored. Acceptance requires BOTH the
 * unguessable token AND an authenticated session whose email matches.
 *
 * Abuse cases covered:
 *   duplicate     → partial unique index on (org, email) where pending → 409
 *   expired       → checked at acceptance, marked, 410
 *   revoked       → status check → 410
 *   replayed      → status flips to accepted inside the same transaction that
 *                   inserts the membership; a second accept sees non-pending
 *   wrong account → email must match the session's email
 *   inviting an existing member → checked and refused
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  sql,
  withInvitationContext,
  withTenantContext,
  type Database,
} from '@platform/db';
import { canAssignRole, isSystemRole } from '@platform/permissions';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { NotificationProvider } from '@platform/providers';

const INVITATION_TTL_HOURS = 72;

export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly roleKey: string;
  readonly status: string;
  readonly expiresAt: string;
  readonly invitedByName: string;
}

interface Actor {
  readonly organizationId: string;
  readonly userId: string;
  readonly roleKey: string;
}

export interface InvitationsService {
  list(actor: Actor): Promise<readonly InvitationRow[]>;
  create(
    actor: Actor,
    params: { readonly email: string; readonly roleKey: string },
  ): Promise<{ readonly id: string; readonly acceptUrl: string }>;
  revoke(actor: Actor, invitationId: string): Promise<void>;
  /**
   * Accept by token. The caller is an authenticated user with no required
   * organization context; the token is the tenant selector.
   */
  accept(params: {
    readonly token: string;
    readonly userId: string;
    readonly userEmail: string;
  }): Promise<{ readonly organizationId: string }>;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createInvitationsService(
  database: Database,
  audit: AuditService,
  notifications: NotificationProvider,
  webUrl: string,
): InvitationsService {
  return {
    async list(actor) {
      const rows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{
            id: string;
            email: string;
            role_key: string;
            status: string;
            expires_at: string;
            invited_by_name: string;
          }>(sql`
            select i.id, i.email, r.key as role_key, i.status,
                   i.expires_at::text, coalesce(u.name, '') as invited_by_name
            from organization_invitations i
            join roles r on r.id = i.role_id
            left join users u on u.id = i.invited_by_user_id
            where i.organization_id = ${actor.organizationId}
            order by i.created_at desc
          `),
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        roleKey: r.role_key,
        status: r.status,
        expiresAt: r.expires_at,
        invitedByName: r.invited_by_name,
      }));
    },

    async create(actor, { email, roleKey }) {
      if (!isSystemRole(roleKey)) {
        throw ApiError.validation([{ field: 'roleKey', message: 'Unknown role' }]);
      }
      // Invariant 2 applies to invitations too: only an Owner invites an
      // Owner. Resolved through the shared invariant helper, never by
      // comparing role names inline.
      if (
        !isSystemRole(actor.roleKey) ||
        !canAssignRole(actor.roleKey, roleKey)
      ) {
        throw ApiError.forbidden('Only an Owner can invite an Owner');
      }

      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);

      const invitationId = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          // Refuse inviting someone who is already a member.
          const member = await tx.execute<{ id: string }>(sql`
            select m.id from organization_memberships m
            join users u on u.id = m.user_id
            where m.organization_id = ${actor.organizationId} and u.email = ${email}
          `);
          if (member.length > 0) {
            throw ApiError.conflict('That person is already a member');
          }

          try {
            const rows = await tx.execute<{ id: string }>(sql`
              insert into organization_invitations
                (organization_id, email, role_id, token_hash, invited_by_user_id, expires_at)
              select ${actor.organizationId}, ${email}, r.id, ${tokenHash},
                     ${actor.userId}, now() + make_interval(hours => ${INVITATION_TTL_HOURS})
              from roles r
              where r.organization_id is null and r.key = ${roleKey}
              returning id
            `);
            const id = rows[0]?.id;
            if (!id) throw new Error('invitation insert returned no row');
            return id;
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict(
                'A pending invitation for that email already exists',
              );
            }
            throw error;
          }
        },
      );

      const acceptUrl = `${webUrl}/invitations/accept?token=${token}`;
      const orgRows = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) =>
          tx.execute<{ name: string }>(sql`
            select name from organizations
            where id = ${actor.organizationId}
            limit 1
          `),
      );
      const company =
        orgRows[0]?.name?.trim() || 'your hiring desk';
      await notifications.sendEmail({
        to: email,
        subject: `Join ${company}`,
        text:
          `You've been invited to ${company}.\n\n` +
          `Open this link to join (expires in ${INVITATION_TTL_HOURS} hours):\n` +
          `${acceptUrl}\n\n` +
          `If the link asks you to sign in, use this same email address.`,
      });

      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'invitation.created',
        resourceType: 'invitation',
        resourceId: invitationId,
        metadata: { role: roleKey },
      });

      return { id: invitationId, acceptUrl };
    },

    async revoke(actor, invitationId) {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          const result = await tx.execute(sql`
            update organization_invitations
            set status = 'revoked', updated_at = now()
            where id = ${invitationId}
              and organization_id = ${actor.organizationId}
              and status = 'pending'
          `);
          if ((result.count ?? 0) === 0) throw ApiError.notFound('Invitation');
        },
      );
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: invitationId,
      });
    },

    async accept({ token, userId, userEmail }) {
      const tokenHash = hashToken(token);

      // Step 1 — resolve the invitation through the token-hash policy. Only
      // the single matching row is visible; no organization context exists.
      const invitation = await withInvitationContext(
        database.db,
        tokenHash,
        async (tx) => {
          const rows = await tx.execute<{
            id: string;
            organization_id: string;
            email: string;
            role_id: string;
            status: string;
            expired: boolean;
          }>(sql`
            select id, organization_id, email, role_id, status,
                   (expires_at < now()) as expired
            from organization_invitations
            where token_hash = ${tokenHash}
          `);
          return rows[0] ?? null;
        },
      );

      // Unknown token and wrong-email both end here with the same error —
      // an invitation's existence is not probeable.
      if (!invitation) throw ApiError.notFound('Invitation');
      if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw ApiError.notFound('Invitation');
      }
      if (invitation.status !== 'pending') {
        throw ApiError.gone('This invitation is no longer valid');
      }
      if (invitation.expired) {
        await withInvitationContext(database.db, tokenHash, async (tx) => {
          await tx.execute(sql`
            update organization_invitations
            set status = 'expired', updated_at = now()
            where id = ${invitation.id} and status = 'pending'
          `);
        });
        throw ApiError.gone('This invitation has expired');
      }

      // Step 2 — inside the invitation's organization context (the WITH CHECK
      // requires it), atomically: flip pending→accepted, then insert the
      // membership. The conditional update is the replay guard — a concurrent
      // accept loses the race and updates zero rows.
      await withTenantContext(
        database.db,
        { organizationId: invitation.organization_id, userId },
        async (tx) => {
          const claimed = await tx.execute(sql`
            update organization_invitations
            set status = 'accepted', accepted_at = now(), updated_at = now()
            where id = ${invitation.id}
              and status = 'pending'
              and expires_at > now()
          `);
          if ((claimed.count ?? 0) === 0) {
            throw ApiError.gone('This invitation is no longer valid');
          }

          try {
            await tx.execute(sql`
              insert into organization_memberships
                (organization_id, user_id, role_id, invited_by_user_id)
              values (${invitation.organization_id}, ${userId}, ${invitation.role_id},
                      (select invited_by_user_id from organization_invitations where id = ${invitation.id}))
            `);
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict('You are already a member of this company');
            }
            throw error;
          }
        },
      );

      await audit.record({
        organizationId: invitation.organization_id,
        actorUserId: userId,
        eventType: 'invitation.accepted',
        resourceType: 'invitation',
        resourceId: invitation.id,
      });

      return { organizationId: invitation.organization_id };
    },
  };
}
