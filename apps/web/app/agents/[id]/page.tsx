'use client';

/**
 * One agent (D2): its state beside the controls that change it, a test call in the browser,
 * the numbers it hands calls to, and where its words come from. Voice, persona and hand-off
 * are set here; each job's description and must-ask questions are set on the job.
 * Agents that aren't hiring agents also get the builder's advanced settings and session log.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Archive, ChevronDown, CirclePause, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { agentStateCopy } from '@/components/agents/copy';
import { AgentSources } from '@/components/agents/sources';
import { HiringVoiceFace } from '@/components/fx/HiringVoiceFace';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Skeleton, SkeletonRecord, useHeldLoading } from '@/components/ui/skeleton';
import { StatusTag } from '@/components/ui/state-tag';
import {
  ApiClientError,
  agentAction,
  createDraft,
  createSession,
  getAgent,
  grantAgentTool,
  listAgentTools,
  listSessionEvents,
  listSessions,
  listToolExecutions,
  listTools,
  listVersions,
  me,
  publishVersion,
  revokeAgentTool,
  sendSessionMessage,
  updateDraft,
  type Agent,
  type AgentSession,
  type AgentVersion,
  type Me,
  type SessionEvent,
  type Tool,
  type ToolExecution,
} from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/format';
import { fromPublicId } from '@/lib/public-id';
import { useUseCase } from '@/lib/use-cases';
import { VoiceTestPanel } from '@/src/integrations/elevenlabs/VoiceTestPanel';

const INTELLIGENCE_TIERS = ['standard', 'advanced', 'premium'] as const;

const CARD = 'rounded-card border border-border bg-canvas p-5 sm:p-6';
// Two columns from lg: the agent's own cards, then where its words come from.
const COLUMNS = 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]';

/** Reads a nested value without asserting the configuration's shape. */
function tierOf(configuration: Record<string, unknown> | undefined): string {
  const capabilities = configuration?.['capabilities'];
  if (capabilities && typeof capabilities === 'object') {
    const tier = (capabilities as Record<string, unknown>)['intelligenceTier'];
    if (typeof tier === 'string') return tier;
  }
  return 'standard';
}

function transferPhonesFromConfig(
  configuration: Record<string, unknown> | undefined,
): string[] {
  const escalation = configuration?.['escalation'];
  if (!escalation || typeof escalation !== 'object') return [];
  const phones = (escalation as Record<string, unknown>)['transferPhones'];
  if (!Array.isArray(phones)) return [];
  return phones.map((p) => String(p).trim()).filter(Boolean);
}

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const agentId = fromPublicId(params.id) ?? params.id;
  const { labels } = useUseCase();
  const stateHeading = useRef<HTMLHeadingElement>(null);

  const [profile, setProfile] = useState<Me | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [draftText, setDraftText] = useState('');
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [message, setMessage] = useState('');
  const [catalogue, setCatalogue] = useState<Tool[]>([]);
  const [agentTools, setAgentTools] = useState<Tool[]>([]);
  const [executions, setExecutions] = useState<ToolExecution[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [transferEdit, setTransferEdit] = useState('');
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState<'publish' | 'pause' | 'archive' | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, a, v] = await Promise.all([
        me(),
        getAgent(agentId),
        listVersions(agentId),
      ]);
      setProfile(p);
      setAgent(a);
      setVersions(v.versions);
      const draft = v.versions.find((x) => x.status === 'draft');
      const published = v.versions.find((x) => x.status === 'published');
      const cfg =
        (draft?.configuration as Record<string, unknown> | undefined) ??
        (published?.configuration as Record<string, unknown> | undefined);
      if (draft) setDraftText(JSON.stringify(draft.configuration, null, 2));
      setTransferEdit(transferPhonesFromConfig(cfg).join('\n'));
      if (p.activeOrganization?.permissions.includes('agents.sessions.read')) {
        setSessions((await listSessions(agentId)).sessions);
      }
      const [all, granted] = await Promise.all([
        listTools(),
        listAgentTools(agentId),
      ]);
      setCatalogue(all.tools);
      setAgentTools(granted.tools);
      setLoadError(null);
    } catch (e) {
      // A 401 is already on its way to sign-in (lib/api).
      setLoadError(e);
    }
  }, [agentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const skeleton = useHeldLoading(agent === null && !loadError);
  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const draft = versions.find((v) => v.status === 'draft');
  const published = versions.find((v) => v.status === 'published');
  const isHiring = agent?.type === 'hiring';
  const configForSummary = published?.configuration ?? draft?.configuration;
  const transferPhones = transferPhonesFromConfig(configForSummary);
  const showBuilderChrome = can('agents.update') && !isHiring;
  const canTest = can('agents.test') || can('calls.initiate');

  async function run(action: () => Promise<unknown>, ok: string, context: string) {
    try {
      await action();
      toast.success(ok);
      await reload();
      return true;
    } catch (e) {
      const m = toUserMessage(e, context);
      toast.error(m.title, { description: m.detail });
      return false;
    }
  }

  /** Publish or pause. The button goes once the state changes, so focus moves to the new state's heading. */
  async function lifecycle(kind: 'publish' | 'pause') {
    setBusy(kind);
    const done =
      kind === 'publish'
        ? await run(
            async () => {
              const draftVer = versions.find((v) => v.status === 'draft');
              if (draftVer) {
                await publishVersion(agentId, draftVer.id);
                return;
              }
              await agentAction(agentId, 'publish');
            },
            'Published. The agent can call now.',
            'publish the agent',
          )
        : await run(
            () => agentAction(agentId, 'pause'),
            'Paused. The agent calls no one until you publish it again.',
            'pause the agent',
          );
    setBusy(null);
    if (done) stateHeading.current?.focus();
  }

  async function archive() {
    setBusy('archive');
    setArchiveError(null);
    try {
      await agentAction(agentId, 'archive');
      setArchiveOpen(false);
      toast.success('Archived. It stays in your records.');
      await reload();
      stateHeading.current?.focus();
    } catch (e) {
      const m = toUserMessage(e, 'archive the agent');
      setArchiveError(messageText(m));
    } finally {
      setBusy(null);
    }
  }

  async function saveTransferPhones() {
    if (!can('agents.update')) return;
    setSavingTransfer(true);
    setTransferError(null);
    try {
      const phones = transferEdit
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);

      let draftId = versions.find((v) => v.status === 'draft')?.id;
      const publishedVer = versions.find((v) => v.status === 'published');
      const existingDraft = versions.find((v) => v.status === 'draft');
      const baseConfig =
        ((existingDraft?.configuration ??
          publishedVer?.configuration) as Record<string, unknown>) ?? {};
      if (!draftId) {
        const created = await createDraft(agentId, baseConfig);
        draftId = created.id;
      }
      const prevEscalation =
        baseConfig['escalation'] && typeof baseConfig['escalation'] === 'object'
          ? (baseConfig['escalation'] as Record<string, unknown>)
          : {};
      const next = {
        ...baseConfig,
        escalation: {
          ...prevEscalation,
          enabled: Boolean(prevEscalation['enabled']) || phones.length > 0,
          trigger: prevEscalation['trigger'] ?? 'on_request',
          transferPhones: phones,
        },
      };
      await updateDraft(agentId, draftId, next);
      if (can('agents.deploy')) {
        await publishVersion(agentId, draftId);
        toast.success('Hand-off numbers saved. The agent uses them from the next call.');
      } else {
        toast.success('Hand-off numbers saved', {
          description: 'They apply once a workspace admin publishes the agent.',
        });
      }
      await reload();
    } catch (e) {
      const m = toUserMessage(e, 'save the hand-off numbers');
      setTransferError(messageText(m));
    } finally {
      setSavingTransfer(false);
    }
  }

  async function openSession(id: string) {
    setActiveSession(id);
    setEvents((await listSessionEvents(id)).events);
    if (can('agents.sessions.read')) {
      setExecutions((await listToolExecutions(id)).executions);
    }
  }

  const crumbs = [{ label: 'Agents', href: '/agents' }, { label: agent?.name ?? 'Agent' }];

  if (!agent) {
    let body: ReactNode;
    if (skeleton) {
      body = <DetailSkeleton />;
    } else {
      const m = toUserMessage(loadError, 'open this agent');
      // The whole page: the error names it (h1), with Retry and the way out.
      body = (
        <ErrorState
          headingLevel={1}
          title={m.title}
          cause={m.detail}
          retrying={retrying}
          onRetry={async () => {
            setRetrying(true);
            await reload();
            setRetrying(false);
          }}
          action={
            <Button asChild variant="tertiary">
              <Link href="/agents">All agents</Link>
            </Button>
          }
        />
      );
    }
    return (
      <AppShell profile={profile} breadcrumb={crumbs}>
        <PageMain>{body}</PageMain>
      </AppShell>
    );
  }

  const state = agentStateCopy(agent.status, labels);
  const canPublish = can('agents.deploy') && agent.status !== 'published' && agent.status !== 'archived';
  const canPause = can('agents.pause') && agent.status === 'published';
  const canArchive = can('agents.archive') && agent.status !== 'archived';

  return (
    <AppShell profile={profile} breadcrumb={crumbs}>
      <PageMain>
        <PageHeader
          title={agent.name}
          status={<StatusTag domain="agent" value={agent.status} />}
          description={agent.purpose || 'No description yet.'}
          breadcrumb={<Breadcrumb items={crumbs} />}
        />

        {loadError ? (
          <Alert
            kind="warning"
            title="Couldn’t refresh this agent"
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={retrying}
                onClick={async () => {
                  setRetrying(true);
                  await reload();
                  setRetrying(false);
                }}
              >
                Retry
              </Button>
            }
          >
            What you see is from the last time it loaded.
          </Alert>
        ) : null}

        <div className={COLUMNS}>
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="agent-state" className={CARD}>
              <div className="flex items-start gap-4">
                <HiringVoiceFace size={56} />
                <div className="min-w-0 flex-1">
                  {/* The state's tag sits by the agent's name; focus lands here after Publish or Pause. */}
                  <h2 id="agent-state" ref={stateHeading} tabIndex={-1} className="m-0 text-section text-text">
                    {state.title}
                  </h2>
                  <p className="mb-0 mt-1 text-text-2">{state.line}</p>
                  {!isHiring && agent.currentVersion !== null ? (
                    <p className="mb-0 mt-1 text-meta text-text-3 tabular-nums">
                      Live setup: version {agent.currentVersion}
                    </p>
                  ) : null}
                  {canPublish || canPause || canArchive ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {canPublish ? (
                        <Button
                          type="button"
                          loading={busy === 'publish'}
                          disabled={busy !== null && busy !== 'publish'}
                          onClick={() => void lifecycle('publish')}
                        >
                          <Radio aria-hidden strokeWidth={1.5} />
                          Publish
                        </Button>
                      ) : null}
                      {canPause ? (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={busy === 'pause'}
                          disabled={busy !== null && busy !== 'pause'}
                          onClick={() => void lifecycle('pause')}
                        >
                          <CirclePause aria-hidden strokeWidth={1.5} />
                          Pause
                        </Button>
                      ) : null}
                      {canArchive ? (
                        <Button
                          type="button"
                          variant="tertiary"
                          disabled={busy !== null}
                          onClick={() => {
                            setArchiveError(null);
                            setArchiveOpen(true);
                          }}
                        >
                          <Archive aria-hidden strokeWidth={1.5} />
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {canTest ? (
              <VoiceTestPanel
                agentId={agentId}
                canTest={canTest}
                agentPublished={agent.status === 'published'}
              />
            ) : null}

            {isHiring ? (
              <section aria-labelledby="agent-handoff" className={CARD}>
                <h2 id="agent-handoff" className="m-0 text-section text-text">
                  Hand calls to your team
                </h2>
                <p className="mb-0 mt-1 max-w-[65ch] text-text-2">
                  When a {labels.contact.one.toLowerCase()} asks for a person, the agent transfers
                  the call to one of these numbers.
                </p>
                {can('agents.update') ? (
                  <form
                    className="mt-5 grid max-w-xl gap-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveTransferPhones();
                    }}
                  >
                    <Field
                      label="Hand-off numbers"
                      hint="One number per line, with the country code, like +91 98765 43210. Up to 10."
                      error={transferError}
                    >
                      <Textarea
                        value={transferEdit}
                        onChange={(e) => setTransferEdit(e.target.value)}
                        placeholder="+91 98765 43210"
                        rows={3}
                      />
                    </Field>
                    <div>
                      <Button type="submit" variant="secondary" loading={savingTransfer}>
                        Save numbers
                      </Button>
                    </div>
                  </form>
                ) : transferPhones.length === 0 ? (
                  <p className="mb-0 mt-4 text-text-3">No hand-off numbers yet.</p>
                ) : (
                  <ul role="list" className="m-0 mt-4 list-none space-y-1 p-0 tabular-nums text-text">
                    {transferPhones.map((phone) => (
                      <li key={phone}>{formatPhone(phone)}</li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {showBuilderChrome ? (
              <Advanced
                agent={agent}
                versions={versions}
                draft={draft}
                published={published}
                draftText={draftText}
                setDraftText={setDraftText}
                catalogue={catalogue}
                agentTools={agentTools}
                sessions={sessions}
                activeSession={activeSession}
                events={events}
                executions={executions}
                message={message}
                setMessage={setMessage}
                open={showAdvanced}
                setOpen={setShowAdvanced}
                can={can}
                run={run}
                openSession={openSession}
                agentId={agentId}
              />
            ) : null}
          </div>

          <AgentSources can={can} />
        </div>

        <ConfirmDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={`Archive ${agent.name}?`}
          body={`It stays in your records, but it can’t be changed, published or used for new calls. ${labels.workItem.many} that use it need another live agent before they can call.`}
          confirmLabel="Archive agent"
          tone="danger"
          busy={busy === 'archive'}
          error={archiveError}
          onConfirm={() => void archive()}
        />
      </PageMain>
    </AppShell>
  );
}

/** The page's own shape: name, tag and line, the state card, a second card, and the aside. */
function DetailSkeleton() {
  return (
    <SkeletonRecord tabs={0}>
      <div className={COLUMNS}>
        <div className="space-y-6">
          <div className={cn(CARD, 'flex gap-4')}>
            <Skeleton className="size-14 shrink-0 rounded-pill" />
            <div className="flex-1 space-y-3 pt-1">
              <Skeleton className="h-4 w-1/3 rounded-pill" />
              <Skeleton className="h-3 w-2/3 rounded-pill" />
              <Skeleton className="h-10 w-48 rounded-button" />
            </div>
          </div>
          <div className={cn(CARD, 'space-y-3')}>
            <Skeleton className="h-4 w-1/4 rounded-pill" />
            <Skeleton className="h-3 w-3/4 rounded-pill" />
            <Skeleton className="h-10 w-36 rounded-button" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-48 rounded-pill" />
          <Skeleton className="h-20 rounded-card-sm" />
          <Skeleton className="h-20 rounded-card-sm" />
        </div>
      </div>
    </SkeletonRecord>
  );
}

/** One collapsible group of the advanced settings. */
function Group({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-card-sm border border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-card-sm px-4 text-label font-semibold text-text marker:content-none focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden
          strokeWidth={1.5}
          className="size-4 shrink-0 text-text-3 transition-transform duration-fast group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}

/** The builder's settings and session log, for agents that aren't hiring agents. */
function Advanced({
  agent,
  versions,
  draft,
  published,
  draftText,
  setDraftText,
  catalogue,
  agentTools,
  sessions,
  activeSession,
  events,
  executions,
  message,
  setMessage,
  open,
  setOpen,
  can,
  run,
  openSession,
  agentId,
}: {
  agent: Agent;
  versions: AgentVersion[];
  draft: AgentVersion | undefined;
  published: AgentVersion | undefined;
  draftText: string;
  setDraftText: (text: string) => void;
  catalogue: Tool[];
  agentTools: Tool[];
  sessions: AgentSession[];
  activeSession: string | null;
  events: SessionEvent[];
  executions: ToolExecution[];
  message: string;
  setMessage: (text: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  can: (permission: string) => boolean;
  run: (action: () => Promise<unknown>, ok: string, context: string) => Promise<boolean>;
  openSession: (id: string) => Promise<void>;
  agentId: string;
}) {
  return (
    <section aria-labelledby="agent-advanced" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="agent-advanced" className="m-0 text-section text-text">
          Advanced settings
        </h2>
        <Button type="button" variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      <p className="mb-0 mt-1 text-text-2">For technical admins. Changes stay unpublished until you publish them.</p>

      {open ? (
        <div className="mt-5 space-y-3">
          <Group title="Saved setups" open>
            <ul role="list" className="m-0 list-none divide-y divide-border p-0">
              {versions.map((v) => (
                <li key={v.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2">
                  <span className="tabular-nums">
                    Setup {v.version}
                    <span className="text-text-3">
                      {' · '}
                      {v.status === 'published' ? 'Live' : v.status === 'draft' ? 'Unpublished' : 'Earlier'}
                    </span>
                  </span>
                  {v.status === 'draft' && can('agents.deploy') ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void run(() => publishVersion(agentId, v.id), 'This setup is now live.', 'publish this setup')
                      }
                    >
                      Make this live
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {can('agents.update') && !draft && published ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  void run(
                    () => createDraft(agentId, published.configuration),
                    'Started a new unpublished setup from the live one.',
                    'start a new setup',
                  )
                }
              >
                Start a new setup
              </Button>
            ) : null}
          </Group>

          <Group title="Intelligence">
            <p className="m-0 text-meta text-text-2">
              A tier is a capability, not a model. Which model serves a tier is a platform
              decision, so this setting survives changes behind the scenes.
            </p>
            <p className="m-0">
              Live tier: <strong className="font-semibold">{published ? tierOf(published.configuration) : 'not published'}</strong>
            </p>
            {draft && can('agents.update') ? (
              <Field label="Unpublished setup tier" className="max-w-xs">
                <Select
                  value={tierOf(draft.configuration)}
                  onChange={(e) =>
                    void run(
                      async () => {
                        const next = {
                          ...draft.configuration,
                          capabilities: {
                            ...((draft.configuration['capabilities'] as Record<string, unknown>) ?? {}),
                            intelligenceTier: e.target.value,
                          },
                        };
                        await updateDraft(agentId, draft.id, next);
                        setDraftText(JSON.stringify(next, null, 2));
                      },
                      'Tier updated. Publish to use it on calls.',
                      'update the tier',
                    )
                  }
                >
                  {INTELLIGENCE_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </Group>

          <Group title="Integrations">
            <p className="m-0 text-meta text-text-2">
              Company integrations this agent may use during a call. Most teams leave these off.
            </p>
            {catalogue.length === 0 ? (
              <p className="m-0 text-text-2">No integrations are available in this workspace yet. Calls work without them.</p>
            ) : (
              <ul role="list" className="m-0 list-none divide-y divide-border p-0">
                {catalogue.map((tool) => {
                  const isGranted = agentTools.some((t) => t.id === tool.id);
                  return (
                    <li key={tool.id} className="flex min-h-12 items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        {tool.name}
                        {!tool.enabled ? <span className="text-meta text-text-3"> · switched off in this workspace</span> : null}
                      </span>
                      {can('agents.update') ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void run(
                              () => (isGranted ? revokeAgentTool(agentId, tool.id) : grantAgentTool(agentId, tool.id)),
                              isGranted ? `${tool.name} is off for this agent.` : `${tool.name} is on for this agent.`,
                              isGranted ? `turn off ${tool.name}` : `turn on ${tool.name}`,
                            )
                          }
                        >
                          {isGranted ? 'Turn off' : 'Turn on'}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Group>

          {draft && can('agents.update') ? (
            <Group title="Setup text">
              <p className="m-0 text-meta text-text-2">
                The unpublished setup as text. Each job’s questions and documents are set on the job instead.
              </p>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={14}
                className="min-h-[16rem] font-mono text-meta"
                aria-label="Unpublished setup text"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void run(
                    async () => {
                      let parsed: unknown;
                      try {
                        parsed = JSON.parse(draftText);
                      } catch {
                        throw new ApiClientError(422, {
                          code: 'validation_failed',
                          message: 'That setup text could not be read. Ask a technical admin to check it.',
                        });
                      }
                      return updateDraft(agentId, draft.id, parsed);
                    },
                    'Setup saved.',
                    'save the setup',
                  )
                }
              >
                Save setup
              </Button>
            </Group>
          ) : null}

          {can('agents.sessions.read') ? (
            <Group title="Test sessions">
              {can('agents.sessions.manage') && agent.status === 'published' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void run(
                      async () => {
                        const s = await createSession(agentId);
                        await openSession(s.id);
                      },
                      'Session started.',
                      'start a session',
                    )
                  }
                >
                  Start a test session
                </Button>
              ) : null}
              {sessions.length === 0 ? (
                <p className="m-0 text-text-3">No sessions yet.</p>
              ) : (
                <ul role="list" className="m-0 list-none divide-y divide-border p-0">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex min-h-11 flex-wrap items-center gap-x-2 py-1.5">
                      <Button type="button" variant="link" className="h-auto px-0" onClick={() => void openSession(s.id)}>
                        {s.id.slice(0, 8)}
                      </Button>
                      <span className="text-meta text-text-3 tabular-nums">
                        Setup {s.agentVersion} · {s.status}
                        {s.endedReason ? ` (${s.endedReason})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Group>
          ) : null}

          {activeSession ? (
            <Group title="Session log" open>
              <ol className="m-0 space-y-1 pl-5 font-mono text-meta">
                {events.map((e) => {
                  const citations = Array.isArray(e.payload?.['citations'])
                    ? (e.payload['citations'] as { documentName: string }[])
                    : [];
                  const tone =
                    e.type === 'ErrorOccurred' || e.type === 'ToolFailed'
                      ? 'text-status-danger-text'
                      : e.direction === 'inbound'
                        ? 'text-status-warning-text'
                        : 'text-status-success-text';
                  return (
                    <li key={e.id}>
                      <span className={tone}>
                        {e.sequence}. {e.type}
                      </span>
                      {typeof e.payload?.['content'] === 'string' ? (
                        <span className="text-text-2"> {String(e.payload['content'])}</span>
                      ) : null}
                      {typeof e.payload?.['message'] === 'string' ? (
                        <span className="text-text-2"> {String(e.payload['message'])}</span>
                      ) : null}
                      {typeof e.payload?.['toolName'] === 'string' ? (
                        <span className="text-text-2"> {String(e.payload['toolName'])}</span>
                      ) : null}
                      {citations.length > 0 ? (
                        <span className="text-text-2">
                          {' '}
                          · from {citations.map((c) => c.documentName).join(', ')}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>

              {executions.length > 0 ? (
                <>
                  <h3 className="m-0 text-label font-semibold">Integration calls</h3>
                  <ul role="list" className="m-0 list-none p-0 font-mono text-meta">
                    {executions.map((x) => (
                      <li key={x.id} className="py-0.5">
                        <span className={x.status === 'completed' ? 'text-status-success-text' : 'text-status-danger-text'}>
                          {x.toolName}, {x.status}
                        </span>
                        {x.denialReason ? ` (${x.denialReason})` : ''}
                        {x.durationMs !== null ? ` · ${x.durationMs}ms` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {can('agents.sessions.manage') ? (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      async () => {
                        await sendSessionMessage(activeSession, message);
                        setMessage('');
                        await openSession(activeSession);
                      },
                      'Message sent.',
                      'send the message',
                    );
                  }}
                >
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Send a message to the agent"
                    aria-label="Message to the agent"
                    className="sm:flex-1"
                  />
                  <Button type="submit" variant="secondary">
                    Send
                  </Button>
                </form>
              ) : null}
            </Group>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
