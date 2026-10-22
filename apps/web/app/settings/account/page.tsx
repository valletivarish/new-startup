'use client';

import { AccountSection } from '@/components/settings/sections';
import { useSettings } from '../use-settings';

export default function AccountSettingsPage() {
  const { profile, workspaceName } = useSettings();
  return profile ? <AccountSection profile={profile} workspaceName={workspaceName} /> : null;
}
