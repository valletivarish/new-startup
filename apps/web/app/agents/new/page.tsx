'use client';

/**
 * Set up an agent (D2): describe it, check and save it as a draft, then publish it. Each job's
 * description and must-ask questions are added on the job, not here.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, Lock, Plus, Radio } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PhoneListField } from '@/components/PhoneListField';
import { HiringVoiceFace } from '@/components/fx/HiringVoiceFace';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup, useHeldLoading } from '@/components/ui/skeleton';
import {
  createAgent,
  listPacks,
  me,
  publishVersion,
  type Me,
  type PackDefinition,
} from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { toPublicId } from '@/lib/public-id';
import { useUseCase } from '@/lib/use-cases';
import { VoiceTestPanel } from '@/src/integrations/elevenlabs/VoiceTestPanel';

type Step = 'configure' | 'review' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'configure', label: 'Describe it' },
  { key: 'review', label: 'Check and save' },
  { key: 'done', label: 'Publish' },
];

const CARD = 'max-w-2xl rounded-card border border-border bg-canvas p-5 sm:p-6';
const CRUMBS = [{ label: 'Agents', href: '/agents' }, { label: 'Set up an agent' }];


export default function NewAgentPage() {
  const { labels } = useUseCase();
  const job = labels.workItem.one.toLowerCase();
  const contact = labels.contact.one.toLowerCase();
  const [profile, setProfile] = useState<Me | null>(null);
  const [step, setStep] = useState<Step>('configure');
  const [selectedPack, setSelectedPack] = useState<PackDefinition | null>(null);
  const [noPack, setNoPack] = useState(false);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [purposeError, setPurposeError] = useState<string | null>(null);
  const [transferPhones, setTransferPhones] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdVersionId, setCreatedVersionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  // A save or publish that failed, said in the step's own card.
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const focusStep = useRef(false);

  const reload = useCallback(async () => {
    try {
      const [p, pk] = await Promise.all([me(), listPacks()]);
      setProfile(p);
      const hiring =
        pk.packs.find((pack) => pack.id === 'hiring') ?? pk.packs[0] ?? null;
      setNoPack(!hiring);
      setSelectedPack(hiring);
      setLoadError(null);
    } catch (e) {
      // A 401 is already on its way to sign-in (lib/api).
      setLoadError(e);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Each step swaps the card, so focus follows to the new step's heading.
  useEffect(() => {
    if (!focusStep.current) return;
    focusStep.current = false;
    stepHeading.current?.focus();
  }, [step]);

  function go(next: Step) {
    focusStep.current = true;
    setError(null);
    setStep(next);
  }

  const retry = async () => {
    setRetrying(true);
    await reload();
    setRetrying(false);
  };

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canCreate = can('agents.create');
  const canDeploy = can('agents.deploy');
  const canTest = can('agents.test') || can('calls.initiate');

  async function onPublish() {
    if (!createdId || !createdVersionId) return;
    setPublishing(true);
    setError(null);
    try {
      await publishVersion(createdId, createdVersionId);
      setPublished(true);
    } catch (e) {
      setError(toUserMessage(e, 'publish the agent'));
    } finally {
      setPublishing(false);
    }
  }

  function goReview(event: FormEvent) {
    event.preventDefault();
    if (!purpose.trim()) {
      setPurposeError('Say what it should do on a call.');
      return;
    }
    setPurposeError(null);
    go('review');
  }

  async function onSubmit() {
    if (!selectedPack || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createAgent({
        name: name.trim(),
        purpose: purpose.trim(),
        agentType: selectedPack.id,
        transferPhones: transferPhones.filter(Boolean),
      });

      setCreatedId(result.id);
      setCreatedVersionId(result.versionId);
      go('done');
    } catch (e) {
      setError(toUserMessage(e, 'save the agent'));
    } finally {
      setSubmitting(false);
    }
  }

  const ready = profile !== null && (selectedPack !== null || noPack);
  const skeleton = useHeldLoading(!ready && !loadError);
  const header = (
    <PageHeader
      title="Set up an"
      accent="AI hiring agent"
      description={`Name it and say what it should do on a call. Each ${job}’s description and questions are added on the ${job}.`}
      breadcrumb={<Breadcrumb items={CRUMBS} />}
    />
  );

  let body: ReactNode;
  if (skeleton) {
    body = <NewSkeleton />;
  } else if (!ready) {
    const m = toUserMessage(loadError, 'open agent setup');
    body = (
      <>
        {header}
        <ErrorState title={m.title} cause={m.detail} onRetry={() => void retry()} retrying={retrying} />
      </>
    );
  } else if (!canCreate) {
    body = (
      <>
        {header}
        <div className="rounded-card border border-border bg-canvas">
          <EmptyState
            icon={<Lock />}
            title="You can’t set up agents in this workspace"
            description="Ask a workspace admin to set one up, or to give you access."
            action={
              <Button asChild variant="secondary">
                <Link href="/agents">All agents</Link>
              </Button>
            }
          />
        </div>
      </>
    );
  } else if (!selectedPack) {
    body = (
      <>
        {header}
        <ErrorState
          title="Agent setup isn’t available right now"
          cause="Try again in a few minutes."
          onRetry={() => void retry()}
          retrying={retrying}
        />
      </>
    );
  } else {
    const stepIndex = STEPS.findIndex((s) => s.key === step);
    const phones = transferPhones.filter(Boolean);
    body = (
      <>
        {header}
        <ol role="list" aria-label="Steps" className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0 sm:gap-x-2">
          {STEPS.map((s, i) => {
            const active = i === stepIndex && !(s.key === 'done' && published);
            const done = i < stepIndex || (s.key === 'done' && published);
            return (
              <li key={s.key} aria-current={active ? 'step' : undefined} className="flex items-center gap-2">
                {i > 0 ? (
                  <span aria-hidden className={cn('h-px w-10 max-sm:hidden', i <= stepIndex ? 'bg-text-3' : 'bg-border')} />
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-pill border text-caption font-semibold tabular-nums',
                    done
                      ? 'border-status-success-border bg-status-success-bg text-status-success-text'
                      : active
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'border-border bg-canvas text-text-3',
                  )}
                >
                  {done ? <Check strokeWidth={2.5} className="size-3.5" /> : i + 1}
                </span>
                <span className={cn('text-label', active ? 'font-medium text-text' : done ? 'text-text-2' : 'text-text-3')}>
                  {s.label}
                  {done ? <span className="sr-only">, done</span> : null}
                </span>
              </li>
            );
          })}
        </ol>

        {step === 'configure' ? (
          <form onSubmit={goReview} className={cn(CARD, 'grid gap-5')}>
            <h2 ref={stepHeading} tabIndex={-1} className="m-0 text-section text-text">
              Describe your agent
            </h2>
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`For example, ${labels.agentDefaultName}`}
                required
                minLength={2}
                autoComplete="off"
              />
            </Field>
            <Field
              label="What should it do on a call?"
              hint={`Each ${job}’s own questions are added on the ${job}.`}
              error={purposeError}
            >
              <Textarea
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  if (purposeError && e.target.value.trim()) setPurposeError(null);
                }}
                placeholder={`Phone applicants for our warehouse ${labels.workItem.many.toLowerCase()}, ask each ${job}’s must-ask questions and note what they said.`}
                required
                rows={4}
              />
            </Field>
            <PhoneListField
              label="Hand-off numbers (optional)"
              hint={`When a ${contact} asks for a person, the call goes to one of these.`}
              value={transferPhones}
              onChange={setTransferPhones}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Continue</Button>
              <Button asChild variant="tertiary">
                <Link href="/agents">Cancel</Link>
              </Button>
            </div>
          </form>
        ) : null}

        {step === 'review' ? (
          <section aria-labelledby="new-agent-review" className={CARD}>
            <h2 id="new-agent-review" ref={stepHeading} tabIndex={-1} className="m-0 text-section text-text">
              Check and save
            </h2>
            <p className="mb-0 mt-1 text-text-2">It’s saved as a draft. You publish it in the next step.</p>
            <dl className="m-0 mt-5 divide-y divide-border rounded-card-sm border border-border">
              <ReviewRow label="Name">{name}</ReviewRow>
              <ReviewRow label="What it does">{purpose}</ReviewRow>
              <ReviewRow label="Hand-off numbers">
                {phones.length > 0 ? phones.join(', ') : <span className="text-text-3">None</span>}
              </ReviewRow>
            </dl>
            {error ? (
              <Alert kind="error" title={error.title} className="mt-4">
                {error.detail}
              </Alert>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" loading={submitting} onClick={() => void onSubmit()}>
                Save agent
              </Button>
              <Button type="button" variant="secondary" disabled={submitting} onClick={() => go('configure')}>
                Back
              </Button>
            </div>
          </section>
        ) : null}

        {step === 'done' && createdId ? (
          <>
            <section aria-labelledby="new-agent-done" className={CARD}>
              <div className="flex items-start gap-4">
                <HiringVoiceFace size={56} />
                <div className="min-w-0 flex-1">
                  <h2 id="new-agent-done" ref={stepHeading} tabIndex={-1} className="m-0 text-section text-text">
                    {published ? 'Your agent is live' : 'Saved as a draft'}
                  </h2>
                  {/* Polite, so publishing is read out where it happened. */}
                  <p role="status" className="mb-0 mt-1 text-text-2">
                    {published
                      ? `Next, create a ${job} with its description and questions. Then the agent can call your ${labels.contact.many.toLowerCase()}.`
                      : canDeploy
                        ? 'Publish it so it can place calls. A draft can’t call anyone.'
                        : 'Ask a workspace admin to publish it. A draft can’t call anyone.'}
                  </p>
                </div>
              </div>
              {error ? (
                <Alert kind="error" title={error.title} className="mt-4">
                  {error.detail}
                </Alert>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                {canDeploy && !published ? (
                  <Button type="button" loading={publishing} onClick={() => void onPublish()}>
                    <Radio aria-hidden strokeWidth={1.5} />
                    Publish
                  </Button>
                ) : null}
                <Button asChild variant={published ? 'primary' : 'secondary'}>
                  <Link href="/jobs?create=1">
                    <Plus aria-hidden strokeWidth={1.5} />
                    Create a {job}
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={`/agents/${toPublicId(createdId)}`}>Open its settings</Link>
                </Button>
              </div>
            </section>
            {published && canTest ? (
              <div className="max-w-2xl">
                <VoiceTestPanel agentId={createdId} canTest={canTest} agentPublished={published} />
              </div>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  return (
    <AppShell profile={profile} breadcrumb={CRUMBS}>
      <PageMain>{body}</PageMain>
    </AppShell>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-meta font-medium text-text-3">{label}</dt>
      <dd className="m-0 whitespace-pre-line text-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Title and line, the three steps, the first step's card. */
function NewSkeleton() {
  return (
    <SkeletonGroup>
      <div className="mb-8 space-y-3">
        <Skeleton className="h-7 w-72 max-w-full rounded-pill" />
        <Skeleton className="h-3 w-96 max-w-full rounded-pill" />
      </div>
      <div className="mb-6 flex gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-pill" />
        ))}
      </div>
      <div className={cn(CARD, 'space-y-5')}>
        <Skeleton className="h-5 w-48 rounded-pill" />
        <Skeleton className="h-11" />
        <Skeleton className="h-24" />
        <Skeleton className="h-10 w-28 rounded-button" />
      </div>
    </SkeletonGroup>
  );
}
