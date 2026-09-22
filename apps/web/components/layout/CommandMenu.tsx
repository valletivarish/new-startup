'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Briefcase,
  FileText,
  Home,
  Mic,
  Phone,
  Settings,
  Users,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useHiringPeople } from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';

const GO = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/candidates', label: 'People', icon: Users },
  { href: '/calls', label: 'Activity', icon: Phone },
  { href: '/knowledge', label: 'Documents', icon: FileText },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

const CREATE = [
  { href: '/jobs?create=1', label: 'Create job', icon: Briefcase },
  { href: '/settings', label: 'Hiring voice (Settings)', icon: Mic },
] as const;

export const OPEN_COMMAND_EVENT = 'ava:open-command';

export function openCommandMenu() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
  }
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data } = useHiringPeople(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  const people = (data?.people ?? []).slice(0, 60);
  const jobHits = (data?.jobs ?? [])
    .filter((j) => j.status !== 'closed')
    .slice(0, 20);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search people, jobs, or go somewhere…" />
      <CommandList>
        <CommandEmpty>No matching people or places.</CommandEmpty>
        {people.length > 0 ? (
          <CommandGroup heading="People">
            {people.map((p) => (
              <CommandItem
                key={`${p.jobId}-${p.candidateId}`}
                value={`person ${p.fullName} ${p.jobTitle}`}
                onSelect={() => {
                  setOpen(false);
                  router.push(
                    `/jobs/${toPublicId(p.jobId)}/candidates?c=${encodeURIComponent(toPublicId(p.candidateId))}`,
                  );
                }}
              >
                <Users className="mr-2 h-4 w-4 opacity-70" aria-hidden />
                <span className="min-w-0 truncate">{p.fullName}</span>
                <span className="ml-2 truncate text-xs text-[var(--foreground-muted)]">
                  {p.jobTitle}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {jobHits.length > 0 ? (
          <CommandGroup heading="Jobs">
            {jobHits.map((j) => (
              <CommandItem
                key={j.id}
                value={`job ${j.title}`}
                onSelect={() => {
                  setOpen(false);
                  router.push(`/jobs/${toPublicId(j.id)}/candidates`);
                }}
              >
                <Briefcase className="mr-2 h-4 w-4 opacity-70" aria-hidden />
                {j.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Go">
          {GO.map((a) => (
            <CommandItem
              key={a.href}
              value={a.label}
              onSelect={() => {
                setOpen(false);
                router.push(a.href);
              }}
            >
              <a.icon className="mr-2 h-4 w-4 opacity-70" aria-hidden />
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Create">
          {CREATE.map((a) => (
            <CommandItem
              key={`${a.href}-${a.label}`}
              value={a.label}
              onSelect={() => {
                setOpen(false);
                router.push(a.href);
              }}
            >
              <a.icon className="mr-2 h-4 w-4 opacity-70" aria-hidden />
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
