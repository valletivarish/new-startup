'use client';

import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { TeamSettings } from '@/components/TeamSettings';
import { AccessLevels } from '@/components/settings/access-levels';
import { useSettings } from '../use-settings';

export default function TeamSettingsPage() {
  // useSearchParams needs a boundary.
  return (
    <Suspense fallback={null}>
      <TeamBody />
    </Suspense>
  );
}

function TeamBody() {
  const { profile, can, workspaceName } = useSettings();
  const params = useSearchParams();
  // History API, not the router: the flag clears at once and Next keeps useSearchParams in step.
  const clearInvite = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  if (!profile) return null;
  return (
    <div className="space-y-8">
      <TeamSettings
        profile={profile}
        workspaceName={workspaceName}
        inviteRequested={params.get('invite') === '1'}
        onInviteHandled={clearInvite}
      />
      {can('roles.read') ? <AccessLevels /> : null}
    </div>
  );
}
