'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, ChevronRight, ChevronsUpDown, LogOut, RotateCw, UserRound } from 'lucide-react';
import {
  formatApiError,
  myOrganizations,
  signOut,
  switchOrganization,
  type Me,
  type OrganizationSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { UserInitials } from '@/components/shared/user-initials';
import { MENU, OrgAvatar, PLACEHOLDER, RAIL } from './parts';
import { adminLinks, gate } from './nav';

/** Invalidate after renaming or joining a workspace. */
export const organizationsQueryKey = ['organizations'] as const;

const orgName = (org: OrganizationSummary) => org.name.trim() || 'Untitled workspace';

function useWorkspaces(profile: Me | null) {
  const query = useQuery({
    queryKey: organizationsQueryKey,
    queryFn: myOrganizations,
    enabled: Boolean(profile),
    staleTime: 5 * 60_000,
  });
  const [switching, setSwitching] = useState(false);
  const activeId = profile?.activeOrganization?.id ?? null;
  const orgs = query.data?.organizations ?? [];

  function choose(id: string) {
    if (id === activeId || switching) return;
    setSwitching(true);
    switchOrganization(id)
      // Every page holds data from the old workspace, so start clean on Home.
      .then(() => window.location.assign('/dashboard'))
      .catch((error: unknown) => {
        setSwitching(false);
        toast.error(formatApiError(error, 'We couldn’t switch workspaces. Try again.'));
      });
  }

  return {
    query,
    orgs,
    activeId,
    active: orgs.find((o) => o.id === activeId) ?? null,
    canSwitch: orgs.some((o) => o.id !== activeId),
    switching,
    choose,
  };
}

type Workspaces = ReturnType<typeof useWorkspaces>;

function WorkspaceChoices({ ws }: { ws: Workspaces }) {
  return (
    <Menu.RadioGroup value={ws.activeId ?? ''} onValueChange={ws.choose}>
      {ws.orgs.map((org) => (
        <Menu.RadioItem key={org.id} value={org.id} className={MENU.item}>
          <OrgAvatar name={orgName(org)} className="size-6" />
          <span className="min-w-0 flex-1 truncate">{orgName(org)}</span>
          <Menu.ItemIndicator>
            <Check aria-hidden strokeWidth={1.5} className="size-4 text-text" />
          </Menu.ItemIndicator>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}

/** Rail only: the tooltip shows the name the rail hides. It repeats the name, so it doesn't describe. */
function railTip(rail: boolean, name: string, trigger: ReactElement) {
  return rail ? (
    <Tooltip content={name} side="right">
      {trigger}
    </Tooltip>
  ) : (
    trigger
  );
}

const PILL = 'flex h-11 w-full items-center gap-2.5 rounded-input border border-border bg-canvas px-2 text-left text-label shadow-xs';

/** Sidebar pill with the active workspace's real name; a menu to switch when there is another. */
export function WorkspaceSwitcher({ profile, rail }: { profile: Me | null; rail: boolean }) {
  const ws = useWorkspaces(profile);

  if (!profile || ws.query.isPending) {
    return (
      <div aria-hidden className={cn(PILL, RAIL.center)}>
        <span className={cn(PLACEHOLDER.onCanvas, 'size-7 shrink-0 rounded-xs')} />
        <span className={cn(PLACEHOLDER.onCanvas, 'h-3 w-24 rounded-pill', RAIL.hidden)} />
      </div>
    );
  }

  if (ws.query.isError) {
    const failed = 'Workspace didn’t load';
    return railTip(
      rail,
      `${failed}. Try again`,
      <button
        type="button"
        onClick={() => void ws.query.refetch()}
        aria-label={`${failed}. Try again`}
        aria-describedby={undefined}
        className={cn(PILL, 'pl-3 transition-colors hover:bg-subtle', RAIL.center)}
      >
        <span className={cn('min-w-0 flex-1 truncate text-text-2', RAIL.hidden)}>{failed}</span>
        <RotateCw aria-hidden strokeWidth={1.5} className="size-[1.125rem] shrink-0 text-text-2" />
      </button>,
    );
  }

  const name = ws.active ? orgName(ws.active) : ws.canSwitch ? 'Choose a workspace' : 'No workspace yet';
  const content = (
    <>
      <OrgAvatar name={ws.active ? name : ''} className={ws.active ? undefined : 'bg-muted text-text-2'} />
      <span className={cn('min-w-0 flex-1 truncate font-medium', ws.active ? 'text-text' : 'text-text-2', RAIL.srOnly)}>
        {ws.switching ? 'Switching…' : name}
      </span>
      {ws.canSwitch ? (
        <ChevronsUpDown aria-hidden strokeWidth={1.5} className={cn('size-4 shrink-0 text-text-3', RAIL.hidden)} />
      ) : null}
    </>
  );

  if (!ws.canSwitch) return <div className={cn(PILL, RAIL.center)}>{content}</div>;

  return (
    <Menu.Root>
      {railTip(
        rail,
        name,
        <Menu.Trigger
          aria-describedby={undefined}
          aria-busy={ws.switching || undefined}
          className={cn(PILL, 'transition-colors hover:bg-subtle data-[state=open]:bg-subtle', RAIL.center)}
        >
          {content}
        </Menu.Trigger>,
      )}
      <Menu.Portal>
        <Menu.Content
          side={rail ? 'right' : 'bottom'}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={MENU.panel}
        >
          <Menu.Label className={cn(MENU.label, 'text-caption text-text-3')}>Workspaces</Menu.Label>
          <WorkspaceChoices ws={ws} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function signOutNow() {
  signOut()
    // A full page load drops everything cached for this session.
    .then(() => window.location.assign('/login'))
    .catch((error: unknown) => toast.error(formatApiError(error, 'We couldn’t sign you out. Try again.')));
}

/**
 * The person's menu: Your account, Switch workspace (when there is another), platform pages for
 * the platform owner, Sign out.
 * `row` sits at the foot of the sidebar; `avatar` in the canvas header and the phone top bar.
 */
export function UserMenu({
  profile,
  variant,
  rail = false,
}: {
  profile: Me | null;
  variant: 'row' | 'avatar';
  rail?: boolean;
}) {
  const ws = useWorkspaces(profile);

  if (!profile) {
    return variant === 'row' ? (
      <div aria-hidden className={cn('flex h-14 items-center gap-3 px-2', RAIL.center)}>
        <span className={cn(PLACEHOLDER.onGround, 'size-8 shrink-0 rounded-pill')} />
        <span className={cn('flex flex-1 flex-col gap-1.5', RAIL.hidden)}>
          <span className={cn(PLACEHOLDER.onGround, 'h-3 w-24 rounded-pill')} />
          <span className={cn(PLACEHOLDER.onGround, 'h-2.5 w-32 rounded-pill')} />
        </span>
      </div>
    ) : (
      // Sits on the canvas header and on the phone's ground: a white circle with a hairline shows on both.
      <span aria-hidden className={cn(PLACEHOLDER.onGround, 'm-0.5 size-10 shrink-0 rounded-pill border border-border')} />
    );
  }

  const admin = gate(adminLinks, profile.isPlatformAdmin ? ['platform.admin'] : []);
  const { email } = profile.user;
  const name = profile.user.name.trim() || email;

  const trigger =
    variant === 'row' ? (
      <Menu.Trigger
        aria-describedby={undefined}
        className={cn(
          'flex h-14 w-full items-center gap-3 rounded-input px-2 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted',
          RAIL.center,
        )}
      >
        <UserInitials name={name} />
        <span className={cn('min-w-0 flex-1', RAIL.srOnly)}>
          <span className="block truncate text-label font-medium text-text">{name}</span>
          <span className="block truncate text-caption text-text-3">{email}</span>
        </span>
        <ChevronsUpDown aria-hidden strokeWidth={1.5} className={cn('size-4 shrink-0 text-text-3', RAIL.hidden)} />
      </Menu.Trigger>
    ) : (
      <Menu.Trigger
        aria-label="Account menu"
        className="grid size-11 shrink-0 place-items-center rounded-pill transition-colors hover:bg-muted data-[state=open]:bg-muted"
      >
        <UserInitials name={name} size="lg" />
      </Menu.Trigger>
    );

  return (
    <Menu.Root>
      {variant === 'row' ? railTip(rail, name, trigger) : trigger}
      <Menu.Portal>
        <Menu.Content
          side={variant === 'avatar' ? 'bottom' : rail ? 'right' : 'top'}
          align={variant === 'avatar' || rail ? 'end' : 'start'}
          sideOffset={8}
          collisionPadding={12}
          className={MENU.panel}
        >
          <Menu.Label className={MENU.label}>
            <span className="block truncate font-medium text-text">{name}</span>
            <span className="block truncate text-caption text-text-3">{email}</span>
          </Menu.Label>
          <Menu.Separator className={MENU.separator} />
          <Menu.Item asChild className={MENU.item}>
            <Link href="/settings?section=account">
              <UserRound aria-hidden strokeWidth={1.5} />
              Your account
            </Link>
          </Menu.Item>
          {ws.canSwitch ? (
            <Menu.Sub>
              <Menu.SubTrigger className={MENU.item}>
                <ArrowLeftRight aria-hidden strokeWidth={1.5} />
                <span className="flex-1">Switch workspace</span>
                <ChevronRight aria-hidden strokeWidth={1.5} />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent sideOffset={6} collisionPadding={12} className={MENU.panel}>
                  <WorkspaceChoices ws={ws} />
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
          ) : null}
          {admin.map((item) => (
            <Menu.Item key={item.href} asChild className={MENU.item}>
              <Link href={item.href}>
                <item.icon aria-hidden strokeWidth={1.5} />
                {item.label}
              </Link>
            </Menu.Item>
          ))}
          <Menu.Separator className={MENU.separator} />
          <Menu.Item className={MENU.item} onSelect={signOutNow}>
            <LogOut aria-hidden strokeWidth={1.5} />
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
