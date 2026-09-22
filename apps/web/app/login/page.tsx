'use client';

/**
 * Sign in / create account / forgot password. Company name on register creates
 * the org immediately so newcomers never see organization-switcher jargon.
 */

import { Suspense, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiClientError,
  ensureOrganization,
  me,
  requestPasswordReset,
  signIn,
  signUp,
} from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Surface } from '@/components/ui/page';
import { AuthShell } from '@/components/layout/AuthShell';

type Mode = 'login' | 'register' | 'forgot';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialMode = ((): Mode => {
    const m = params.get('mode');
    if (m === 'register') return 'register';
    if (m === 'forgot') return 'forgot';
    return 'login';
  })();
  const nextPath = (() => {
    const raw = params.get('next');
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/jobs';
    return raw;
  })();
  const joiningViaInvite = nextPath.startsWith('/invitations/accept');

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [consoleResetUrl, setConsoleResetUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = useMemo(() => {
    if (mode === 'register') {
      return joiningViaInvite ? 'Join your company' : 'Create your account';
    }
    if (mode === 'forgot') return 'Reset your password';
    return 'Sign in';
  }, [mode, joiningViaInvite]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const redirectTo = `${window.location.origin}/reset-password`;
        const result = await requestPasswordReset(email.trim(), redirectTo);
        if (result.consoleResetUrl) {
          setConsoleResetUrl(result.consoleResetUrl);
          setInfo(
            'Email delivery is not connected yet — use the one-time reset link below (expires soon).',
          );
        } else {
          setConsoleResetUrl(null);
          setInfo(
            'If an account exists for that email, a reset link was created. When email delivery is connected you will get it in your inbox; until then check with your admin or use an invite link from them.',
          );
        }
        return;
      }
      if (mode === 'register') {
        await signUp({ email, password, name });
        if (!joiningViaInvite) {
          const companyName = company.trim() || `${name.trim()}'s company`;
          await ensureOrganization(companyName);
        }
      } else {
        await signIn({ email, password });
        if (!joiningViaInvite) {
          const profile = await me();
          if (!profile.activeOrganization) {
            const fallback =
              `${profile.user.name || 'My'}'s company`.slice(0, 100);
            await ensureOrganization(
              fallback.length >= 2 ? fallback : 'My company',
            );
          }
        }
      }
      router.push(nextPath);
    } catch (e) {
      setError(
        e instanceof ApiClientError && e.status < 500
          ? humanAuthError(e.message)
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
              {title}
            </h1>
            <p className="mt-1.5 mb-0 text-sm text-[var(--foreground-tertiary)]">
              {mode === 'register'
                ? joiningViaInvite
                  ? 'Use the invited email. After you join, the role from the invite is attached to you for that company.'
                  : 'Tell us your name and company. We set up your workspace.'
                : mode === 'forgot'
                  ? 'Enter your email and we will send a reset link.'
                  : joiningViaInvite
                    ? 'Sign in with the invited email to attach your access and open that company.'
                    : 'Welcome back to your hiring desk.'}
            </p>
          </div>

          <form onSubmit={(e) => void submit(e)} className="grid gap-3.5">
            {mode === 'register' && (
              <>
                <Field label="Your name">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </Field>
                {!joiningViaInvite && (
                  <Field label="Company name" hint="Shown on your workspace">
                    <Input
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      required
                      minLength={2}
                      autoComplete="organization"
                      placeholder="Your company name"
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
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                />
              </Field>
            )}

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setInfo(null);
                }}
                className="-mt-1 justify-self-start rounded-sm border-0 bg-transparent p-0 text-[13px] font-semibold text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                Forgot password?
              </button>
            )}

            {error && (
              <p
                role="alert"
                className="m-0 rounded-md bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2.5 text-[13px] text-[var(--danger)]"
              >
                {error}
              </p>
            )}

            {info && (
              <p
                role="status"
                className="m-0 rounded-md bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-3 py-2.5 text-[13px] text-[var(--success)]"
              >
                {info}
              </p>
            )}

            {consoleResetUrl && (
              <div className="rounded-md border border-[var(--separator)] bg-[var(--surface-secondary)] px-3 py-2.5 text-[13px]">
                <p className="mb-2 mt-0 text-[var(--foreground-tertiary)]">
                  One-time reset link (copy and open):
                </p>
                <code className="block break-all text-xs text-[var(--foreground)]">
                  {consoleResetUrl}
                </code>
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 h-auto p-0"
                  onClick={() =>
                    void navigator.clipboard.writeText(consoleResetUrl)
                  }
                >
                  Copy link
                </Button>
              </div>
            )}

            <Button type="submit" disabled={busy} className="mt-1 w-full">
              {busy
                ? 'Working…'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Sign in'}
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
              setInfo(null);
            }}
          >
            {mode === 'login'
              ? 'New here? Create an account'
              : mode === 'forgot'
                ? 'Back to sign in'
                : 'Already have an account? Sign in'}
          </Button>
        </Surface>
    </AuthShell>
  );
}

function humanAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('organization') || lower.includes('switch-organization')) {
    return 'Create or open your company first.';
  }
  if (lower.includes('already') || lower.includes('exists')) {
    return 'An account with that email already exists. Try signing in.';
  }
  if (
    lower.includes('password') ||
    lower.includes('credential') ||
    lower.includes('invalid')
  ) {
    return 'Check your email and password and try again.';
  }
  return message.length > 120 ? 'Check your details and try again.' : message;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="surface-grain grid min-h-dvh place-items-center bg-[var(--background)] text-sm text-[var(--foreground-tertiary)]">
          Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
