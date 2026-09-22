'use client';

/**
 * Invitation acceptance (`05_UX_DASHBOARD_SPEC` §4, Path B).
 * The one-time token arrives in the link (email or copyable acceptUrl at invite).
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError, acceptInvitation } from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/page';
import { AuthShell } from '@/components/layout/AuthShell';

function AcceptInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const started = useRef(false);
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
    // Strict Mode remounts effects; the token is one-shot — never fire twice.
    if (started.current) return;
    started.current = true;
    acceptInvitation(token)
      .then(() => router.push('/dashboard'))
      .catch((e: unknown) => {
        if (e instanceof ApiClientError && e.status === 401) {
          started.current = false;
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
    <AuthShell>
      <Surface elevated className="space-y-4 p-7">
        <h1 className="m-0 font-display text-[1.375rem] font-semibold tracking-tight">
          Invitation
        </h1>
        <p className="m-0 text-sm leading-relaxed text-[var(--foreground-tertiary)]">
          {message}
        </p>
        {state === 'unauthenticated' && token && (
          <Button asChild>
            <Link
              href={`/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`}
            >
              Sign in to accept
            </Link>
          </Button>
        )}
        {state === 'failed' && (
          <Button asChild variant="outline">
            <Link href="/login">Back to sign in</Link>
          </Button>
        )}
      </Surface>
    </AuthShell>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInner />
    </Suspense>
  );
}
