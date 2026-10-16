'use client';

/**
 * The end of a password reset: the emailed link lands here with ?token=… (or ?error=INVALID_TOKEN
 * once it has expired) and the person chooses a new password.
 */

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError, resetPassword } from '../../lib/api';
import { toUserMessage, type UserMessage } from '../../lib/errors';
import { Button } from '@/components/ui/button';
import { Field, PasswordInput } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { AuthShell } from '@/components/layout/AuthShell';
import { AuthSkeleton } from '@/components/auth/skeleton';

const NEW_LINK = '/login?mode=forgot';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const invalidLink = Boolean(params.get('error')) || !token;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  // `expired`: the link died while the page was open, so the alert offers a new one.
  const [failure, setFailure] = useState<(UserMessage & { expired: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    // Length is checked by the field (minLength) and again by the server.
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setBusy(true);
    try {
      await resetPassword(password, token);
      setDone(true);
      window.setTimeout(() => router.push('/login'), 1200);
    } catch (e) {
      setFailure({ ...toUserMessage(e), expired: e instanceof ApiClientError && e.code === 'INVALID_TOKEN' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="m-0 text-page text-text">Choose a new password</h1>
      <p className="mb-0 mt-2 text-body text-text-2">
        {invalidLink
          ? 'This link has expired or is incomplete. Reset links work once, so ask for a new one.'
          : 'Enter a new password for your account.'}
      </p>

      {invalidLink ? (
        <Button asChild size="lg" className="mt-6 w-full">
          <Link href={NEW_LINK}>Request a new link</Link>
        </Button>
      ) : done ? (
        <Alert kind="success" title="Password updated" className="mt-6">
          Taking you to sign in…
        </Alert>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-6 grid gap-4">
          <Field label="New password" hint="At least 8 characters">
            <PasswordInput
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setMismatch(false);
              }}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Confirm password"
            error={mismatch ? 'These don’t match. Type the same password in both fields.' : undefined}
          >
            <PasswordInput
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setMismatch(false);
              }}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>

          {failure ? (
            <Alert
              kind="error"
              title={failure.title}
              action={
                failure.expired ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={NEW_LINK}>Request a new link</Link>
                  </Button>
                ) : undefined
              }
            >
              {failure.detail}
            </Alert>
          ) : null}

          <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
            Update password
          </Button>
        </form>
      )}

      <p className="mb-0 mt-6 flex justify-center border-t border-border pt-4">
        <Button asChild variant="link" size="sm" className="px-1">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </p>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <AuthSkeleton />
        </AuthShell>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
