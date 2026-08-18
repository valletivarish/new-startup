/**
 * The single authorization gate (ADR-004).
 *
 * Order of decisions:
 *   1. @Public               → allow without a session.
 *   2. No marker at all      → DENY. Fail closed. The route-coverage test
 *                              also fails the build, but the guard does not
 *                              rely on that.
 *   3. No valid session      → 401.
 *   4. @Authenticated        → allow.
 *   5. @RequirePermission    → require an active organization whose live
 *                              membership holds the permission; 403 + audit
 *                              on denial; audit on sensitive-permission use.
 */

import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { isPermission, isSensitivePermission } from '@platform/permissions';

import { ApiError } from '../errors.js';
import {
  AUTHZ_MODE,
  AUTHZ_PERMISSION,
  type AuthzMode,
} from './decorators.js';
import type { AuthContext, AuthContextService } from './auth-context.js';
import type { AuditService } from '../audit/audit.service.js';
import { AUDIT_SERVICE, AUTH_CONTEXT_SERVICE } from '../tokens.js';

export interface RequestWithAuth extends FastifyRequest {
  authContext?: AuthContext;
}

function headersFromRequest(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return headers;
}

@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    // Explicit tokens throughout: tsx/vitest transform decorators but do not
    // emit decorator metadata, so type-based injection would fail at runtime.
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTH_CONTEXT_SERVICE)
    private readonly authContext: AuthContextService,
    @Inject(AUDIT_SERVICE)
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<AuthzMode | undefined>(
      AUTHZ_MODE,
      [context.getHandler(), context.getClass()],
    );

    if (mode === 'public') return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();

    // Fail closed BEFORE touching the session: an undeclared route is a
    // programming error, and it must not become an open endpoint.
    if (mode === undefined) {
      throw ApiError.forbidden('Route declares no authorization requirement');
    }

    const ctx = await this.authContext.resolve(headersFromRequest(request));
    if (!ctx) throw ApiError.unauthorized();
    request.authContext = ctx;

    if (mode === 'authenticated') return true;

    // mode === 'permission'
    const required = this.reflector.getAllAndOverride<string | undefined>(
      AUTHZ_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || !isPermission(required)) {
      throw ApiError.forbidden('Route declares no valid permission');
    }

    if (!ctx.organization) {
      throw ApiError.forbidden(
        'Select an organization first (POST /auth/switch-organization)',
      );
    }

    if (!ctx.organization.permissions.has(required)) {
      await this.audit.record({
        organizationId: ctx.organization.organizationId,
        actorUserId: ctx.userId,
        eventType: 'authz.denied',
        metadata: {
          permission: required,
          role: ctx.organization.roleKey,
          method: request.method,
          url: request.url,
        },
      });
      throw ApiError.forbidden();
    }

    // Every sensitive-permission use is audited (matrix invariant 7).
    if (isSensitivePermission(required)) {
      await this.audit.record({
        organizationId: ctx.organization.organizationId,
        actorUserId: ctx.userId,
        eventType: 'authz.sensitive_access',
        metadata: { permission: required, method: request.method, url: request.url },
      });
    }

    return true;
  }
}
