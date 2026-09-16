'use client';

/**
 * Sign in / create account. Company name on register creates the org
 * immediately so newcomers never see organization-switcher jargon.
 */

import { FormEvent, Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiClientError,
  createOrganization,
  me,
  signIn,
  signUp,
} from '../../lib/api';
import { brand } from '../../lib/brand';

const { colors, radii } = brand;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialMode = params.get('mode') === 'register' ? 'register' : 'login';

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = useMemo(
    () => (mode === 'login' ? 'Sign in' : 'Create your account'),
    [mode],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await signUp({ email, password, name });
        const companyName = company.trim() || `${name.trim()}'s company`;
        await createOrganization(companyName);
      } else {
        await signIn({ email, password });
        const profile = await me();
        if (!profile.activeOrganization) {
          router.push('/dashboard');
          return;
        }
      }
      router.push('/dashboard');
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
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: `radial-gradient(900px 420px at 20% 0%, ${colors.primarySoft}, transparent), ${colors.paperWash}`,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <Link
            href="/"
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              textDecoration: 'none',
            }}
          >
            {brand.name}
          </Link>
        </div>

        <section
          style={{
            background: colors.paper,
            border: `1px solid ${colors.line}`,
            borderRadius: radii.panel,
            padding: '28px 28px 24px',
            boxShadow: '0 18px 40px rgba(15, 23, 42, 0.06)',
          }}
        >
          <h1
            style={{
              margin: '0 0 6px',
              fontSize: 22,
              letterSpacing: '-0.02em',
              fontWeight: 700,
            }}
          >
            {title}
          </h1>
          <p style={{ margin: '0 0 22px', color: colors.inkMuted, fontSize: 14 }}>
            {mode === 'register'
              ? 'Tell us your name and company. We set up your workspace.'
              : 'Welcome back to your hiring desk.'}
          </p>

          <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 14 }}>
            {mode === 'register' && (
              <>
                <Field label="Your name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Company name" hint="Shown on your workspace">
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    required
                    minLength={2}
                    autoComplete="organization"
                    placeholder="Your company name"
                    style={inputStyle}
                  />
                </Field>
              </>
            )}
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={inputStyle}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                style={inputStyle}
              />
            </Field>

            {error && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: colors.danger,
                  background: '#fef2f2',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                minHeight: 48,
                border: 'none',
                borderRadius: radii.control,
                background: colors.primary,
                color: '#fff',
                fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.75 : 1,
              }}
            >
              {busy
                ? 'Working…'
                : mode === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            style={{
              marginTop: 14,
              width: '100%',
              minHeight: 44,
              border: 'none',
              background: 'transparent',
              color: colors.primary,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {mode === 'login'
              ? 'New here? Create an account'
              : 'Already have an account? Sign in'}
          </button>
        </section>

        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          <Link href="/" style={{ color: colors.inkMuted, textDecoration: 'none' }}>
            Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 }}>
      <span>{label}</span>
      {children}
      {hint && (
        <span style={{ fontWeight: 400, color: colors.inkMuted, fontSize: 12 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  border: `1px solid ${colors.line}`,
  borderRadius: radii.control,
  background: colors.paper,
  fontWeight: 400,
};

function humanAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('organization') || lower.includes('switch-organization')) {
    return 'Create or open your company first.';
  }
  if (lower.includes('already') || lower.includes('exists')) {
    return 'An account with that email already exists. Try signing in.';
  }
  if (lower.includes('password') || lower.includes('credential') || lower.includes('invalid')) {
    return 'Check your email and password and try again.';
  }
  return message.length > 120 ? 'Check your details and try again.' : message;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
          Loading…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
