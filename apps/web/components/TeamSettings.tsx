'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/input';
import { Notice, Surface } from './ui/page';
import { SkeletonCard } from './ui/skeleton';
import { loginPathForReturn } from '../lib/auth-redirect';
import {
  ApiClientError,
  changeMemberRole,
  invitations as fetchInvitations,
  invite,
  me,
  members as fetchMembers,
  type Invitation,
  type Me,
  type Member,
} from '../lib/api';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  administrator: 'Administrator',
  agent_manager: 'Hiring voice manager',
  knowledge_manager: 'Documents manager',
  recruiter: 'Recruiter',
  analyst: 'Analyst',
  viewer: 'Viewer',
};

const ROLE_ACCESS: Record<string, string> = {
  owner: 'Full company control, including inviting people and deleting the company.',
  administrator: 'Run the hiring desk end to end. Cannot delete the company.',
  agent_manager: 'Set up and publish hiring voices for screens.',
  knowledge_manager: 'Add and edit company documents.',
  recruiter: 'Jobs, candidates, and Call phone.',
  analyst: 'Read hiring numbers only.',
  viewer: 'See jobs and outcomes only.',
};

const ASSIGNABLE_ROLES = [
  ['viewer', 'Viewer'],
  ['recruiter', 'Recruiter'],
  ['analyst', 'Analyst'],
  ['knowledge_manager', 'Documents manager'],
  ['agent_manager', 'Hiring voice manager'],
  ['administrator', 'Administrator'],
] as const;

const ASSIGNABLE_ROLE_KEYS: ReadonlySet<string> = new Set(
  ASSIGNABLE_ROLES.map(([value]) => value),
);

function roleLabel(key: string): string {
  return ROLE_LABEL[key] ?? key.replace(/_/g, ' ');
}

function roleAccess(key: string): string {
  return ROLE_ACCESS[key] ?? 'Access for this company is set by their attached role.';
}

export function TeamSettings() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [memberRows, setMemberRows] = useState<Member[]>([]);
  const [inviteRows, setInviteRows] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const profileData = await me();
      setProfile(profileData);

      const permissions = new Set(
        profileData.activeOrganization?.permissions ?? [],
      );

      if (
        profileData.activeOrganization &&
        permissions.has('users.read')
      ) {
        setMemberRows((await fetchMembers()).members);
        setInviteRows((await fetchInvitations()).invitations);
      } else {
        setMemberRows([]);
        if (
          profileData.activeOrganization &&
          permissions.has('users.invite')
        ) {
          setInviteRows((await fetchInvitations()).invitations);
        } else {
          setInviteRows([]);
        }
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn('/settings'));
      } else {
        setNotice('Could not load team. Refresh to retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    const emailedTo = inviteEmail.trim();
    try {
      const created = await invite(emailedTo, inviteRole);
      setInviteEmail('');
      setLastInviteUrl(created.acceptUrl);
      setNotice(
        `Invite sent to ${emailedTo}. They get an email with the join link. Copy below if they need a backup.`,
      );
      await reload();
    } catch (e) {
      setLastInviteUrl(null);
      setNotice(
        e instanceof ApiClientError ? e.message : 'Invitation failed.',
      );
    }
  }

  async function onAttachRole(membershipId: string, roleKey: string) {
    setBusyMembershipId(membershipId);
    setNotice(null);
    try {
      await changeMemberRole(membershipId, roleKey);
      setNotice('Access updated. They sign in again to pick up the new role.');
      await reload();
    } catch (e) {
      setNotice(
        e instanceof ApiClientError
          ? e.message
          : 'Could not update their access.',
      );
    } finally {
      setBusyMembershipId(null);
    }
  }

  const active = profile?.activeOrganization;
  const permissions = new Set(active?.permissions ?? []);

  if (!active) {
    return null;
  }

  if (
    !permissions.has('users.read') &&
    !permissions.has('users.invite')
  ) {
    return null;
  }

  if (loading) {
    return <SkeletonCard />;
  }

  return (
    <Surface className="space-y-4">
      {notice ? <Notice kind="ok">{notice}</Notice> : null}

      <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
        People who can sign in to this company and what they can do here.
      </p>

      {permissions.has('users.read') ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[var(--foreground-tertiary)]">
                <th className="px-2 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((m) => (
                <tr
                  key={m.membershipId}
                  className="border-t border-[var(--separator-subtle)]"
                >
                  <td className="px-2 py-3 align-top">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-[var(--foreground-tertiary)]">
                      {m.email}
                    </div>
                  </td>
                  <td className="px-2 py-3 align-top">
                    {permissions.has('roles.assign') &&
                    ASSIGNABLE_ROLE_KEYS.has(m.roleKey) &&
                    profile &&
                    m.userId !== profile.user.id ? (
                      <Select
                        value={m.roleKey}
                        disabled={busyMembershipId === m.membershipId}
                        aria-label={`Role for ${m.name || m.email}`}
                        onChange={(e) =>
                          void onAttachRole(m.membershipId, e.target.value)
                        }
                        className="w-auto min-w-[8.5rem]"
                      >
                        {ASSIGNABLE_ROLES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <strong className="font-semibold">
                        {roleLabel(m.roleKey)}
                      </strong>
                    )}
                    <p className="mt-1 mb-0 max-w-xs text-xs text-[var(--foreground-tertiary)]">
                      {roleAccess(m.roleKey)}
                    </p>
                  </td>
                  <td className="px-2 py-3 align-top">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {permissions.has('users.invite') ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <UserPlus
              className="h-4 w-4 text-[var(--foreground-tertiary)]"
              aria-hidden
            />
            <h3 className="m-0 text-sm font-semibold">Invite someone</h3>
          </div>
          <form
            onSubmit={onInvite}
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <Field label="Email" className="sm:min-w-[14rem] sm:flex-1">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@company.com"
                required
              />
            </Field>
            <Field label="Role" className="sm:w-auto sm:min-w-[10rem]">
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                {ASSIGNABLE_ROLES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Invite</Button>
          </form>
          <p className="mt-2 mb-0 text-xs text-[var(--foreground-tertiary)]">
            {roleAccess(inviteRole)}
          </p>
          {lastInviteUrl ? (
            <div className="mt-3 rounded-md border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] p-3">
              <p className="m-0 mb-2 text-sm text-[var(--foreground-secondary)]">
                Backup join link (expires in 72 hours):
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  value={lastInviteUrl}
                  aria-label="Invitation accept link"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastInviteUrl).then(
                      () => setNotice('Invite link copied.'),
                      () =>
                        setNotice(
                          'Could not copy — select the link and copy it.',
                        ),
                    );
                  }}
                >
                  Copy link
                </Button>
              </div>
            </div>
          ) : null}
          {inviteRows.filter((i) => i.status === 'pending').length > 0 ? (
            <ul className="mt-3 mb-0 list-disc pl-5 text-sm text-[var(--foreground-tertiary)]">
              {inviteRows
                .filter((i) => i.status === 'pending')
                .map((i) => (
                  <li key={i.id}>
                    {i.email} — {roleLabel(i.roleKey)}, expires{' '}
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
}
