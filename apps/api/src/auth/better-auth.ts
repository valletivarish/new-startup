/**
 * Better Auth configuration (ADR-002).
 *
 * The boundary is absolute and enforced here by what this file does NOT do:
 *
 *   Better Auth answers   →  who are you? are you logged in? which session?
 *   It never answers      →  which organization, role, or permission.
 *
 * Organization, membership, role and permission decisions live entirely in
 * `../authz/` (founder clarification on ADR-002). Better Auth's own
 * organization/role plugins are deliberately NOT imported.
 *
 * Sessions are opaque server-side tokens in httpOnly cookies — not JWT.
 * Deleting the row revokes the session immediately.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@platform/db';
import { schema } from '@platform/db';
import type { NotificationProvider } from '@platform/providers';

import type { Env } from '../config.js';

export interface AuthDeps {
  readonly db: PlatformDatabase<Record<string, never>>;
  readonly env: Env;
  readonly notifications: NotificationProvider;
  /** Called after auth events so the platform can write audit rows. */
  readonly onAuthEvent: (event: {
    readonly type: 'auth.user_registered' | 'auth.session_created';
    readonly userId: string;
  }) => Promise<void>;
}

export function createAuth(deps: AuthDeps) {
  const { db, env, notifications, onAuthEvent } = deps;

  return betterAuth({
    baseURL: env.API_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_URL],

    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),

    advanced: {
      database: {
        // Uuid everywhere so every foreign key in the system has one type.
        generateId: () => randomUUID(),
      },
      useSecureCookies: env.COOKIE_SECURE,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },

    session: {
      expiresIn: env.SESSION_EXPIRY_SECONDS,
      // Fresh reads on every request — authorization must never act on a
      // cached session after a role change has invalidated it.
      cookieCache: { enabled: false },
      additionalFields: {
        activeOrganizationId: { type: 'string', required: false, input: false },
      },
    },

    user: {
      additionalFields: {
        // Platform-level status. `input: false` — never client-settable.
        status: { type: 'string', required: false, input: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      // A password reset means the credential may have been compromised.
      // Every existing session dies with it (audit finding — the library
      // default keeps them alive).
      revokeSessionsOnPasswordReset: true,
      // Phase 1: login permitted before verification; the flag is exposed on
      // /auth/me so the dashboard can prompt. Flip when a real email provider
      // replaces the console transport.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await notifications.sendEmail({
          to: user.email,
          subject: 'Reset your password',
          text: `Reset your password: ${url}`,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await notifications.sendEmail({
          to: user.email,
          subject: 'Verify your email',
          text: `Verify your email address: ${url}`,
        });
      },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await onAuthEvent({ type: 'auth.user_registered', userId: user.id });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await onAuthEvent({
              type: 'auth.session_created',
              userId: session.userId,
            });
          },
        },
      },
    },
  });
}

/** The concrete configured instance type, inferred rather than annotated —
 * annotating with the generic `Auth` erases the config-specific pieces. */
export type BetterAuthInstance = ReturnType<typeof createAuth>;
