'use client';

/**
 * Settings › Team (spec 8): the people in the workspace with their access levels, the invites
 * that are out, and the invite dialog. Every change that reaches a person (a new level signs
 * them out, a reset or invite emails them) or removes something asks first.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, KeyRound, Link2, UserMinus, UserPlus } from 'lucide-react';
import {
  changeMemberRole,
  invitations as fetchInvitations,
  invite,
  listRoles,
  members as fetchMembers,
  removeMember,
  resendInvitation,
  revokeInvitation,
  sendMemberPasswordReset,
  type Invitation,
  type InviteResult,
  type Me,
  type Member,
  type Role,
} from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { useUseCase } from '@/lib/use-cases';
import { UserInitials } from '@/components/shared/user-initials';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { CopyField } from '@/components/ui/copy-field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { StatusBadge, StatusTag } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import {
  BUILT_IN_LEVELS,
  accessBlurb,
  accessName,
  canGrant,
  sortLevels,
  teamKeys,
  type Granter,
} from './settings/access';
import { SectionHead } from './settings/sections';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the confirm dialog is asking about. */
type Pending =
  | { kind: 'level'; member: Member; level: Role }
  | { kind: 'reset'; member: Member }
  | { kind: 'remove'; member: Member }
  | { kind: 'resend'; invitation: Invitation }
  | { kind: 'revoke'; invitation: Invitation };

/** The invite dialog: the form, or the link it made (a new invite, or a fresh link for an old one). */
type InviteDialogState = { step: 'form' } | { step: 'link'; email: string; result: InviteResult; renewed: boolean };

const nameOf = (m: Member) => m.name.trim() || m.email;

export function TeamSettings({
  profile,
  workspaceName,
  inviteRequested = false,
  onInviteHandled,
}: {
  profile: Me;
  workspaceName: string | null;
  /** The page was opened to invite someone (?invite=1): open the dialog once. */
  inviteRequested?: boolean;
  onInviteHandled?: () => void;
}) {
  const queryClient = useQueryClient();
  const org = profile.activeOrganization;
  const can = (p: string) => org?.permissions.includes(p) ?? false;
  const me: Granter = { role: org?.role ?? '', permissions: org?.permissions ?? [] };
  const workspace = workspaceName ?? 'this workspace';

  const people = useQuery({ queryKey: teamKeys.members, queryFn: fetchMembers, enabled: can('users.read') });
  const invites = useQuery({
    queryKey: teamKeys.invites,
    queryFn: fetchInvitations,
    enabled: can('users.read') || can('users.invite'),
  });
  const roles = useQuery({ queryKey: teamKeys.roles, queryFn: listRoles, enabled: can('roles.read') });
  // Without the list (no permission to see levels, or it failed) the built-in levels still work.
  const levels = sortLevels(roles.data?.roles ?? BUILT_IN_LEVELS);
  const grantable = levels.filter((level) => canGrant(level, me));

  const [dialog, setDialog] = useState<InviteDialogState | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A removed person or revoked invite takes its button away: focus lands on the section instead.
  const landOn = useRef<string | null>(null);

  const canInvite = can('users.invite');
  useEffect(() => {
    if (!inviteRequested) return;
    if (canInvite) setDialog({ step: 'form' });
    onInviteHandled?.();
  }, [inviteRequested, canInvite, onInviteHandled]);

  function ask(next: Pending) {
    setError(null);
    setPending(next);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'level') {
        await changeMemberRole(pending.member.membershipId, pending.level.key);
        toast.success(`${nameOf(pending.member)}’s access is now ${accessName(pending.level.key, pending.level.name)}`, {
          description: 'They pick up the change when they sign in again.',
        });
      } else if (pending.kind === 'reset') {
        await sendMemberPasswordReset(pending.member.membershipId);
        toast.success('Reset link sent', { description: `${pending.member.email} gets an email to set a new password.` });
      } else if (pending.kind === 'remove') {
        await removeMember(pending.member.membershipId);
        toast.success(`${nameOf(pending.member)} was removed from ${workspace}`);
      } else if (pending.kind === 'resend') {
        const result = await resendInvitation(pending.invitation.id);
        setDialog({ step: 'link', email: pending.invitation.email, result, renewed: true });
      } else {
        await revokeInvitation(pending.invitation.id);
        toast.success('Invite revoked', { description: `The link for ${pending.invitation.email} no longer works.` });
      }
      if (pending.kind === 'remove') landOn.current = 'team-people';
      if (pending.kind === 'revoke') landOn.current = 'team-invites';
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    } catch (e) {
      setError(messageText(toUserMessage(e, CONTEXT[pending.kind])));
    } finally {
      setBusy(false);
    }
  }

  const memberRows = people.data?.members ?? [];
  const inviteRows = invites.data?.invitations ?? [];

  return (
    <div className="space-y-10">
      {can('users.read') ? (
        <section aria-labelledby="team-people">
          <SectionHead
            id="team-people"
            title="Team members"
            count={people.data ? memberRows.length : undefined}
            description={`Everyone who can sign in to ${workspace}, and what each of them can see and do.`}
            actions={
              canInvite ? (
                <Button onClick={() => setDialog({ step: 'form' })}>
                  <UserPlus aria-hidden strokeWidth={1.5} />
                  Invite a teammate
                </Button>
              ) : null
            }
          />
          <PeopleList
            query={people}
            self={profile.user.id}
            levels={levels}
            grantable={grantable}
            me={me}
            can={can}
            onAsk={ask}
          />
        </section>
      ) : canInvite ? (
        <SectionHead
          id="team-people"
          title="Invite a teammate"
          description={`Add the people who work with you in ${workspace}.`}
          actions={
            <Button onClick={() => setDialog({ step: 'form' })}>
              <UserPlus aria-hidden strokeWidth={1.5} />
              Invite a teammate
            </Button>
          }
        />
      ) : null}

      {invites.isError && can('users.read') ? (
        <Alert
          kind="warning"
          title="Couldn’t load your invites"
          action={
            <Button variant="secondary" size="sm" loading={invites.isFetching} onClick={() => void invites.refetch()}>
              Retry
            </Button>
          }
        >
          {toUserMessage(invites.error).detail}
        </Alert>
      ) : null}

      {inviteRows.length > 0 ? (
        <section aria-labelledby="team-invites">
          <SectionHead
            id="team-invites"
            title="Invites"
            count={inviteRows.length}
            description={`Each link works for 72 hours.${canInvite ? ' Get a new link if one has run out.' : ''}`}
          />
          <ListRows
            aria-labelledby="team-invites"
            columns="minmax(0,1.4fr) minmax(0,1fr) auto auto"
            header={
              <>
                <span>Email</span>
                <span>When</span>
                <span>Status</span>
                <span className="sr-only">Actions</span>
              </>
            }
          >
            {inviteRows.map((inv) => (
              <InviteRow key={inv.id} invitation={inv} canManage={canInvite} onAsk={ask} />
            ))}
          </ListRows>
        </section>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          {dialog?.step === 'link' ? (
            <InviteLink
              email={dialog.email}
              result={dialog.result}
              renewed={dialog.renewed}
              workspace={workspace}
              onAnother={canInvite ? () => setDialog({ step: 'form' }) : undefined}
              onDone={() => setDialog(null)}
            />
          ) : (
            <InviteForm
              workspace={workspace}
              levels={grantable}
              onCancel={() => setDialog(null)}
              onSent={(email, result) => {
                setDialog({ step: 'link', email, result, renewed: false });
                void queryClient.invalidateQueries({ queryKey: teamKeys.invites });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          {...confirmCopy(pending, workspace)}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCloseAutoFocus={(event) => {
            const id = landOn.current;
            landOn.current = null;
            const heading = id ? document.getElementById(id) : null;
            if (!heading) return;
            event.preventDefault();
            heading.focus();
          }}
        />
      ) : null}
    </div>
  );
}

const CONTEXT: Record<Pending['kind'], string> = {
  level: 'change their access',
  reset: 'send the reset link',
  remove: 'remove them',
  resend: 'make a new link',
  revoke: 'revoke the invite',
};

function confirmCopy(pending: Pending, workspace: string) {
  switch (pending.kind) {
    case 'level': {
      const level = accessName(pending.level.key, pending.level.name);
      return {
        title: `Change ${nameOf(pending.member)}’s access to ${level}?`,
        body: 'They’re signed out of this workspace and pick up the change when they sign in again.',
        confirmLabel: 'Change access',
        tone: 'real-world' as const,
      };
    }
    case 'reset':
      return {
        title: `Email ${nameOf(pending.member)} a password reset link?`,
        body: `It goes to ${pending.member.email}. Their current password keeps working until they set a new one.`,
        confirmLabel: 'Send reset link',
        tone: 'real-world' as const,
      };
    case 'remove':
      return {
        title: `Remove ${nameOf(pending.member)} from ${workspace}?`,
        body: 'They lose access straight away. You can invite them again later.',
        confirmLabel: 'Remove',
        tone: 'danger' as const,
      };
    case 'resend':
      return {
        title: `Make a new invite link for ${pending.invitation.email}?`,
        body: 'The link you sent before stops working. The new one works for 72 hours.',
        confirmLabel: 'Make new link',
        tone: 'real-world' as const,
      };
    case 'revoke':
      return {
        title: `Revoke the invite for ${pending.invitation.email}?`,
        body: 'Their link stops working. You can invite them again later.',
        confirmLabel: 'Revoke invite',
        tone: 'danger' as const,
      };
  }
}

function PeopleList({
  query,
  self,
  levels,
  grantable,
  me,
  can,
  onAsk,
}: {
  query: UseQueryResult<{ members: Member[] }>;
  self: string;
  levels: Role[];
  grantable: Role[];
  me: Granter;
  can: (permission: string) => boolean;
  onAsk: (pending: Pending) => void;
}) {
  const { labels } = useUseCase();
  const loading = useHeldLoading(query.isPending);

  if (query.isError) {
    const m = toUserMessage(query.error, 'load your team');
    return (
      <ErrorState
        headingLevel={3}
        title={m.title}
        cause={m.detail}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="rounded-card border border-border bg-canvas"
      />
    );
  }
  if (loading || !query.data) return <SkeletonRows rows={3} />;

  // You first, then by name.
  const rows = [...query.data.members].sort(
    (a, b) => Number(b.userId === self) - Number(a.userId === self) || nameOf(a).localeCompare(nameOf(b)),
  );

  return (
    <>
      <ListRows
        aria-label="People"
        columns="minmax(0,1.4fr) minmax(0,1fr) auto"
        header={
          <>
            <span>Person</span>
            <span>Access level</span>
            <span className="sr-only">Actions</span>
          </>
        }
      >
        {rows.map((member) => {
          const isSelf = member.userId === self;
          const current = levels.find((l) => l.key === member.roleKey) ?? {
            id: member.roleKey,
            key: member.roleKey,
            name: member.roleName ?? '',
            description: '',
            isSystem: !member.roleKey.startsWith('custom_'),
          };
          // Nobody changes their own level or someone with more access than they have (server rules).
          const mayModify = !isSelf && canGrant(current, me);
          const options = grantable.some((l) => l.key === current.key) ? grantable : [current, ...grantable];
          const name = nameOf(member);
          return (
            <ListRow key={member.membershipId}>
              <ListRowPrimary
                avatar={<UserInitials name={name} />}
                title={name}
                meta={isSelf ? `${member.email} · you` : member.email}
              />
              <ListCell className="flex items-center gap-2 max-md:flex-1">
                {mayModify && can('roles.assign') ? (
                  <Select
                    value={member.roleKey}
                    aria-label={`Access level for ${name}`}
                    onChange={(event) => {
                      const level = options.find((l) => l.key === event.target.value);
                      if (level && level.key !== member.roleKey) onAsk({ kind: 'level', member, level });
                    }}
                    className="md:max-w-[15rem]"
                  >
                    {options.map((level) => (
                      <option key={level.key} value={level.key}>
                        {accessName(level.key, level.name)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-text">{accessName(member.roleKey, member.roleName)}</span>
                )}
                {member.status === 'suspended' ? (
                  <StatusBadge tone="warning" icon={Ban}>
                    Suspended
                  </StatusBadge>
                ) : null}
              </ListCell>
              <ListCell kind="actions">
                {mayModify && can('users.update') ? (
                  <IconButton
                    size="sm"
                    variant="quiet"
                    label={`Email ${name} a password reset link`}
                    onClick={() => onAsk({ kind: 'reset', member })}
                  >
                    <KeyRound aria-hidden strokeWidth={1.5} />
                  </IconButton>
                ) : null}
                {mayModify && can('users.deactivate') ? (
                  <IconButton
                    size="sm"
                    variant="quiet"
                    label={`Remove ${name}`}
                    onClick={() => onAsk({ kind: 'remove', member })}
                  >
                    <UserMinus aria-hidden strokeWidth={1.5} />
                  </IconButton>
                ) : null}
              </ListCell>
            </ListRow>
          );
        })}
      </ListRows>
      {rows.length === 1 && can('users.invite') ? (
        <p className="mb-0 mt-3 text-meta text-text-3">
          It’s just you so far. Invite the people who review {labels.contact.many.toLowerCase()} with you.
        </p>
      ) : null}
    </>
  );
}

function inviteWhen(inv: Invitation): string {
  if (inv.status === 'pending') return inv.expiresAt ? `Expires ${formatWhen(inv.expiresAt)}` : '';
  if (inv.status === 'expired') return inv.expiresAt ? `Expired ${formatWhen(inv.expiresAt)}` : '';
  if (inv.status === 'accepted') return inv.acceptedAt ? `Joined ${formatWhen(inv.acceptedAt)}` : '';
  return inv.createdAt ? `Sent ${formatWhen(inv.createdAt)}` : '';
}

function InviteRow({
  invitation: inv,
  canManage,
  onAsk,
}: {
  invitation: Invitation;
  canManage: boolean;
  onAsk: (pending: Pending) => void;
}) {
  const level = accessName(inv.roleKey, inv.roleName);
  return (
    <ListRow>
      <ListRowPrimary
        avatar={<UserInitials name={inv.email} />}
        title={inv.email}
        meta={inv.invitedByName ? `${level} · invited by ${inv.invitedByName}` : level}
      />
      <ListCell className="text-meta tabular-nums text-text-2">{inviteWhen(inv)}</ListCell>
      <ListCell kind="tag">
        <StatusTag domain="invite" value={inv.status} />
      </ListCell>
      <ListCell kind="actions">
        {canManage && (inv.status === 'pending' || inv.status === 'expired') ? (
          <IconButton
            size="sm"
            variant="quiet"
            label={`Make a new invite link for ${inv.email}`}
            onClick={() => onAsk({ kind: 'resend', invitation: inv })}
          >
            <Link2 aria-hidden strokeWidth={1.5} />
          </IconButton>
        ) : null}
        {canManage && inv.status === 'pending' ? (
          <IconButton
            size="sm"
            variant="quiet"
            label={`Revoke the invite for ${inv.email}`}
            onClick={() => onAsk({ kind: 'revoke', invitation: inv })}
          >
            <Ban aria-hidden strokeWidth={1.5} />
          </IconButton>
        ) : null}
      </ListCell>
    </ListRow>
  );
}

function InviteForm({
  workspace,
  levels,
  onCancel,
  onSent,
}: {
  workspace: string;
  levels: Role[];
  onCancel: () => void;
  onSent: (email: string, result: InviteResult) => void;
}) {
  const { labels } = useUseCase();
  const [email, setEmail] = useState('');
  // The least access by default: the inviter raises it on purpose.
  const [levelKey, setLevelKey] = useState(levels[0]?.key ?? 'viewer');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const level = levels.find((l) => l.key === levelKey);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const to = email.trim();
    if (!EMAIL.test(to)) {
      setEmailError('Enter an email address, like name@company.com.');
      return;
    }
    setBusy(true);
    setEmailError(null);
    setFormError(null);
    try {
      onSent(to, await invite(to, levelKey));
    } catch (e) {
      const field = toUserMessage(e).fieldErrors?.find((f) => f.field === 'email')?.message;
      if (field) setEmailError(field);
      else setFormError(messageText(toUserMessage(e, 'send the invite')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Invite someone to {workspace}</DialogTitle>
        <DialogDescription>They get a link to join. It works for 72 hours.</DialogDescription>
      </DialogHeader>
      <Field label="Email" error={emailError}>
        <Input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
          autoComplete="off"
          placeholder="name@company.com"
          required
        />
      </Field>
      <Field label="Access level" hint={level ? accessBlurb(level.key, level.description, labels) : undefined}>
        <Select value={levelKey} onChange={(event) => setLevelKey(event.target.value)}>
          {levels.map((l) => (
            <option key={l.key} value={l.key}>
              {accessName(l.key, l.name)}
            </option>
          ))}
        </Select>
      </Field>
      {formError ? <Alert kind="error">{formError}</Alert> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          <Link2 aria-hidden strokeWidth={1.5} />
          Create invite
        </Button>
      </DialogFooter>
    </form>
  );
}

function InviteLink({
  email,
  result,
  renewed,
  workspace,
  onAnother,
  onDone,
}: {
  email: string;
  result: InviteResult;
  renewed: boolean;
  workspace: string;
  onAnother?: () => void;
  onDone: () => void;
}) {
  // Resend never returns the link (it goes only to the invited mailbox); create returns it for copying.
  const link = result.inviteUrl ?? result.acceptUrl;
  const expires = formatWhen(result.invitation?.expiresAt);
  // Say "we emailed them" only when the server says the email went out.
  const delivery = !link
    ? `We emailed ${email} a new link to join ${workspace}.`
    : result.emailDelivery === 'sent'
      ? `We emailed ${email} a link to join ${workspace}.`
      : result.emailDelivery === 'not_configured'
        ? 'Email isn’t switched on for this workspace yet, so copy the link and send it to them yourself.'
        : 'Copy the link and send it to them.';

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{renewed ? 'New invite link' : 'Invite ready'}</DialogTitle>
        <DialogDescription>
          {delivery}
          {renewed ? ' The old link no longer works.' : ''}
        </DialogDescription>
      </DialogHeader>
      {link ? <CopyField label="Invite link" value={link} /> : null}
      <p className="m-0 -mt-2 text-meta text-text-3">
        {expires ? `It works until ${expires}.` : 'It works for 72 hours.'} It only works for {email}.
      </p>
      <DialogFooter>
        {onAnother ? (
          <Button type="button" variant="secondary" onClick={onAnother}>
            <UserPlus aria-hidden strokeWidth={1.5} />
            Invite someone else
          </Button>
        ) : null}
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
