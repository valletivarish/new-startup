'use client';

import { KnowledgeDocuments } from '@/components/settings/knowledge-documents';
import { WorkspaceName } from '@/components/settings/sections';
import { useSettings } from '../use-settings';

export default function CompanySettingsPage() {
  const { profile, can } = useSettings();
  if (!profile) return null;
  return (
    <div className="space-y-8">
      <WorkspaceName profile={profile} canRename={can('organization.update')} />
      <KnowledgeDocuments />
    </div>
  );
}
