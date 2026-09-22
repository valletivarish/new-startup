'use client';

/**
 * Completes Better Auth password reset after the email link redirects here
 * with ?token=… (or ?error=INVALID_TOKEN).
 */

import { Suspense, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError, resetPassword } from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Surface } from '@/components/ui/page';
import { AuthShell } from '@/components/layout/AuthShell';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const linkError = params.get('error');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const invalidLink = useMemo(
    () => Boolean(linkError) || !token,
    [linkError, token],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(password, token);
      setDone(true);
      window.setTimeout(() => router.push('/login'), 1200);
    } catch (e) {
      setError(
        e instanceof ApiClientError && e.status < 500
          ? 'This reset link is invalid or expired. Request a new one.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <Surface elevated className="space-y-5 p-7">
          <div>
            <h1 className="m-0 font-display text-[1.375rem] font-semibold tracking-tight">
              Choose a new password
            </h1>
            <p className="mt-1.5 mb-0 text-sm text-[var(--foreground-tertiary)]">
              {invalidLink
                ? 'This reset link is missing or no longer valid.'
                : done
                  ? 'Password updated. Taking you to sign in…'
                  : 'Enter a new password for your account.'}
            </p>
          </div>

          {invalidLink ? (
            <Button asChild>
              <Link href="/login?mode=forgot">Request a new link</Link>
            </Button>
          ) : done ? null : (
            <form onSubmit={(e) => void submit(e)} className="grid gap-3.5">
              <Field label="New password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </Field>

              {error ? (
                <p
                  role="alert"
                  className="m-0 rounded-md bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2.5 text-[13px] text-[var(--danger)]"
                >
                  {error}
                </p>
              ) : null}

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Saving…' : 'Update password'}
              </Button>
            </form>
          )}
        </Surface>

        <p className="mt-5 mb-0 text-center text-[13px]">
          <Link
            href="/login"
            className="text-[var(--foreground-muted)] no-underline hover:text-[var(--foreground)]"
          >
            Back to sign in
          </Link>
        </p>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="surface-grain grid min-h-dvh place-items-center bg-[var(--background)] text-sm text-[var(--foreground-tertiary)]">
          Loading…
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
