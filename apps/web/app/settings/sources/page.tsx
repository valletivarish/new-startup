'use client';

import { ConnectedSystemsSection } from '@/components/settings/connected-systems';
import { useSettings } from '../use-settings';

export default function SourcesSettingsPage() {
  const { profile } = useSettings();
  return profile ? <ConnectedSystemsSection profile={profile} /> : null;
}
