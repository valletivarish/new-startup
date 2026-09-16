import { isPermission, type Permission } from '@platform/permissions';

/** Returns the first required permission the actor holds, if any. */
export function firstMatchingPermission(
  actorPermissions: ReadonlySet<string>,
  required: readonly Permission[],
): Permission | undefined {
  for (const permission of required) {
    if (isPermission(permission) && actorPermissions.has(permission)) {
      return permission;
    }
  }
  return undefined;
}
