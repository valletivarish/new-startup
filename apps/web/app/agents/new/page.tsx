'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { AppShell } from '../../../components/AppShell';
import { Button } from '../../../components/ui/button';
import { Input, Textarea, Field } from '../../../components/ui/input';
import { PageHeader, PageMain, Surface, Notice } from '../../../components/ui/page';
import { SkeletonList } from '../../../components/ui/skeleton';
import {
  ApiClientError,
  createAgent,
  formatApiError,
  listPacks,
  me,
  publishVersion,
  type Me,
  type PackDefinition,
} from '../../../lib/api';
import { VoiceTestPanel } from '../../../src/integrations/elevenlabs/VoiceTestPanel';
import { loginPathForReturn } from '../../../lib/auth-redirect';
import { toPublicId } from '../../../lib/public-id';
import { cn } from '@/lib/utils';

type Step = 'configure' | 'review' | 'done';

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function NewAgentPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [step, setStep] = useState<Step>('configure');
  const [selectedPack, setSelectedPack] = useState<PackDefinition | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [transferPhones, setTransferPhones] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdVersionId, setCreatedVersionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'err'>('ok');
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, pk] = await Promise.all([me(), listPacks()]);
      setProfile(p);
      const hiring =
        pk.packs.find((pack) => pack.id === 'hiring') ?? pk.packs[0] ?? null;
      if (!hiring) {
        setNoticeKind('err');
        setNotice('Hiring setup is not available right now. Try again later.');
        return;
      }
      setSelectedPack(hiring);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
      } else {
        setNoticeKind('err');
        setNotice(
          e instanceof ApiClientError ? e.message : 'Could not load wizard.',
        );
      }
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canCreate =
    profile?.activeOrganization?.permissions.includes('agents.create') ?? false;
  const canDeploy =
    profile?.activeOrganization?.permissions.includes('agents.deploy') ?? false;
  const canTest =
    profile?.activeOrganization?.permissions.includes('agents.test') ||
    profile?.activeOrganization?.permissions.includes('calls.initiate') ||
    false;

  async function onPublish() {
    if (!createdId || !createdVersionId) return;
    setPublishing(true);
    setNotice(null);
    try {
      await publishVersion(createdId, createdVersionId);
      setPublished(true);
      setNoticeKind('ok');
      setNotice(
        'Hiring voice published. Add job docs and questions on each job, then start screening.',
      );
    } catch (e) {
      setNoticeKind('err');
      setNotice(formatApiError(e, 'Could not publish the hiring voice.'));
    } finally {
      setPublishing(false);
    }
  }

  function goReview(event: FormEvent) {
    event.preventDefault();
    if (!purpose.trim()) {
      setNoticeKind('err');
      setNotice('Please describe what this hiring voice should do.');
      return;
    }
    setNotice(null);
    setNoticeKind('ok');
    setStep('review');
  }

  async function onSubmit() {
    if (!selectedPack || !name.trim()) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await createAgent({
        name: name.trim(),
        purpose: purpose.trim(),
        agentType: selectedPack.id,
        transferPhones: parseLines(transferPhones),
      });

      setCreatedId(result.id);
      setCreatedVersionId(result.versionId);
      setStep('done');
    } catch (e) {
      setNoticeKind('err');
      setNotice(formatApiError(e, 'Could not create the hiring voice.'));
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = ['Configure', 'Review', 'Done'] as const;
  const stepIndex = ['configure', 'review', 'done'].indexOf(step);

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain>
          <SkeletonList rows={3} />
        </PageMain>
      </AppShell>
    );
  }

  if (!canCreate) {
    return (
      <AppShell profile={profile}>
        <PageMain>
          <Surface>
            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
              You do not have permission to create a hiring voice for this company.
            </p>
            <Link
              href="/agents"
              className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline"
            >
              All hiring voices
            </Link>
          </Surface>
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Set up a hiring voice"
          description="Build the voice that calls candidates. Add each role’s job description and questions on the job itself."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/agents">All hiring voices</Link>
            </Button>
          }
        />

        <nav aria-label="Wizard progress" className="flex flex-wrap items-center gap-1 sm:gap-2">
          {stepLabels.map((label, i) => {
            const active = i === stepIndex;
            const done = i < stepIndex;
            return (
              <div key={label} className="flex items-center gap-1 sm:gap-2">
                {i > 0 ? (
                  <span
                    className={cn(
                      'hidden h-px w-4 sm:block sm:w-6',
                      done || active
                        ? 'bg-[color-mix(in_srgb,var(--accent)_45%,var(--separator))]'
                        : 'bg-[var(--separator)]',
                    )}
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors duration-fast',
                    active
                      ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                      : done
                        ? 'text-[var(--foreground-secondary)]'
                        : 'text-[var(--foreground-muted)]',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
                      active || done
                        ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                        : 'bg-[var(--background-secondary)] text-[var(--foreground-muted)]',
                    )}
                    aria-hidden
                  >
                    {done ? (
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {label}
                </span>
              </div>
            );
          })}
        </nav>

        {notice ? <Notice kind={noticeKind}>{notice}</Notice> : null}

        {step === 'configure' && selectedPack ? (
          <form onSubmit={goReview} className="space-y-4">
            <Surface className="space-y-4">
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">Configure hiring voice</h2>
              <Field label="Voice name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Company hiring voice"
                  required
                  minLength={2}
                />
              </Field>
              <Field label="What should this hiring voice do?">
                <Textarea
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Conduct screening calls, ask the job’s questions, and capture clear answers."
                  required
                  rows={4}
                />
              </Field>
              <Field
                label="Transfer to a human (phone numbers)"
                hint="One number per line with country code, e.g. +919876543210"
              >
                <Textarea
                  value={transferPhones}
                  onChange={(e) => setTransferPhones(e.target.value)}
                  placeholder="+919876543210"
                  rows={2}
                />
              </Field>
            </Surface>
            <Button type="submit">Review</Button>
          </form>
        ) : null}

        {step === 'review' && selectedPack ? (
          <Surface className="space-y-4">
            <h2 className="m-0 font-display text-base font-semibold tracking-tight">Review and create</h2>
            <dl className="m-0 space-y-3 text-sm">
              <div>
                <dt className="text-[var(--foreground-tertiary)]">Name</dt>
                <dd className="m-0 mt-0.5 font-medium">{name}</dd>
              </div>
              <div>
                <dt className="text-[var(--foreground-tertiary)]">Purpose</dt>
                <dd className="m-0 mt-0.5">{purpose}</dd>
              </div>
              {parseLines(transferPhones).length > 0 ? (
                <div>
                  <dt className="text-[var(--foreground-tertiary)]">
                    Transfer phones
                  </dt>
                  <dd className="m-0 mt-0.5">
                    {parseLines(transferPhones).join(', ')}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('configure')}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void onSubmit()}
              >
                {submitting ? 'Creating…' : 'Save hiring voice'}
              </Button>
            </div>
          </Surface>
        ) : null}

        {step === 'done' && createdId ? (
          <Surface className="space-y-4">
            <h2 className="m-0 font-display text-xl font-semibold tracking-tight">
              {published ? 'Hiring voice ready to screen' : 'Hiring voice created'}
            </h2>
            <p className="m-0 max-w-lg text-sm leading-relaxed text-[var(--foreground-tertiary)]">
              {published
                ? 'Create a job, add the job description and questions there, then screen candidates.'
                : canDeploy
                  ? 'Publish this hiring voice before placing screens — drafts cannot call candidates.'
                  : 'Ask your admin to publish this hiring voice before screening.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {canDeploy && !published ? (
                <Button
                  type="button"
                  disabled={publishing}
                  onClick={() => void onPublish()}
                >
                  {publishing ? 'Publishing…' : 'Publish hiring voice'}
                </Button>
              ) : null}
              {published ? (
                <Button asChild>
                  <Link href="/jobs">Create a job</Link>
                </Button>
              ) : null}
              <Button asChild variant={published ? 'outline' : 'default'}>
                <Link href={`/agents/${toPublicId(createdId)}`}>
                  Open voice settings
                </Link>
              </Button>
              {!published ? (
                <Button asChild variant="outline">
                  <Link href="/jobs">Create a job</Link>
                </Button>
              ) : null}
            </div>
            {published && canTest && createdId ? (
              <div className="mt-2 border-t border-[var(--separator-subtle)] pt-4">
                <VoiceTestPanel
                  agentId={createdId}
                  canTest={canTest}
                  agentPublished={published}
                  title="Browser demo (not a live candidate call)"
                />
              </div>
            ) : null}
          </Surface>
        ) : null}
      </PageMain>
    </AppShell>
  );
}
