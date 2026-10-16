'use client';

/**
 * "Ask the candidate" page. A company sends this one-use link; the candidate checks the job,
 * gives their own consent, and chooses a call now or at a time they pick. No sign-in.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError, getCandidateLink, submitCandidateLink } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-canvas px-4 py-8 text-text sm:py-14">
      {children}
    </main>
  );
}

const when = (local: string) => new Date(local).toISOString();

export default function CandidateLinkPage() {
  const token = String(useParams<{ token: string }>().token ?? '');
  const link = useQuery({
    queryKey: ['candidate-link', token],
    queryFn: () => getCandidateLink(token),
    retry: false,
  });
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; at?: string; consent?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ scheduledFor: string | null } | null>(null);

  if (link.isPending) {
    return (
      <Shell>
        <p role="status" className="text-body text-text-2">Loading…</p>
      </Shell>
    );
  }
  if (link.isError) {
    const gone = link.error instanceof ApiClientError && link.error.status === 404;
    const m = toUserMessage(link.error, 'open this link');
    return (
      <Shell>
        <h1 className="m-0 text-page">{gone ? 'This link doesn’t work' : m.title}</h1>
        <p className="mb-0 mt-2 text-body text-text-2">
          {gone
            ? 'It may have been used already or expired. Ask the company that sent it for a new one.'
            : m.detail}
        </p>
      </Shell>
    );
  }

  const { companyName, jobTitle, expiresAt } = link.data;

  if (done) {
    return (
      <Shell>
        <h1 className="m-0 text-page">You’re all set</h1>
        <p role="status" className="mb-0 mt-2 text-body text-text-2">
          {done.scheduledFor
            ? `${companyName} will call you on ${new Date(done.scheduledFor).toLocaleString()} about the ${jobTitle} role. Calls only happen between 9am and 8pm India time.`
            : `${companyName} will call you shortly about the ${jobTitle} role. Please keep your phone nearby.`}
        </p>
      </Shell>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fullName = (name ?? link.data?.fullName ?? '').trim();
    const next: typeof errors = {};
    if (!fullName) next.name = 'Enter your name.';
    if (!phone.trim()) next.phone = 'Enter your phone number.';
    if (mode === 'later' && (!at || new Date(at).getTime() <= Date.now())) next.at = 'Pick a time in the future.';
    if (!consent) next.consent = `Tick the box to agree to a call from ${companyName}.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      setDone(
        await submitCandidateLink(token, {
          fullName,
          phone: phone.trim(),
          countryCode: '+91',
          when: mode === 'now' ? 'now' : when(at),
        }),
      );
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiClientError && e.status === 404) return void link.refetch();
      const m = toUserMessage(e, 'send your details');
      const field = (f: string) => m.fieldErrors?.find((x) => x.field === f)?.message;
      if (field('phone') || field('fullName') || field('when')) {
        setErrors({ name: field('fullName'), phone: field('phone'), at: field('when') });
      } else setErrors({ form: messageText(m) });
    }
  }

  return (
    <Shell>
      <h1 className="m-0 text-page">{jobTitle}</h1>
      <p className="mb-0 mt-2 text-body text-text-2">
        {companyName} would like to screen you for this role with a short phone call from our AI
        assistant. Tell us where to reach you and when.
      </p>
      <form onSubmit={(event) => void submit(event)} noValidate className="mt-6 grid gap-4">
        <Field label="Your name" error={errors.name}>
          <Input
            value={name ?? link.data.fullName ?? ''}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={200}
            required
          />
        </Field>
        <Field label="Phone number" hint="An Indian mobile number, for example 98765 43210." error={errors.phone}>
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel-national"
            maxLength={30}
            required
          />
        </Field>

        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-label font-medium">When should we call?</legend>
          {(
            [
              ['now', 'Call me now'],
              ['later', 'Pick a time'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body">
              <input
                type="radio"
                name="when"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="size-[1.125rem] accent-[color:var(--primary,currentColor)]"
              />
              {label}
            </label>
          ))}
        </fieldset>
        {mode === 'later' ? (
          <Field label="Date and time" hint="Calls are placed between 9am and 8pm India time." error={errors.at}>
            <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} required />
          </Field>
        ) : (
          <p className="m-0 text-meta text-text-3">
            Calls are placed between 9am and 8pm India time. Outside those hours we call at 9am.
          </p>
        )}

        <div>
          <Checkbox
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            label={`I agree to receive a screening call from ${companyName} about this job`}
            aria-invalid={errors.consent ? true : undefined}
          />
          {errors.consent ? (
            <p role="alert" className="m-0 mt-1 text-meta text-status-danger-text">{errors.consent}</p>
          ) : null}
        </div>

        {errors.form ? <Alert kind="error">{errors.form}</Alert> : null}
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {mode === 'now' ? 'Call me now' : 'Schedule my call'}
        </Button>
        <p className="m-0 text-meta text-text-3">
          This link works once and expires on {new Date(expiresAt).toLocaleDateString()}.
        </p>
      </form>
    </Shell>
  );
}
