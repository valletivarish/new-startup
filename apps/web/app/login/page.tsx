'use client';

/**
 * Sign in, create account and forgot password: one form that changes mode. Company name on
 * register creates the workspace at once, so newcomers never meet workspace-switching words.
 */

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  SESSION_ENDED_MESSAGE,
  ensureOrganization,
  me,
  requestPasswordReset,
  signIn,
  signUp,
  takeSessionEndedNotice,
} from '../../lib/api';
import { safeReturnPath } from '../../lib/auth-redirect';
import { toUserMessage, type UserMessage } from '../../lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { AuthShell } from '@/components/layout/AuthShell';
import { AuthSkeleton } from '@/components/auth/skeleton';

type Mode = 'login' | 'register' | 'forgot';

const INVITE_LEAD = 'Use the email your invite was sent to. You’ll join your team’s workspace straight after.';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get('mode');
  // Only a path on this site, and never sign-in itself (lib/auth-redirect).
  const nextPath = safeReturnPath(params.get('next')) ?? '/jobs';
  const joiningViaInvite = nextPath.startsWith('/invitations/accept');

  const [mode, setMode] = useState<Mode>(asked === 'register' || asked === 'forgot' ? asked : 'login');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<UserMessage | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const switched = useRef(false);

  // Once, after the app sent an expired session here. The guard keeps a Strict Mode rerun from clearing it.
  useEffect(() => {
    if (takeSessionEndedNotice()) setSessionEnded(true);
  }, []);

  // A new mode reads as a new page: focus its title, so a screen reader announces it (not on first load).
  useEffect(() => {
    if (switched.current) heading.current?.focus();
  }, [mode]);

  function switchTo(next: Mode) {
    switched.current = true;
    setMode(next);
    setError(null);
    setSentTo(null);
  }

  // Title, the line under it, the button, and the way to the other mode: [prompt, link, mode].
  const copy: Record<Mode, { title: string; lead: string; action: string; other: [string, string, Mode] }> = {
    login: {
      title: 'Sign in',
      lead: joiningViaInvite ? INVITE_LEAD : 'Welcome back.',
      action: 'Sign in',
      other: ['New here?', 'Create an account', 'register'],
    },
    register: {
      title: joiningViaInvite ? 'Join your company' : 'Create your account',
      lead: joiningViaInvite
        ? INVITE_LEAD
        : 'Add a job and try a test call in your browser right away. Before HRVoice calls real candidates, we set up your calling number with you and agree the price per call.',
      action: 'Create account',
      other: ['Already have an account?', 'Sign in', 'login'],
    },
    forgot: {
      title: 'Reset your password',
      lead: 'Enter the email you sign in with and we’ll send you a link to choose a new one.',
      action: 'Send reset link',
      other: ['Remembered it?', 'Back to sign in', 'login'],
    },
  };
  const { title, lead, action, other: [prompt, otherLabel, otherMode] } = copy[mode];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSentTo(null);
    setSessionEnded(false);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email.trim(), `${window.location.origin}/reset-password`);
        setSentTo(email.trim());
        setBusy(false);
        return;
      }
      if (mode === 'register') {
        await signUp({ email, password, name });
        if (!joiningViaInvite) {
          await ensureOrganization(company.trim() || `${name.trim()}'s company`);
        }
      } else {
        await signIn({ email, password });
        if (!joiningViaInvite) {
          const profile = await me();
          if (!profile.activeOrganization) {
            const fallback = `${profile.user.name || 'My'}'s company`.slice(0, 100);
            await ensureOrganization(fallback.length >= 2 ? fallback : 'My company');
          }
        }
      }
      // Busy until the next page replaces this one, so a second press can't send it again.
      router.push(nextPath);
    } catch (e) {
      setError(toUserMessage(e));
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1
        ref={heading}
        tabIndex={-1}
        className="m-0 text-page text-text focus-visible:shadow-none focus-visible:outline-none"
      >
        {title}
      </h1>
      <p className="mb-0 mt-2 text-body text-text-2">{lead}</p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 grid gap-4">
        {sessionEnded && mode === 'login' ? <Alert kind="info">{SESSION_ENDED_MESSAGE}</Alert> : null}

        {mode === 'register' && (
          <>
            <Field label="Your name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </Field>
            {!joiningViaInvite && (
              <Field label="Company name" hint="Shown on your workspace">
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                  minLength={2}
                  autoComplete="organization"
                />
              </Field>
            )}
          </>
        )}
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>
        {mode !== 'forgot' && (
          <div className="grid gap-1">
            <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </Field>
            {mode === 'login' && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => switchTo('forgot')}
                className="justify-self-end px-0"
              >
                Forgot password?
              </Button>
            )}
          </div>
        )}

        {error ? (
          <Alert kind="error" title={error.title}>
            {error.detail}
          </Alert>
        ) : null}
        {sentTo ? (
          <Alert kind="info" title="Check your email">
            If an account uses {sentTo}, a reset link is on its way. Nothing after a few minutes? Check
            spam, then send it again.
          </Alert>
        ) : null}

        <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
          {action}
        </Button>
      </form>

      <p className="mb-0 mt-6 flex flex-wrap items-center justify-center gap-x-1 border-t border-border pt-4 text-body text-text-2">
        {prompt}
        <Button type="button" variant="link" size="sm" className="px-1" onClick={() => switchTo(otherMode)}>
          {otherLabel}
        </Button>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <AuthSkeleton />
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
