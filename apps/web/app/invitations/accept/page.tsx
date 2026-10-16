'use client';

/**
 * Invitation acceptance (spec 7.12, audit A8). The link's one-time token is read first as a
 * preview (which workspace, who invited, at what level), then the page offers the one step that
 * fits: join (signed in with the invited email), switch account (signed in as someone else),
 * sign in to join (the account exists) or choose a name and password (first open, new account).
 * Older backends without the preview keep the old flow: accept on open, or sign in first.
 */

import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LogIn, LogOut, RotateCw } from 'lucide-react';
import {
  ApiClientError,
  NotAvailableError,
  acceptInvitation,
  acceptInvitationAsNewUser,
  getSession,
  previewInvitation,
  signOut,
  type InvitationPreview,
} from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { AuthSkeleton } from '@/components/auth/skeleton';
import { AuthShell } from '@/components/layout/AuthShell';
import { accessNameFromServer } from '@/components/settings/access';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';

// A full load into the workspace, so nothing cached from before the join carries over.
const enterWorkspace = () => window.location.assign('/dashboard');

/** Title and lead of every state, in the auth pages' geometry. */
function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <>
      <h1 className="m-0 text-page text-text">{title}</h1>
      {children ? <p className="mb-0 mt-2 text-body text-text-2">{children}</p> : null}
    </>
  );
}

function SignInButton({ token, label = 'Sign in to join' }: { token: string; label?: string }) {
  return (
    <Button asChild size="lg" className="mt-6 w-full">
      <Link href={`/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`}>
        <LogIn aria-hidden strokeWidth={1.5} />
        {label}
      </Link>
    </Button>
  );
}

function ToSignIn() {
  return (
    <Button asChild variant="secondary" size="lg" className="mt-6 w-full">
      <Link href="/login">Go to sign in</Link>
    </Button>
  );
}

function AcceptInner() {
  const params = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => previewInvitation(token),
    enabled: Boolean(token),
    retry: false,
  });
  // Who is signed in, if anyone (null when signed out).
  const session = useQuery({ queryKey: ['invitation', 'session'], queryFn: getSession, retry: false });

  if (!token) {
    return (
      <>
        <Heading title="This invite link is incomplete">
          Open the link from your invite email again. If it still doesn’t work, ask the person who invited you for a
          new one.
        </Heading>
        <ToSignIn />
      </>
    );
  }
  if (preview.error instanceof NotAvailableError) return <LegacyAccept token={token} />;
  if (preview.isError) {
    if (preview.error instanceof ApiClientError && preview.error.status === 404) {
      return (
        <>
          <Heading title="This invite link doesn’t work">
            It may have been replaced by a newer link. Ask the person who invited you to send a new one.
          </Heading>
          <ToSignIn />
        </>
      );
    }
    const m = toUserMessage(preview.error, 'open this invite');
    return (
      <>
        <Heading title={m.title}>{m.detail}</Heading>
        <Button size="lg" className="mt-6 w-full" loading={preview.isFetching} onClick={() => void preview.refetch()}>
          <RotateCw aria-hidden strokeWidth={1.5} />
          Try again
        </Button>
      </>
    );
  }
  if (!preview.data || session.isPending) return <AuthSkeleton />;

  const invite = preview.data;
  const inviter = invite.inviterName?.trim() || 'Someone';
  const workspace = invite.organizationName?.trim() || 'their workspace';

  if (invite.status !== 'pending') return <Closed invite={invite} token={token} />;

  const signedIn = session.data ?? null;
  const lead = `${inviter} invited ${invite.email} to ${workspace} as ${accessNameFromServer(invite.roleName)}.`;

  if (signedIn && signedIn.user.email.toLowerCase() === invite.email.toLowerCase()) {
    return <JoinAsSelf token={token} workspace={workspace} lead={lead} onGone={() => void preview.refetch()} />;
  }
  if (signedIn) {
    return (
      <>
        <Heading title="This invite is for someone else">
          {lead} You’re signed in as {signedIn.user.email}. Sign out, then continue with the invited email.
        </Heading>
        <SwitchAccount />
      </>
    );
  }
  if (invite.accountExists) {
    return (
      <>
        <Heading title={`Join ${workspace}`}>
          {lead} Sign in with {invite.email} to join.
        </Heading>
        <SignInButton token={token} />
      </>
    );
  }
  return <NewAccount token={token} invite={invite} workspace={workspace} lead={lead} onGone={() => void preview.refetch()} />;
}

/** Expired, revoked or already used: say which, and who can help. */
function Closed({ invite, token }: { invite: InvitationPreview; token: string }) {
  const inviter = invite.inviterName?.trim() || 'the person who invited you';
  const workspace = invite.organizationName?.trim() || 'the workspace';
  if (invite.status === 'accepted') {
    return (
      <>
        <Heading title="This invite was already used">
          If you joined {workspace}, sign in to open it.
        </Heading>
        <SignInButton token={token} label="Sign in" />
      </>
    );
  }
  return (
    <>
      <Heading title={invite.status === 'revoked' ? 'This invite was withdrawn' : 'This invite has expired'}>
        {invite.status === 'revoked'
          ? `Ask ${inviter} if you still need to join ${workspace}.`
          : `Invite links work for 72 hours. Ask ${inviter} to send you a new one from Settings.`}
      </Heading>
      <ToSignIn />
    </>
  );
}

function SwitchAccount() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error ? (
        <Alert kind="error" className="mt-6">
          {error}
        </Alert>
      ) : null}
      <Button
        size="lg"
        className="mt-6 w-full"
        loading={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          signOut()
            // Reload: the page reads the link again, now signed out.
            .then(() => window.location.reload())
            .catch((e: unknown) => {
              setBusy(false);
              const m = toUserMessage(e, 'sign you out');
              setError(messageText(m));
            });
        }}
      >
        <LogOut aria-hidden strokeWidth={1.5} />
        Sign out and continue
      </Button>
    </>
  );
}

function JoinAsSelf({
  token,
  workspace,
  lead,
  onGone,
}: {
  token: string;
  workspace: string;
  lead: string;
  onGone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function join() {
    setBusy(true);
    setError(null);
    acceptInvitation(token)
      .then(enterWorkspace)
      .catch((e: unknown) => {
        setBusy(false);
        // Spent or expired since the page opened: show the invite as it is now.
        if (e instanceof ApiClientError && e.status === 410) return onGone();
        const m = toUserMessage(e, 'join the workspace');
        setError(messageText(m));
      });
  }

  return (
    <>
      <Heading title={`Join ${workspace}`}>{lead}</Heading>
      {error ? (
        <Alert kind="error" className="mt-6">
          {error}
        </Alert>
      ) : null}
      <Button size="lg" className="mt-6 w-full" loading={busy} onClick={join}>
        Join {workspace}
      </Button>
    </>
  );
}

function NewAccount({
  token,
  invite,
  workspace,
  lead,
  onGone,
}: {
  token: string;
  invite: InvitationPreview;
  workspace: string;
  lead: string;
  onGone: () => void;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string; form?: string }>({});
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Enter your name.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    setErrors(next);
    if (next.name || next.password) return;
    setBusy(true);
    try {
      // Creates the account, joins and signs in, in one step.
      await acceptInvitationAsNewUser({ token, name: name.trim(), password });
      enterWorkspace();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiClientError && e.status === 409) return setExists(true);
      if (e instanceof ApiClientError && e.status === 410) return onGone();
      const m = toUserMessage(e, 'create your account');
      const field = (f: string) => m.fieldErrors?.find((x) => x.field === f)?.message;
      if (field('name') || field('password')) setErrors({ name: field('name'), password: field('password') });
      else setErrors({ form: messageText(m) });
    }
  }

  if (exists) {
    return (
      <>
        <Heading title={`Join ${workspace}`}>
          An account already exists for {invite.email}. Sign in with it to join.
        </Heading>
        <SignInButton token={token} />
      </>
    );
  }

  return (
    <>
      <Heading title={`Join ${workspace}`}>{lead} Choose your name and a password to join.</Heading>
      <form onSubmit={(event) => void submit(event)} noValidate className="mt-6 grid gap-4">
        <Field label="Email" hint="Your invite is for this address.">
          <Input value={invite.email} readOnly autoComplete="username" className="bg-subtle text-text-2" />
        </Field>
        <Field label="Your name" error={errors.name}>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            autoComplete="name"
            maxLength={100}
            required
          />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password}>
          <PasswordInput
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            autoComplete="new-password"
            maxLength={128}
            required
          />
        </Field>
        {errors.form ? <Alert kind="error">{errors.form}</Alert> : null}
        <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
          Join {workspace}
        </Button>
      </form>
    </>
  );
}

/** Backends without the preview: accept on open when signed in, else sign in first (the old flow). */
function LegacyAccept({ token }: { token: string }) {
  const started = useRef(false);
  const [state, setState] = useState<'working' | 'signed-out' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Strict Mode runs effects twice; the token is one-shot, so never send it twice.
    if (started.current) return;
    started.current = true;
    acceptInvitation(token)
      .then(enterWorkspace)
      .catch((e: unknown) => {
        if (e instanceof ApiClientError && e.status === 401) {
          started.current = false;
          setState('signed-out');
          return;
        }
        const m = toUserMessage(e, 'accept this invite');
        setState('failed');
        setMessage(messageText(m));
      });
  }, [token]);

  if (state === 'working') {
    return (
      <Heading title="Joining your team">
        <span role="status">Accepting your invite…</span>
      </Heading>
    );
  }
  if (state === 'signed-out') {
    return (
      <>
        <Heading title="Sign in to join">
          Sign in with the email your invite was sent to, or create an account with it, then you’re in.
        </Heading>
        <SignInButton token={token} label="Sign in to accept" />
      </>
    );
  }
  return (
    <>
      <Heading title="This invite couldn’t be accepted">{message}</Heading>
      <ToSignIn />
    </>
  );
}

export default function AcceptInvitationPage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthSkeleton />}>
        <AcceptInner />
      </Suspense>
    </AuthShell>
  );
}
