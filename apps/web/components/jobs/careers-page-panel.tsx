'use client';

/**
 * Job page: "Put this job on your careers page". Makes the job's publishable key, edits the
 * websites it works on, copies the one-line snippet, and shows the real form as a preview.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CircleDashed, Copy, FlaskConical, Globe } from 'lucide-react';
import { mountForm } from '@/embed/widget';
import {
  DEFAULT_ACCENT,
  careersSnippet,
  createCareersKey,
  getCareersKey,
  revokeCareersKey,
  updateCareersOrigins,
  websitesFromText,
  type CareersKey,
} from '@/lib/careers-page';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';

export function CareersPagePanel({
  jobId,
  jobTitle,
  permissions,
}: {
  jobId: string;
  jobTitle: string;
  permissions: readonly string[];
}) {
  const can = (p: string) => permissions.includes(p);
  const queryKey = ['careers-page', jobId];
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey, queryFn: () => getCareersKey(jobId) });
  const key = current.data?.key ?? null;
  const companyName = current.data?.companyName || 'Your company';

  const [websites, setWebsites] = useState('');
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  useEffect(() => {
    if (key) setWebsites(key.allowedOrigins.join('\n'));
  }, [key]);

  const saved = (next: CareersKey | null) =>
    queryClient.setQueryData(queryKey, { key: next, companyName: current.data?.companyName ?? '' });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const list = websitesFromText(websites);
      const out = key ? await updateCareersOrigins(jobId, list) : await createCareersKey(jobId, list);
      saved(out.key);
      toast.success(key ? 'Websites saved. The change works straight away.' : 'Your careers page form is ready. Copy the snippet below.');
    } catch (e) {
      const m = toUserMessage(e, key ? 'save the websites' : 'make the form');
      setError(m.fieldErrors?.find((f) => f.field === 'allowedOrigins')?.message ?? messageText(m));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await revokeCareersKey(jobId);
      saved(null);
      setTurningOff(false);
      setWebsites('');
      toast.success('The form is off. Anyone still on your careers page sees that applications are closed.');
    } catch (e) {
      setError(messageText(toUserMessage(e, 'turn off the form')));
    } finally {
      setBusy(false);
    }
  }

  const editable = key ? can('integrations.update') : can('integrations.create');

  return (
    <section id="careers-page" aria-labelledby="careers-page-title" className="scroll-mt-6 rounded-card border border-border bg-canvas p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="careers-page-title" className="m-0 text-section text-text">
          Put this job on your careers page
        </h2>
        {key ? (
          key.mode === 'test' ? (
            <StatusBadge tone="neutral" icon={FlaskConical}>Test job</StatusBadge>
          ) : (
            <StatusBadge tone="success" icon={Globe}>On your site</StatusBadge>
          )
        ) : current.data ? (
          <StatusBadge tone="neutral" icon={CircleDashed}>Off</StatusBadge>
        ) : null}
      </div>
      <p className="mb-0 mt-1 max-w-[65ch] text-text-2">
        Paste one line into your careers page and applicants can ask for a screening call right there. They give
        their own consent, and calls go out between 9 am and 8 pm India time. Answers and results stay here; nothing about them is shown on your site.
      </p>

      <div className="mt-5 grid gap-6">
        {!current.data ? (
          current.isError ? (
            <Alert kind="error" title="Couldn’t load the careers page form">
              {toUserMessage(current.error).detail}
            </Alert>
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : (
          <>
            {key ? <Snippet value={careersSnippet(key.publicKey, window.location.origin, accent)} /> : null}

            {editable ? (
              <div className="grid gap-3">
                <Field
                  label="Your careers page website"
                  hint="One per line, for example acme.in. If your site opens on both acme.in and www.acme.in, add both. The form works only on these."
                  error={error ?? undefined}
                >
                  <Textarea
                    rows={3}
                    value={websites}
                    onChange={(e) => setWebsites(e.target.value)}
                    placeholder="acme.in"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" loading={busy && !turningOff} onClick={() => void save()}>
                    {key ? 'Save websites' : 'Make the form'}
                  </Button>
                  {key && can('integrations.delete') ? (
                    <Button type="button" variant="destructive-secondary" onClick={() => setTurningOff(true)}>
                      Turn off the form
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : key ? (
              <p className="m-0 text-meta text-text-3">Works on {key.allowedOrigins.join(', ')}.</p>
            ) : (
              <p className="m-0 text-text-2">Ask an administrator to set this up.</p>
            )}

            {key ? (
              <p className="m-0 text-meta text-text-3">
                {key.lastUsedAt ? `Last application ${formatWhen(key.lastUsedAt)}.` : 'No applications yet.'}
                {key.mode === 'test' ? ' This is a test job, so calls go to the simulated phone line.' : ''}
              </p>
            ) : null}

            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="m-0 text-label font-medium text-text">What applicants see</h3>
                <label className="inline-flex min-h-11 items-center gap-3 text-meta text-text-2">
                  Button colour
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                    className="size-11 cursor-pointer rounded-input border border-border-input bg-canvas p-1"
                  />
                </label>
              </div>
              <Preview companyName={companyName} jobTitle={jobTitle} accent={accent} />
              <p className="m-0 text-meta text-text-3">A preview: nothing you type here is sent.</p>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={turningOff}
        onOpenChange={setTurningOff}
        title="Turn off the careers page form?"
        body="It stops taking applications at once. To use it again, make a new form and paste the new snippet."
        confirmLabel="Turn off"
        tone="danger"
        busy={busy}
        onConfirm={() => void turnOff()}
      />
    </section>
  );
}

function Snippet({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id="careers-snippet-label" className="text-label font-medium text-text">
          Paste this where the form should appear
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-[6.5rem]"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => toast.error('Couldn’t copy. Select the text and copy it yourself.'),
            )
          }
        >
          {copied ? <Check aria-hidden strokeWidth={1.75} /> : <Copy aria-hidden strokeWidth={1.75} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre
        aria-labelledby="careers-snippet-label"
        tabIndex={0}
        className="m-0 overflow-x-auto whitespace-pre rounded-card-sm border border-border bg-subtle p-3 font-mono text-meta text-text"
      >
        {value}
      </pre>
      <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </div>
  );
}

function Preview({ companyName, jobTitle, accent }: { companyName: string; jobTitle: string; accent: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) void mountForm(ref.current, { preview: { companyName, jobTitle }, accent });
  }, [companyName, jobTitle, accent]);
  return <div ref={ref} className="rounded-card-sm bg-subtle p-4" />;
}
