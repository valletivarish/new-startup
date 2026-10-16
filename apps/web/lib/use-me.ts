import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { me } from './api';

export const meQueryKey = ['me'] as const;

/** The signed-in person and their active workspace. One cached request for the whole app. */
export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: me });
}

/** `can(key)` for the active workspace. False until `ready`, so gated controls never flash. */
export function usePermissions() {
  const { data, isSuccess } = useMe();
  const permissions = data?.activeOrganization?.permissions;
  const can = useCallback((key: string) => permissions?.includes(key) ?? false, [permissions]);
  return { can, ready: isSuccess };
}
