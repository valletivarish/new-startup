'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BriefcaseBusiness, CircleAlert, Plus, UserPlus, UsersRound } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from '@/components/ui/command';
import { buildNav, gate } from '@/components/layout/app-shell/nav';
import { UserInitials } from '@/components/shared/user-initials';
import { useHiringPeople } from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { HIRING_USE_CASE } from '@/lib/use-case-definitions';
import { useMe } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';

export const OPEN_COMMAND_EVENT = 'ava:open-command';

/** Opens the command menu from anywhere inside the app shell. */
export function openCommandMenu() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
  }
}

type Labels = typeof HIRING_USE_CASE.labels;
/** "Search jobs and candidates", in the use case's words. The shell's search pill says the same. */
export const searchTitle = (labels: Labels) =>
  `Search ${labels.workItem.many.toLowerCase()} and ${labels.contact.many.toLowerCase()}`;

/**
 * ⌘K or Ctrl K: search jobs and candidates, go anywhere, start a task. AppProviders mounts it
 * once; it answers only inside the app shell, so the website and sign-in pages never open it.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && document.querySelector('[data-app-shell]')) {
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

  return (
    // The bundled words name the dialog: no request on pages that never open it.
    <CommandDialog open={open} onOpenChange={setOpen} title={searchTitle(HIRING_USE_CASE.labels)}>
      {/* Mounted only while open, so its queries run only then. */}
      <Palette onDone={() => setOpen(false)} />
    </CommandDialog>
  );
}

function Palette({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { labels } = useUseCase();
  // The app shell keeps this cache on the page's profile, so it is usually there already.
  const { data: profile } = useMe();
  const permissions = profile ? (profile.activeOrganization?.permissions ?? null) : undefined;
  const can = (key: string) => permissions?.includes(key) ?? false;
  const people = useHiringPeople(can('jobs.read'));

  const nav = buildNav(labels);
  const visible = <T extends { permission?: string }>(items: T[]) =>
    gate(items, permissions).filter((item) => !item.pending);
  const goItems = visible(nav.main);
  const createItems = visible([
    { href: '/jobs?create=1', label: `New ${labels.workItem.one.toLowerCase()}`, icon: Plus, permission: 'jobs.create' },
    { href: '/jobs', label: 'Add people', icon: UsersRound, permission: 'candidates.create' },
    { href: '/settings/team?invite=1', label: 'Invite a teammate', icon: UserPlus, permission: 'users.invite' },
  ]);

  // Records join in once someone types, so an empty box stays a short list of places.
  const searching = search.trim().length > 0;
  const loading = searching && people.isLoading;
  const jobs = searching ? (people.data?.jobs ?? []).filter((j) => j.status !== 'closed').slice(0, 20) : [];
  const contacts = searching && can('candidates.read') ? (people.data?.people ?? []).slice(0, 60) : [];
  const records = `${labels.workItem.many.toLowerCase()} and ${labels.contact.many.toLowerCase()}`;

  function goTo(href: string) {
    onDone();
    router.push(href);
  }

  return (
    <>
      <CommandInput value={search} onValueChange={setSearch} placeholder={searchTitle(labels)} />
      <CommandList>
        {loading ? <CommandLoading>Loading {records}…</CommandLoading> : null}
        {searching && people.isError ? (
          <CommandItem forceMount value="retry loading records" onSelect={() => void people.refetch()}>
            <CircleAlert aria-hidden strokeWidth={1.5} />
            {`Couldn’t load ${records}. Try again`}
          </CommandItem>
        ) : null}
        {/* Never "no matches" while records are still on their way. */}
        {loading ? null : <CommandEmpty>No matches for “{search.trim()}”.</CommandEmpty>}

        <CommandGroup heading="Go to">
          {goItems.map((item) => (
            <CommandItem key={item.href} value={`go ${item.label}`} onSelect={() => goTo(item.href)}>
              <item.icon aria-hidden strokeWidth={1.5} />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {createItems.length > 0 ? (
          <CommandGroup heading="Create">
            {createItems.map((item) => (
              <CommandItem key={item.href} value={item.label} onSelect={() => goTo(item.href)}>
                <item.icon aria-hidden strokeWidth={1.5} />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {jobs.length > 0 ? (
          <CommandGroup heading={labels.workItem.many}>
            {jobs.map((job) => (
              <CommandItem
                key={job.id}
                value={`${job.title} ${job.id}`}
                onSelect={() => goTo(`/jobs/${toPublicId(job.id)}/people`)}
              >
                <BriefcaseBusiness aria-hidden strokeWidth={1.5} />
                <span className="min-w-0 truncate">{job.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {contacts.length > 0 ? (
          <CommandGroup heading={labels.contact.many}>
            {contacts.map((person) => (
              <CommandItem
                key={`${person.jobId}-${person.candidateId}`}
                value={`${person.fullName} ${person.jobTitle} ${person.jobId}-${person.candidateId}`}
                onSelect={() =>
                  goTo(
                    `/jobs/${toPublicId(person.jobId)}/people?c=${encodeURIComponent(toPublicId(person.candidateId))}`,
                  )
                }
              >
                <UserInitials name={person.fullName} size="sm" />
                <span className="min-w-0 flex-1 truncate">{person.fullName}</span>
                <span className="min-w-0 max-w-[45%] truncate text-meta text-text-3">{person.jobTitle}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </>
  );
}
