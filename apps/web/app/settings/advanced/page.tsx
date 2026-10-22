'use client';

import { DevelopersSection } from '@/components/settings/developers';
import { useSettings } from '../use-settings';

export default function AdvancedSettingsPage() {
  const { profile } = useSettings();
  return profile ? <DevelopersSection profile={profile} /> : null;
}
