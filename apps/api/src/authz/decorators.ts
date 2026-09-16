/**
 * Route authorization markers (ADR-004).
 *
 * Every route must carry exactly one of:
 *
 *   @Public()                       — no session required (health, webhooks,
 *                                     invitation acceptance by token)
 *   @Authenticated()                — session required, no organization
 *                                     context (me, org list, org switching,
 *                                     org creation)
 *   @RequirePermission('x.y')       — session + active organization + the
 *                                     named permission
 *   @RequireAnyPermission('x.y', …) — session + active organization + any
 *                                     one of the named permissions
 *
 * A route with NO marker is denied by the guard — fail closed — and the
 * route-coverage test fails the build so it never ships that way.
 *
 * Code checks permission strings, never role names. The Permission type makes
 * an unknown string a compile error.
 */

import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Permission } from '@platform/permissions';

export const AUTHZ_MODE = 'authz:mode';
export const AUTHZ_PERMISSION = 'authz:permission';
export const AUTHZ_ANY_PERMISSIONS = 'authz:anyPermissions';

export type AuthzMode = 'public' | 'authenticated' | 'permission';

export function Public(): CustomDecorator<string> {
  return SetMetadata(AUTHZ_MODE, 'public' satisfies AuthzMode);
}

export function Authenticated(): CustomDecorator<string> {
  return SetMetadata(AUTHZ_MODE, 'authenticated' satisfies AuthzMode);
}

export function RequirePermission(permission: Permission): MethodDecorator {
  return (target, key, descriptor) => {
    SetMetadata(AUTHZ_MODE, 'permission' satisfies AuthzMode)(
      target,
      key,
      descriptor,
    );
    SetMetadata(AUTHZ_PERMISSION, permission)(target, key, descriptor);
  };
}

export function RequireAnyPermission(
  ...permissions: [Permission, ...Permission[]]
): MethodDecorator {
  return (target, key, descriptor) => {
    SetMetadata(AUTHZ_MODE, 'permission' satisfies AuthzMode)(
      target,
      key,
      descriptor,
    );
    SetMetadata(AUTHZ_ANY_PERMISSIONS, permissions)(target, key, descriptor);
  };
}
