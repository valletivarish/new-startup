'use client';

import Link from 'next/link';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, Hourglass, PhoneCall, RotateCw, Unplug } from 'lucide-react';
import {
  ApiClientError,
  changePassword,
  getTelephonyStatus,
  myOrganizations,
  updateOrganization,
  updateUser,
  type Me,
} from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { meQueryKey } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';
import { Agent } from '@/components/brand/agent';
import { organizationsQueryKey } from '@/components/layout/app-shell/account';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { accessBlurb, accessName } from './access';

/** A list section's heading row: h2, a true count, one line, the section's action. */
export function SectionHead({
  id,
  title,
  count,
  description,
  actions,
}: {
  id: string;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {/* Focusable from script: focus lands here when the row that had it goes away. */}
        <h2 id={id} tabIndex={-1} className="m-0 flex items-center gap-2.5 text-section text-text">
          {title}
          {count != null ? (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-subtle px-2 text-caption font-medium tabular-nums text-text-2">
              {count}
            </span>
          ) : null}
        </h2>
        {description ? <p className="mb-0 mt-1 max-w-[65ch] text-text-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A settings card: what it is on the left, its controls on the right (stacked on phones), and
 * its one action in a footer. Pass onSubmit to make the card a form.
 */
export function SettingsCard({
  title,
  description,
  footer,
  onSubmit,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const id = useId();
  const body = (
    <>
      <div className="grid gap-x-10 gap-y-5 p-5 sm:p-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div>
          <h2 id={id} className="m-0 text-title font-semibold text-text">
            {title}
          </h2>
          {description ? <p className="mb-0 mt-1 text-text-2">{description}</p> : null}
        </div>
        <div className="min-w-0 max-w-lg space-y-4">{children}</div>
      </div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3 sm:px-6">
          {footer}
        </div>
      ) : null}
    </>
  );
  const card = 'rounded-card border border-border bg-canvas';
  return onSubmit ? (
    <form aria-labelledby={id} noValidate onSubmit={onSubmit} className={card}>
      {body}
    </form>
  ) : (
    <section aria-labelledby={id} className={card}>
      {body}
    </section>
  );
}

/** A label and its read-only value, inside a card. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="m-0 text-label font-medium text-text">{label}</p>
      <div className="mt-1 text-text-2">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Workspace                                                                                   */

export function WorkspaceSection({ profile }: { profile: Me }) {
  const can = (p: string) => profile.activeOrganization?.permissions.includes(p) ?? false;
  return (
    <div className="space-y-4">
      <WorkspaceName profile={profile} canRename={can('organization.update')} />
      <CallingNumber canTest={can('agents.read')} />
    </div>
  );
}

function WorkspaceName({ profile, canRename }: { profile: Me; canRename: boolean }) {
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: organizationsQueryKey, queryFn: myOrganizations, staleTime: 5 * 60_000 });
  const current = orgs.data?.organizations.find((o) => o.id === profile.activeOrganization?.id)?.name.trim() ?? '';
  // null until edited, so a late load or a rename elsewhere still shows in the field.
  const [draft, setDraft] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? current;
  const changed = draft !== null && draft.trim() !== current;

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = value.trim();
    if (name.length < 2) {
      setFieldError('Use at least 2 characters.');
      return;
    }
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    try {
      await updateOrganization({ name });
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      setDraft(null);
      toast.success('Workspace renamed', { description: `Everyone now sees ${name}.` });
    } catch (e) {
      const field = toUserMessage(e).fieldErrors?.find((f) => f.field === 'name')?.message;
      if (field) setFieldError(field);
      else setFormError(messageText(toUserMessage(e, 'rename the workspace')));
    } finally {
      setBusy(false);
    }
  }

  const description = 'Your team sees it in the sidebar and on every invite.';

  if (orgs.isError) {
    return (
      <SettingsCard title="Workspace name" description={description}>
        <Alert
          kind="error"
          title="Couldn’t load the workspace name"
          action={
            <Button variant="secondary" size="sm" loading={orgs.isFetching} onClick={() => void orgs.refetch()}>
              <RotateCw aria-hidden strokeWidth={1.5} />
              Retry
            </Button>
          }
        >
          {toUserMessage(orgs.error).detail}
        </Alert>
      </SettingsCard>
    );
  }

  if (!orgs.data) {
    return (
      <SettingsCard title="Workspace name" description={description}>
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-11 w-full" />
          <span className="sr-only">Loading</span>
        </div>
      </SettingsCard>
    );
  }

  if (!canRename) {
    return (
      <SettingsCard title="Workspace name" description={description}>
        <Fact label="Name">{current || 'Untitled workspace'}</Fact>
        <p className="m-0 text-meta text-text-3">Only people allowed to edit workspace settings can rename it.</p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Workspace name"
      description={description}
      onSubmit={(event) => void save(event)}
      footer={
        <Button type="submit" loading={busy} disabled={!changed}>
          Save name
        </Button>
      }
    >
      <Field label="Name" hint="For example, Sharma Logistics." error={fieldError}>
        <Input
          value={value}
          onChange={(event) => {
            setDraft(event.target.value);
            setFieldError(null);
          }}
          autoComplete="organization"
          maxLength={100}
          required
        />
      </Field>
      {formError ? <Alert kind="error">{formError}</Alert> : null}
    </SettingsCard>
  );
}

function CallingNumber({ canTest }: { canTest: boolean }) {
  const status = useQuery({ queryKey: ['telephony-status'], queryFn: getTelephonyStatus });
  const data = status.data;
  const people = useUseCase().labels.contact.many.toLowerCase();

  let body: ReactNode;
  if (status.isError) {
    body = (
      <Alert
        kind="error"
        title="Couldn’t check your calling number"
        action={
          <Button variant="secondary" size="sm" loading={status.isFetching} onClick={() => void status.refetch()}>
            <RotateCw aria-hidden strokeWidth={1.5} />
            Retry
          </Button>
        }
      >
        {toUserMessage(status.error).detail}
      </Alert>
    );
  } else if (!data) {
    body = (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-6 w-32 rounded-xs" />
        <Skeleton className="h-3 w-full max-w-sm" />
        <span className="sr-only">Loading</span>
      </div>
    );
  } else {
    // The three states the API reports. Our own words: its message names screens and voices.
    const state = !data.outboundPhone
      ? {
          badge: (
            <StatusBadge tone="neutral" icon={Unplug}>
              Not connected yet
            </StatusBadge>
          ),
          text: `We set up your calling number with you before the agent phones real ${people}. Until then, try the agent with a test call in your browser.`,
        }
      : data.openOutbound
        ? {
            badge: (
              <StatusBadge tone="success" icon={CircleCheck}>
                Ready to call
              </StatusBadge>
            ),
            text: `The agent phones ${people} from your calling number. Use Call now on anyone with a valid mobile number.`,
          }
        : {
            badge: (
              <StatusBadge tone="warning" icon={Hourglass}>
                Verification pending
              </StatusBadge>
            ),
            text: 'Your calling number is connected. Until business verification finishes, some calls may be refused. Test calls in your browser still work.',
          };
    body = (
      <div className="flex items-start gap-4">
        <Agent size={44} state="idle" colour="glass" onLight />
        <div className="min-w-0 space-y-2">
          {state.badge}
          <p className="m-0 text-text-2">{state.text}</p>
          {canTest && !data.openOutbound ? (
            <Button asChild variant="secondary" size="sm" className="mt-2">
              <Link href="/agents">
                <PhoneCall aria-hidden strokeWidth={1.5} />
                Try a test call
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <SettingsCard title="Calling number" description={`The number your AI hiring agent phones ${people} from.`}>
      {body}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Your account                                                                                */

export function AccountSection({ profile, workspaceName }: { profile: Me; workspaceName: string | null }) {
  return (
    <div className="space-y-4">
      <YourDetails profile={profile} workspaceName={workspaceName} />
      <YourPassword email={profile.user.email} />
    </div>
  );
}

function YourDetails({ profile, workspaceName }: { profile: Me; workspaceName: string | null }) {
  const queryClient = useQueryClient();
  const { labels } = useUseCase();
  const current = profile.user.name.trim();
  const [draft, setDraft] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? current;
  const changed = draft !== null && draft.trim() !== current;
  const level = profile.activeOrganization?.role;

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = value.trim();
    if (!name) {
      setFieldError('Enter your name.');
      return;
    }
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    try {
      await updateUser({ name });
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
      setDraft(null);
      toast.success('Name saved');
    } catch (e) {
      setFormError(messageText(toUserMessage(e, 'save your name')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Your details"
      description="How you appear to your team."
      onSubmit={(event) => void save(event)}
      footer={
        <Button type="submit" loading={busy} disabled={!changed}>
          Save name
        </Button>
      }
    >
      <Field label="Your name" error={fieldError}>
        <Input
          value={value}
          onChange={(event) => {
            setDraft(event.target.value);
            setFieldError(null);
          }}
          autoComplete="name"
          maxLength={200}
          required
        />
      </Field>
      <Fact label="Email">
        <span className="break-all">{profile.user.email}</span>
        <span className="mt-0.5 block text-meta text-text-3">You sign in with it. It can’t be changed here.</span>
      </Fact>
      {level ? (
        <Fact label={workspaceName ? `Your access in ${workspaceName}` : 'Your access in this workspace'}>
          <span className="font-medium text-text">{accessName(level)}</span>
          {accessBlurb(level, null, labels) ? (
            <span className="mt-0.5 block text-meta text-text-3">{accessBlurb(level, null, labels)}</span>
          ) : null}
        </Fact>
      ) : null}
      {formError ? <Alert kind="error">{formError}</Alert> : null}
    </SettingsCard>
  );
}

function YourPassword({ email }: { email: string }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setErrors({ next: 'Use at least 8 characters.' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrent('');
      setNext('');
      toast.success('Password changed', { description: 'Use the new one next time you sign in.' });
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : '';
      if (code === 'INVALID_PASSWORD') setErrors({ current: 'That isn’t your current password.' });
      else if (code === 'PASSWORD_TOO_SHORT') setErrors({ next: 'Use at least 8 characters.' });
      else if (code === 'PASSWORD_TOO_LONG') setErrors({ next: 'Use 128 characters or fewer.' });
      else setErrors({ form: messageText(toUserMessage(e, 'change your password')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Password"
      description="Change the password you sign in with."
      onSubmit={(event) => void save(event)}
      footer={
        <Button type="submit" loading={busy} disabled={!currentPassword || !newPassword}>
          Change password
        </Button>
      }
    >
      {/* Lets password managers file the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="Current password" error={errors.current}>
        <PasswordInput
          value={currentPassword}
          onChange={(event) => {
            setCurrent(event.target.value);
            setErrors((prev) => ({ ...prev, current: undefined }));
          }}
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" hint="At least 8 characters." error={errors.next}>
        <PasswordInput
          value={newPassword}
          onChange={(event) => {
            setNext(event.target.value);
            setErrors((prev) => ({ ...prev, next: undefined }));
          }}
          autoComplete="new-password"
          maxLength={128}
          required
        />
      </Field>
      {errors.form ? <Alert kind="error">{errors.form}</Alert> : null}
    </SettingsCard>
  );
}
