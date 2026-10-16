'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, ChevronRight, Circle, CircleCheck, Sparkles } from 'lucide-react';
import { ensureOrganization, myOrganizations, switchOrganization } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import type { HomeSnapshot } from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { meQueryKey } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';
import { organizationsQueryKey } from '@/components/layout/app-shell/account';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { HERO, HeroAgent, HeroLabel } from './queues';

interface Step {
  title: string;
  detail: string;
  /** null: this person can't see whether it is done. */
  done: boolean | null;
  action: string;
  href: string;
  /** Why the action isn't offered: no permission, or an earlier step comes first. */
  blocked?: string;
}

/**
 * First run (spec 7.1, audit H4): the three steps to a first call, each ticked from real data.
 * The sky card holds them, since setting up is the one thing Home asks for until it's done.
 */
export function GettingStarted({ snapshot, can }: { snapshot: HomeSnapshot; can: (permission: string) => boolean }) {
  const { labels } = useUseCase();
  const job = labels.workItem.one.toLowerCase();
  const contacts = labels.contact.many.toLowerCase();
  const askAdmin = 'Ask a workspace admin to do this.';
  const steps: Step[] = [
    {
      title: 'Set up your agent',
      detail: 'Pick a voice and publish it, so it can place calls.',
      done: snapshot.agents === null ? null : snapshot.agents > 0,
      action: 'Set up agent',
      href: '/agents/new?returnTo=%2Fdashboard',
      blocked: can('agents.create') ? undefined : askAdmin,
    },
    {
      title: `Create a ${job}`,
      detail: 'Add the job description and the questions to ask.',
      done: snapshot.jobs > 0,
      action: `Create ${job}`,
      href: '/jobs?create=1',
      blocked: can('jobs.create') ? undefined : askAdmin,
    },
    {
      title: `Add ${contacts} and call`,
      detail: 'Add people one by one or import a CSV, then call them.',
      done: snapshot.candidates === null ? null : snapshot.candidates > 0,
      action: `Add ${contacts}`,
      href: snapshot.firstJobId ? `/jobs/${toPublicId(snapshot.firstJobId)}/candidates` : '/jobs',
      blocked: !can('candidates.create')
        ? askAdmin
        : snapshot.jobs === 0
          ? `Create a ${job} first.`
          : undefined,
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.findIndex((step) => step.done === false);
  const primary = steps.findIndex((step) => step.done === false && !step.blocked);

  return (
    <section aria-labelledby="home-setup" className={HERO}>
      {/* Idle: no call has happened yet. The corner is the agent's, so the count sits by the label,
          on the bare sky (glass under 12px text would drop below 4.5:1). */}
      <HeroAgent state="idle" />
      <div className="flex flex-wrap items-center gap-3 pr-16 sm:pr-24">
        <HeroLabel id="home-setup" icon={<Sparkles />}>
          Getting started
        </HeroLabel>
        <p className="m-0 rounded-pill border border-[var(--glass-border)] px-2.5 py-0.5 text-caption font-medium tabular-nums">
          {doneCount} of {steps.length} done
        </p>
      </div>
      <p className="mb-0 mt-6 max-w-[24ch] text-subpage">Three steps to your first screening call</p>
      <p className="mb-0 mt-2 max-w-[56ch] text-body">
        Then the agent calls each {labels.contact.one.toLowerCase()}, asks your questions and hands you the answers.
      </p>
      <ol role="list" className="m-0 mt-7 grid list-none gap-3 p-0 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col rounded-card bg-canvas p-5 text-text shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-pill border border-border bg-subtle text-label font-semibold tabular-nums text-text-2"
              >
                {index + 1}
              </span>
              {step.done === true ? (
                <StatusBadge tone="success" icon={CircleCheck}>
                  Done
                </StatusBadge>
              ) : step.done === false ? (
                index === next ? (
                  <StatusBadge tone="info" icon={ArrowRight}>
                    Up next
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="neutral" icon={Circle}>
                    To do
                  </StatusBadge>
                )
              ) : null}
            </div>
            <h3 className="mb-0 mt-4 text-title font-semibold">{step.title}</h3>
            <p className="mb-0 mt-1 text-text-2">{step.detail}</p>
            {step.done === true ? null : (
              <div className="mt-auto pt-5">
                {step.blocked ? (
                  <p className="m-0 text-meta text-text-3">{step.blocked}</p>
                ) : (
                  <Button asChild variant={index === primary ? 'primary' : 'secondary'}>
                    <Link href={step.href}>
                      {step.action}
                      {index === primary ? <ArrowUpRight aria-hidden strokeWidth={1.5} /> : null}
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const PANEL = 'w-full max-w-lg rounded-card border border-border bg-canvas p-6 sm:p-8';

/**
 * Signed in with no active workspace. Never creates one quietly (audit H9): pick one you
 * belong to, or name a new one.
 */
export function WorkspaceSetup() {
  const orgs = useQuery({ queryKey: organizationsQueryKey, queryFn: myOrganizations });

  if (orgs.isError) {
    const message = toUserMessage(orgs.error, 'load your workspaces');
    return (
      <ErrorState
        title={message.title}
        cause={message.detail}
        onRetry={() => void orgs.refetch()}
        retrying={orgs.isFetching}
      />
    );
  }
  if (!orgs.data) {
    return (
      <SkeletonGroup>
        <span className="block h-72 w-full max-w-lg rounded-card bg-muted motion-safe:animate-pulse" />
      </SkeletonGroup>
    );
  }
  const list = orgs.data.organizations;
  return list.length > 0 ? <ChooseWorkspace orgs={list} /> : <CreateWorkspace />;
}

function ChooseWorkspace({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function open(id: string) {
    if (opening) return;
    setOpening(id);
    setError(null);
    switchOrganization(id)
      // A full load, as the shell's switcher does, so nothing from before carries over.
      .then(() => window.location.assign('/dashboard'))
      .catch((e: unknown) => {
        setOpening(null);
        const message = toUserMessage(e, 'open that workspace');
        setError(messageText(message));
      });
  }

  return (
    <section aria-labelledby="home-choose" className={PANEL}>
      <h2 id="home-choose" className="m-0 text-section text-text">
        Choose a workspace
      </h2>
      <p className="mb-0 mt-1 text-text-2">
        {orgs.length > 1
          ? 'You belong to more than one. You can switch any time from the workspace menu.'
          : 'Open your workspace to see what needs you.'}
      </p>
      <ul role="list" className="m-0 mt-6 list-none space-y-2 p-0">
        {orgs.map((org) => (
          <li key={org.id}>
            <Button
              variant="secondary"
              className="w-full justify-between"
              loading={opening === org.id}
              disabled={opening !== null && opening !== org.id}
              onClick={() => open(org.id)}
            >
              <span className="truncate">{org.name.trim() || 'Untitled workspace'}</span>
              <ChevronRight aria-hidden strokeWidth={1.5} />
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <Alert kind="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
    </section>
  );
}

function CreateWorkspace() {
  const queryClient = useQueryClient();
  const { labels } = useUseCase();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFieldError('Use at least 2 characters.');
      return;
    }
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    try {
      await ensureOrganization(trimmed);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
        queryClient.invalidateQueries({ queryKey: organizationsQueryKey }),
      ]);
    } catch (e) {
      const message = toUserMessage(e, 'create the workspace');
      const field = message.fieldErrors?.[0]?.message;
      if (field) setFieldError(field);
      else setFormError(messageText(message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="home-create" className={PANEL}>
      <h2 id="home-create" className="m-0 text-section text-text">
        Create your workspace
      </h2>
      <p className="mb-0 mt-1 text-text-2">
        Your {labels.workItem.many.toLowerCase()}, {labels.contact.many.toLowerCase()} and calls live in a workspace.
        If someone invited you, open the link in their email instead.
      </p>
      <Field
        label="Workspace name"
        hint="Shown to your team, for example Sharma Logistics."
        error={fieldError}
        className="mt-6"
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="organization"
          maxLength={100}
          required
        />
      </Field>
      {formError ? (
        <Alert kind="error" className="mt-4">
          {formError}
        </Alert>
      ) : null}
      <Button type="submit" loading={busy} className="mt-6">
        Create workspace
      </Button>
    </form>
  );
}
