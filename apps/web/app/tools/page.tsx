'use client';

/**
 * Tools (D2): what the agent does on every call today, built in, and the one thing that is later
 * work: connecting your own systems. In the sidebar's Workspace group, after Knowledge.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Clock, FileText, ListChecks, Phone, PhoneForwarded, Plug, Voicemail } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { IconTile } from '@/components/ui/empty-state';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/state-tag';
import { me, type Me } from '@/lib/api';
import { useUseCase } from '@/lib/use-cases';

interface Ability {
  icon: ReactNode;
  title: string;
  text: string;
  link?: { href: string; label: string };
}

export default function ToolsPage() {
  const { labels } = useUseCase();
  const [profile, setProfile] = useState<Me | null>(null);

  // The page is static; the profile is only for the shell. Failures leave the shell's cached one.
  const reload = useCallback(async () => {
    try {
      setProfile(await me());
    } catch {
      // A 401 is already on its way to sign-in (lib/api).
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const job = labels.workItem.one.toLowerCase();
  const jobs = labels.workItem.many.toLowerCase();
  const contact = labels.contact.one.toLowerCase();
  const contacts = labels.contact.many.toLowerCase();

  const abilities: Ability[] = [
    {
      icon: <Phone />,
      title: `Calls your ${contacts}`,
      text: `Phones each ${contact} you add to a ${job}, or takes a test call in your browser.`,
      link: { href: '/jobs', label: `Open ${jobs}` },
    },
    {
      icon: <ListChecks />,
      title: 'Asks your questions',
      text: `Asks each ${job}’s must-ask questions and answers from the ${job} description and your company facts.`,
      link: { href: '/knowledge', label: 'Open knowledge' },
    },
    {
      icon: <PhoneForwarded />,
      title: 'Hands the call to a person',
      text: `Transfers the call to someone on your team when a ${contact} asks for a person.`,
      link: { href: '/agents', label: 'Set hand-off numbers' },
    },
    {
      icon: <Voicemail />,
      title: 'Notices voicemail',
      text: 'Marks the call as reached voicemail, so you can call again later.',
    },
    {
      icon: <FileText />,
      title: 'Writes it all down',
      text: 'The recording, transcript, a summary and each answer, ready for you to review. It never recommends who to hire.',
      link: { href: '/calls', label: 'Open calls' },
    },
  ];

  return (
    <AppShell profile={profile}>
      <PageMain>
        <PageHeader
          title="What the agent"
          accent="can do"
          description="All of this is built in and works on every call. Connecting your own systems comes later."
        />

        <ul role="list" aria-label="Built in" className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {abilities.map((ability) => (
            <li key={ability.title} className="flex flex-col rounded-card border border-border bg-canvas p-5">
              <IconTile>{ability.icon}</IconTile>
              <h2 className="mb-0 mt-4 text-title font-semibold text-text">{ability.title}</h2>
              <p className="mb-0 mt-1 text-text-2">{ability.text}</p>
              {ability.link ? (
                <Link
                  href={ability.link.href}
                  // ::after takes the hit area to 44px tall without moving the line.
                  className="relative mt-auto inline-flex items-center gap-1 self-start pt-4 text-label font-medium text-text underline-offset-4 after:absolute after:-inset-x-2 after:-bottom-3 after:top-1 hover:underline"
                >
                  {ability.link.label}
                  <ChevronRight aria-hidden strokeWidth={1.5} className="size-4" />
                </Link>
              ) : null}
            </li>
          ))}
          <li className="flex flex-col rounded-card border border-dashed border-border-input bg-subtle p-5">
            <div className="flex items-start justify-between gap-3">
              <IconTile className="bg-canvas">
                <Plug />
              </IconTile>
              <StatusBadge tone="neutral" icon={Clock}>
                Later
              </StatusBadge>
            </div>
            <h2 className="mb-0 mt-4 text-title font-semibold text-text">Your own systems</h2>
            <p className="mb-0 mt-1 text-text-2">
              Sending results to the HR software you already use, and other connections. Not built yet.
            </p>
          </li>
        </ul>
      </PageMain>
    </AppShell>
  );
}
