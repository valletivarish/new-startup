'use client';

/**
 * Tools catalogue is a later layer. Day-one hiring desk keeps this route soft-gated
 * so a bookmarked URL does not drop recruiters into form-builder chrome.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Button } from '../../components/ui/button';
import {
  EmptyState,
  Notice,
  PageHeader,
  PageMain,
} from '../../components/ui/page';
import { SkeletonCard } from '../../components/ui/skeleton';
import { ApiClientError, me, type Me } from '../../lib/api';
import { loginPathForReturn } from '../../lib/auth-redirect';

export default function ToolsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setProfile(await me());
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
      } else {
        setNotice(
          e instanceof ApiClientError ? e.message : 'Could not load.',
        );
      }
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain>
          {notice ? <Notice kind="err">{notice}</Notice> : <SkeletonCard />}
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Tools"
          description="Custom tool wiring ships later. Hiring screens today use Jobs, People, and Activity."
        />
        <EmptyState
          icon={<Wrench className="h-5 w-5" aria-hidden />}
          title="Not needed for day-one hiring"
          description="Your hiring voice already has what it needs for phone screens on each role."
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/jobs">Go to Jobs</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/settings">Settings</Link>
              </Button>
            </div>
          }
        />
      </PageMain>
    </AppShell>
  );
}
