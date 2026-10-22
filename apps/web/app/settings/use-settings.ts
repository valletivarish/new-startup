'use client';

import { useQuery } from '@tanstack/react-query';
import { organizationsQueryKey } from '@/components/layout/app-shell/account';
import { myOrganizations } from '@/lib/api';
import { useMe } from '@/lib/use-me';

/** What every Settings page needs: the profile, a permission check and the workspace's name. */
export function useSettings() {
  const me = useMe();
  const profile = me.data ?? null;
  const org = profile?.activeOrganization ?? null;
  const orgs = useQuery({
    queryKey: organizationsQueryKey,
    queryFn: myOrganizations,
    enabled: Boolean(org),
    staleTime: 5 * 60_000,
  });
  return {
    me,
    profile,
    hasOrg: Boolean(org),
    can: (p: string) => org?.permissions.includes(p) ?? false,
    workspaceName: orgs.data?.organizations.find((o) => o.id === org?.id)?.name.trim() || null,
  };
}
