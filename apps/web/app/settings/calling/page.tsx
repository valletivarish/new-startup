'use client';

import { AutoAdvance, CallingNumber } from '@/components/settings/sections';
import { useSettings } from '../use-settings';

export default function CallingSettingsPage() {
  const { profile, can } = useSettings();
  if (!profile) return null;
  return (
    <div className="space-y-4">
      <CallingNumber canTest={can('agents.read')} />
      {can('organization.read') ? <AutoAdvance canEdit={can('organization.update')} /> : null}
    </div>
  );
}
