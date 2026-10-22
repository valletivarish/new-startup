'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  AudioLines,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleCheck,
  PhoneCall,
  UsersRound,
} from 'lucide-react';
import { ensureOrganization, getTelephonyStatus, myOrganizations, switchOrganization } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import type { HomeSnapshot } from '@/lib/hiring-people';
import { toPublicId } from '@/lib/public-id';
import { meQueryKey } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';
import { organizationsQueryKey } from '@/components/layout/app-shell/account';
import { Agent } from '@/components/brand/agent';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { SkeletonGroup } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';

interface Step {
  title: string;
  detail: string;
  icon: ReactNode;
  /** null: this person can't see whether it is done. */
  done: boolean | null;
  action: string;
  href: string;
  /** Why the action isn't offered: no permission, or an earlier step comes first. */
  blocked?: string;
}

/** Progress as the voice bars: one bar per step, filled when it's done. The words carry it. */
function StepBars({ done, total }: { done: number; total: number }) {
  return (
    <span aria-hidden className="flex items-end gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'w-1.5 rounded-pill transition-colors duration-base forced-colors:bg-[CanvasText]',
            i < done ? 'bg-primary' : 'bg-muted forced-colors:opacity-40',
            i % 2 === 0 ? 'h-6' : 'h-4',
          )}
        />
      ))}
    </span>
  );
}

/**
 * First run (spec 7.1, audit H4): the steps to a first call as one checklist, each ticked from
 * real data, with one navy pill on the step that comes next. Beside it, the agent says what it
 * will do once setup is done (D2's pale card, not a saturated block).
 */
export function GettingStarted({ snapshot, can }: { snapshot: HomeSnapshot; can: (permission: string) => boolean }) {
  const { labels } = useUseCase();
  const job = labels.workItem.one.toLowerCase();
  const contact = labels.contact.one.toLowerCase();
  const contacts = labels.contact.many.toLowerCase();
  const askAdmin = 'Ask a workspace admin to do this.';
  // The same calling-number check as Home's call buttons; without the permission the step isn't theirs.
  const canCall = can('calls.initiate');
  const telephony = useQuery({ queryKey: ['telephony-status'], queryFn: getTelephonyStatus, enabled: canCall });
  const steps: Step[] = [
    {
      title: 'Set up the call',
      detail: 'Pick a voice and publish it, so it can place calls.',
      icon: <AudioLines />,
      done: snapshot.agents === null ? null : snapshot.agents > 0,
      action: 'Set up the call',
      href: '/agents/new?returnTo=%2Fjobs',
      blocked: can('agents.create') ? undefined : askAdmin,
    },
    {
      title: `Create a ${job}`,
      detail: 'Add the job description and the questions to ask.',
      icon: <BriefcaseBusiness />,
      done: snapshot.jobs > 0,
      action: `Create ${job}`,
      href: '/jobs?create=1',
      blocked: can('jobs.create') ? undefined : askAdmin,
    },
    {
      title: `Add ${contacts}`,
      detail: 'Add people one by one, import a CSV or upload resumes.',
      icon: <UsersRound />,
      done: snapshot.candidates === null ? null : snapshot.candidates > 0,
      action: `Add ${contacts}`,
      href: snapshot.firstJobId ? `/jobs/${toPublicId(snapshot.firstJobId)}/people` : '/jobs',
      blocked: !can('candidates.create')
        ? askAdmin
        : snapshot.jobs === 0
          ? `Create a ${job} first.`
          : undefined,
    },
  ];
  if (canCall) {
    steps.push({
      title: 'Connect your calling number',
      detail: 'Needed for phone calls. Until then, you can try a screen in the browser from any job.',
      icon: <PhoneCall />,
      // A check that failed or hasn't answered yet isn't shown as done or not done.
      done: telephony.data ? telephony.data.outboundPhone : null,
      action: 'See calling number',
      href: '/settings/company',
    });
  }
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.findIndex((step) => step.done === false && !step.blocked);
  const left = steps.length - doneCount;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="home-setup" className="overflow-hidden rounded-card border border-border bg-canvas">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 id="home-setup" className="m-0 text-section text-text">
              Get ready for your first screening call
            </h2>
            <p className="mb-0 mt-1 text-text-2">Each step ticks itself off once it’s done.</p>
          </div>
          <p className="m-0 flex items-center gap-3 text-label font-medium tabular-nums text-text-2">
            <StepBars done={doneCount} total={steps.length} />
            {doneCount} of {steps.length} done
          </p>
        </div>
        <ol role="list" className="m-0 list-none divide-y divide-border border-t border-border p-0">
          {steps.map((step, index) => {
            const isNext = index === next;
            return (
              <li
                key={step.title}
                aria-current={isNext ? 'step' : undefined}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6',
                  isNext && 'bg-accent-soft',
                )}
              >
                <StepMarker index={index} done={step.done === true} isNext={isNext} icon={step.icon} />
                <div className="min-w-0">
                  <h3
                    className={cn(
                      'm-0 text-md font-medium',
                      step.done === true ? 'text-text-2' : 'text-text',
                    )}
                  >
                    {step.title}
                    {step.done === true ? <span className="sr-only"> (done)</span> : null}
                  </h3>
                  {step.done === true ? null : <p className="mb-0 mt-0.5 text-meta text-text-2">{step.detail}</p>}
                  {step.done !== true && step.blocked ? (
                    <p className="mb-0 mt-1 text-meta text-text-3">{step.blocked}</p>
                  ) : null}
                </div>
                {step.done === true ? (
                  <StatusBadge tone="success" icon={CircleCheck} className="col-start-2 justify-self-start sm:col-start-auto">
                    Done
                  </StatusBadge>
                ) : step.blocked ? null : (
                  <Button
                    asChild
                    variant={isNext ? 'primary' : 'secondary'}
                    size={isNext ? 'md' : 'sm'}
                    className="col-start-2 justify-self-start sm:col-start-auto"
                  >
                    <Link href={step.href}>
                      {step.action}
                      {isNext ? <ArrowUpRight aria-hidden strokeWidth={1.5} /> : null}
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
        <p className="m-0 border-t border-border px-5 py-3 text-meta text-text-3 sm:px-6">
          {left === 0
            ? 'All set. Calls that need you show up here.'
            : `${left} ${left === 1 ? 'step' : 'steps'} left. Once calls start, this page lists the ones that need you.`}
        </p>
      </section>
      <AgentNote contact={contact} job={job} />
    </div>
  );
}

/** Numbered ring, the step's icon on the step that comes next, a navy tick once done. */
function StepMarker({ index, done, isNext, icon }: { index: number; done: boolean; isNext: boolean; icon: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-pill text-label font-semibold tabular-nums [&_svg]:size-[1.125rem] [&_svg]:[stroke-width:1.5]',
        done
          ? 'bg-primary text-primary-foreground'
          : isNext
            ? 'border border-primary bg-canvas text-text'
            : 'border border-border bg-subtle text-text-2',
      )}
    >
      {done ? <Check /> : isNext ? icon : index + 1}
    </span>
  );
}

/** What the agent does once setup is done, said by the agent: it never decides, the recruiter does. */
function AgentNote({ contact, job }: { contact: string; job: string }) {
  const lines = [
    `Calls each ${contact} on their phone`,
    `Asks the questions you set for the ${job}`,
    'Hands you the answers, a summary and the recording',
  ];
  return (
    <aside aria-labelledby="home-agent-note" className="rounded-card border border-border bg-subtle p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Agent size={56} state="idle" onLight hoverable />
        <h2 id="home-agent-note" className="m-0 text-title font-semibold text-text">
          Then HRVoice takes the calls
        </h2>
      </div>
      <ol role="list" className="m-0 mt-5 list-none space-y-3 p-0">
        {lines.map((line, i) => (
          <li key={line} className="flex gap-3 text-text-2">
            <span
              aria-hidden
              className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-pill bg-canvas text-caption font-semibold tabular-nums text-text-2 shadow-xs"
            >
              {i + 1}
            </span>
            {line}
          </li>
        ))}
      </ol>
      <p className="mb-0 mt-5 border-t border-border pt-4 text-meta text-text-2">
        You read what was said and decide who moves forward.
      </p>
    </aside>
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
      .then(() => window.location.assign('/jobs'))
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
