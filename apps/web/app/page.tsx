'use client';

/**
 * Login / registration. Post-login routing per `05_UX_DASHBOARD_SPEC` §3:
 * users with an active organization land in it; users with none see the
 * empty state on the dashboard offering to create one.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, signIn, signUp } from '../lib/api';

const card: React.CSSProperties = {
  maxWidth: 380,
  margin: '10vh auto',
  padding: '32px 36px',
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
};
const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  margin: '6px 0 16px',
  padding: '9px 12px',
  border: '1px solid #c4c9c2',
  borderRadius: 5,
  fontSize: 14,
};
const button: React.CSSProperties = {
  width: '100%',
  padding: '10px 0',
  background: '#0d6e63',
  color: '#fff',
  border: 'none',
  borderRadius: 5,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') await signUp({ email, password, name });
      else await signIn({ email, password });
      router.push('/dashboard');
    } catch (e) {
      setError(
        e instanceof ApiClientError && e.status < 500
          ? 'Check your email and password and try again.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={card}>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>
        {mode === 'login' ? 'Sign in' : 'Create your account'}
      </h1>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <label>
            Name
            <input
              style={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </label>
        )}
        <label>
          Email
          <input
            style={input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            style={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: '#a63a24', fontSize: 13 }}>
            {error}
          </p>
        )}
        <button style={button} disabled={busy} type="submit">
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        style={{
          ...button,
          background: 'transparent',
          color: '#0d6e63',
          marginTop: 10,
        }}
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        type="button"
      >
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </main>
  );
}
