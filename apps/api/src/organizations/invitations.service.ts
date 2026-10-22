/**
 * Invitations (ADR-005).
 *
 * Token model: 32 random bytes, base64url-encoded. The database holds only
 * the SHA-256 hash. The raw token is revealed once at create time (email +
 * create response for the web's copy-link; resend never returns it) and never stored. Acceptance requires BOTH the
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
import type { BetterAuthInstance } from '../auth/better-auth.js';

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
  /** Public: what the accept page shows for a token. Nothing else leaves. */
  preview(token: string): Promise<InvitationPreview>;
  /** Public: a person with no account joins and is signed in. */
  acceptNew(params: {
    readonly token: string;
    readonly name: string;
    readonly password: string;
    readonly email?: string | undefined;
  }): Promise<{
    readonly organizationId: string;
    readonly userId: string;
    readonly sessionToken: string;
    readonly cookies: readonly string[];
  }>;
  /** New link (the old one stops working), fresh expiry, same email again. */
  resend(
    actor: Actor,
    invitationId: string,
  ): Promise<{ readonly id: string }>;
}

export interface InvitationPreview {
  readonly organizationName: string;
  readonly inviterName: string;
  readonly roleName: string;
  readonly email: string;
  readonly status: 'pending' | 'expired' | 'revoked' | 'accepted';
  readonly accountExists: boolean;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createInvitationsService(
  database: Database,
  audit: AuditService,
  notifications: NotificationProvider,
  webUrl: string,
  auth: BetterAuthInstance,
): InvitationsService {
  async function sendInviteEmail(email: string, company: string, acceptUrl: string) {
    await notifications.sendEmail({
      to: email,
      subject: `You’re invited to join ${company} on HRVoice`,
      text:
        `You’ve been invited to join ${company} on HRVoice.\n\n` +
        `Open this link to join. It works for ${INVITATION_TTL_HOURS} hours:\n` +
        `${acceptUrl}\n\n` +
        `If the link asks you to sign in, use this same email address.`,
    });
  }

  async function companyName(actor: Actor): Promise<string> {
    const rows = await withTenantContext(
      database.db,
      { organizationId: actor.organizationId, userId: actor.userId },
      async (tx) =>
        tx.execute<{ name: string }>(sql`
          select name from organizations where id = ${actor.organizationId} limit 1
        `),
    );
    return rows[0]?.name?.trim() || 'your hiring desk';
  }

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
      await sendInviteEmail(email, await companyName(actor), acceptUrl);

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

    async preview(token) {
      const tokenHash = hashToken(token);
      const row = await withInvitationContext(database.db, tokenHash, async (tx) => {
        const rows = await tx.execute<{
          email: string;
          status: InvitationPreview['status'];
          expired: boolean;
          organization_name: string;
          role_name: string;
          inviter_name: string;
          account_exists: boolean;
        }>(sql`
          select i.email, i.status, (i.expires_at < now()) as expired,
                 o.name as organization_name, r.name as role_name,
                 coalesce(u.name, '') as inviter_name,
                 exists (select 1 from users x where lower(x.email) = lower(i.email)) as account_exists
          from organization_invitations i
          join organizations o on o.id = i.organization_id
          join roles r on r.id = i.role_id
          left join users u on u.id = i.invited_by_user_id
          where i.token_hash = ${tokenHash}
        `);
        return rows[0] ?? null;
      });
      if (!row) throw ApiError.notFound('Invitation');
      return {
        organizationName: row.organization_name,
        inviterName: row.inviter_name,
        roleName: row.role_name,
        email: row.email,
        status: row.status === 'pending' && row.expired ? 'expired' : row.status,
        accountExists: row.account_exists,
      };
    },

    async acceptNew({ token, name, password, email }) {
      const preview = await this.preview(token);
      // A supplied email must be the invited one; the invitation decides the
      // address, never the request.
      if (email !== undefined && email.toLowerCase() !== preview.email.toLowerCase()) {
        throw ApiError.notFound('Invitation');
      }
      if (preview.status !== 'pending') {
        throw ApiError.gone('This invitation is no longer valid');
      }
      if (preview.accountExists) {
        throw ApiError.conflict('An account already exists for this email. Sign in to join.');
      }

      // Sign-up and the claim+membership are two transactions (Better Auth owns its
      // own connection, and the membership needs the user id), so the claim cannot
      // come first. Instead, if the claim loses (revoked, resent, expired, raced),
      // the just-created account, which has no memberships yet, is deleted.
      let created;
      try {
        created = await auth.api.signUpEmail({
          body: { email: preview.email, password, name },
          returnHeaders: true,
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 422 || status === 409) {
          throw ApiError.conflict('An account already exists for this email. Sign in to join.');
        }
        if (status === 400) {
          throw ApiError.validation([{ field: 'password', message: 'Use a password of 8 to 128 characters.' }]);
        }
        throw error;
      }
      const userId = created.response.user.id;
      const sessionToken = created.response.token;
      if (!sessionToken) throw new Error('sign-up returned no session');

      let organizationId: string;
      try {
        ({ organizationId } = await this.accept({ token, userId, userEmail: preview.email }));
      } catch (error) {
        await (await auth.$context).internalAdapter.deleteUser(userId);
        throw error;
      }
      return {
        organizationId,
        userId,
        sessionToken,
        cookies: created.headers.getSetCookie(),
      };
    },

    async resend(actor, invitationId) {
      const token = randomBytes(32).toString('base64url');
      const row = await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          // Same rule as create(): you may only re-issue an invite for a role you could grant.
          const found = await tx.execute<{ role_key: string }>(sql`
            select r.key as role_key from organization_invitations i
            join roles r on r.id = i.role_id
            where i.id = ${invitationId} and i.organization_id = ${actor.organizationId}
          `);
          const inviteRole = found[0]?.role_key;
          if (
            inviteRole !== undefined &&
            (!isSystemRole(actor.roleKey) ||
              !isSystemRole(inviteRole) ||
              !canAssignRole(actor.roleKey, inviteRole))
          ) {
            throw ApiError.forbidden('Only an Owner can invite an Owner');
          }
          try {
            const rows = await tx.execute<{ email: string }>(sql`
              update organization_invitations
              set token_hash = ${hashToken(token)}, status = 'pending',
                  expires_at = now() + make_interval(hours => ${INVITATION_TTL_HOURS}),
                  updated_at = now()
              where id = ${invitationId}
                and organization_id = ${actor.organizationId}
                and status in ('pending', 'expired')
              returning email
            `);
            if (rows[0]) return rows[0];
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict('A pending invitation for that email already exists');
            }
            throw error;
          }
          const exists = await tx.execute(sql`
            select 1 from organization_invitations
            where id = ${invitationId} and organization_id = ${actor.organizationId}
          `);
          if (exists.length === 0) throw ApiError.notFound('Invitation');
          throw ApiError.conflict('That invitation was already used or revoked');
        },
      );

      const acceptUrl = `${webUrl}/invitations/accept?token=${token}`;
      await sendInviteEmail(row.email, await companyName(actor), acceptUrl);
      await audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'invitation.resent',
        resourceType: 'invitation',
        resourceId: invitationId,
      });
      // The link goes only to the invited mailbox; never back to the caller.
      return { id: invitationId };
    },
  };
}
