/**
 * Dependency-injection tokens.
 *
 * Injection is by explicit token throughout, never by parameter type: the dev
 * runner (tsx) and test runner (vitest/esbuild) transform decorators but do
 * not emit decorator metadata, so type-based injection would resolve to
 * undefined at runtime. Explicit tokens make the wiring visible and
 * toolchain-independent.
 */

export const ENV = Symbol('ENV');
export const DATABASE = Symbol('DATABASE');
export const BETTER_AUTH = Symbol('BETTER_AUTH');
export const NOTIFICATIONS = Symbol('NOTIFICATIONS');
export const LOGGER = Symbol('LOGGER');

export const AUTH_CONTEXT_SERVICE = Symbol('AUTH_CONTEXT_SERVICE');
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
export const ORGANIZATIONS_SERVICE = Symbol('ORGANIZATIONS_SERVICE');
export const MEMBERS_SERVICE = Symbol('MEMBERS_SERVICE');
export const INVITATIONS_SERVICE = Symbol('INVITATIONS_SERVICE');
