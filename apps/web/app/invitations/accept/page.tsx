'use client';

/**
 * Invitation acceptance (`05_UX_DASHBOARD_SPEC` §4, Path B).
 * The link from the email lands here; the token never appears in any API
 * response, only in that link.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError, acceptInvitation } from '../../../lib/api';

function AcceptInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'working' | 'unauthenticated' | 'failed'>(
    'working',
  );
  const [message, setMessage] = useState('Accepting your invitation…');

  useEffect(() => {
    if (!token) {
      setState('failed');
      setMessage('This invitation link is incomplete. Use the link from your email.');
      return;
    }
    acceptInvitation(token)
      .then(() => router.push('/dashboard'))
      .catch((e: unknown) => {
        if (e instanceof ApiClientError && e.status === 401) {
          setState('unauthenticated');
          setMessage(
            'Sign in (or create an account with the invited email) first, then open this link again.',
          );
        } else {
          setState('failed');
          setMessage(
            e instanceof ApiClientError
              ? e.message
              : 'This invitation could not be accepted.',
          );
        }
      });
  }, [token, router]);

  return (
    <main
      style={{
        maxWidth: 420,
        margin: '14vh auto',
        padding: '32px 36px',
        background: '#fff',
        border: '1px solid #d6dad2',
        borderRadius: 8,
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 18 }}>Invitation</h1>
      <p style={{ fontSize: 14, color: '#545c56' }}>{message}</p>
      {state === 'unauthenticated' && (
        <a href="/" style={{ color: '#0d6e63', fontSize: 14 }}>
          Go to sign in
        </a>
      )}
    </main>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInner />
    </Suspense>
  );
}
