'use client';

/**
 * Agent detail: versions, draft editing, lifecycle actions, and a session
 * inspector that exercises the runtime end to end.
 *
 * Voice, persona, and transfer settings live here. Job description and
 * must-ask questions are set on each job.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '../../../components/AppShell';
import { Notice, PageHeader, PageMain, Surface } from '../../../components/ui/page';
import { Button } from '../../../components/ui/button';
import { Field, Input, Select, Textarea } from '../../../components/ui/input';
import { SkeletonCard } from '../../../components/ui/skeleton';
import { Badge, statusTone } from '../../../components/ui/badge';
import { AGENT_STATUS_LABEL } from '../../../lib/status-labels';
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
} from '../../../lib/api';
import { VoiceTestPanel } from '../../../src/integrations/elevenlabs/VoiceTestPanel';
import { loginPathForReturn } from '../../../lib/auth-redirect';
import { fromPublicId } from '../../../lib/public-id';

const INTELLIGENCE_TIERS = ['standard', 'advanced', 'premium'] as const;

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
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const agentId = fromPublicId(params.id) ?? params.id;

  const [profile, setProfile] = useState<Me | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [draftText, setDraftText] = useState('');
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<Tool[]>([]);
  const [agentTools, setAgentTools] = useState<Tool[]>([]);
  const [executions, setExecutions] = useState<ToolExecution[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [transferEdit, setTransferEdit] = useState('');
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

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
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push(loginPathForReturn());
      else setNotice(e instanceof ApiClientError ? e.message : 'Could not load the hiring voice.');
    }
  }, [agentId, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const draft = versions.find((v) => v.status === 'draft');
  const published = versions.find((v) => v.status === 'published');
  const isHiring = agent?.type === 'hiring';
  const configForSummary = published?.configuration ?? draft?.configuration;
  const transferPhones = transferPhonesFromConfig(configForSummary);
  const showBuilderChrome = can('agents.update') && !isHiring;

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setNotice(ok);
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  async function saveTransferPhones() {
    if (!can('agents.update')) return;
    setSavingTransfer(true);
    setNotice(null);
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
        setNotice('Transfer numbers saved and published.');
      } else {
        setNotice('Transfer numbers saved. Publish the voice when ready.');
      }
      await reload();
    } catch (e) {
      setNotice(
        e instanceof ApiClientError ? e.message : 'Could not save transfer numbers.',
      );
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

  if (!agent) {
    return (
      <AppShell profile={profile}>
        <PageMain>
          <SkeletonCard />
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
    <PageMain className="space-y-4 pb-10">
      <PageHeader
        title={agent.name}
        description={agent.purpose || 'Phone screens for open roles'}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/agents">All hiring voices</Link>
          </Button>
        }
      />

      {notice ? <Notice kind="ok">{notice}</Notice> : null}

      <Surface className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--foreground-tertiary)]">Status</span>
          <Badge tone={statusTone(agent.status)}>
            {AGENT_STATUS_LABEL[agent.status] ?? agent.status}
          </Badge>
          {agent.currentVersion !== null ? (
            <span className="text-[var(--foreground-muted)]">
              {isHiring
                ? 'Ready for phone screens'
                : `Published version ${agent.currentVersion}`}
            </span>
          ) : null}
        </div>
        {agent.status !== 'published' && (
          <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
            Publish before you try a browser demo or place a phone screen.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {can('agents.deploy') && agent.status !== 'published' && (
            <Button
              type="button"
              onClick={() =>
                void run(async () => {
                  const draftVer = versions.find((v) => v.status === 'draft');
                  if (draftVer) {
                    await publishVersion(agentId, draftVer.id);
                    return;
                  }
                  await agentAction(agentId, 'publish');
                }, 'Hiring voice published.')
              }
            >
              Publish
            </Button>
          )}
          {can('agents.pause') && agent.status === 'published' && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void run(() => agentAction(agentId, 'pause'), 'Hiring voice paused.')
              }
            >
              Pause
            </Button>
          )}
          {can('agents.archive') && agent.status !== 'archived' && !confirmingArchive && (
            <Button type="button" variant="outline" onClick={() => setConfirmingArchive(true)}>
              Archive
            </Button>
          )}
        </div>
        {can('agents.archive') && agent.status !== 'archived' && confirmingArchive && (
          <div
            role="alertdialog"
            aria-labelledby="archive-confirm-title"
            aria-describedby="archive-confirm-desc"
            className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,var(--separator))] bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface))] p-3.5"
          >
            <p
              id="archive-confirm-title"
              className="m-0 mb-1.5 text-sm font-semibold text-[var(--danger)]"
            >
              Archive this hiring voice? This cannot be undone.
            </p>
            <p
              id="archive-confirm-desc"
              className="mb-3 mt-0 text-[13px] text-[var(--foreground-tertiary)]"
            >
              After archive, it stays in history only. You cannot publish it,
              change it, or use it for new phone screens. Attach a different
              published hiring voice on each job if you still need to call.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={() =>
                  void run(async () => {
                    await agentAction(agentId, 'archive');
                    setConfirmingArchive(false);
                  }, 'Hiring voice archived.')
                }
              >
                Yes, archive
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmingArchive(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Surface>

      {isHiring && (
        <Surface className="space-y-3">
          <h2 className="m-0 font-display text-base font-semibold tracking-tight">Hiring voice</h2>
          <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
            This is the voice that runs phone screens. Transfer numbers hand a
            call to your team when someone asks for a person. Role details and
            screening questions live on each job.
          </p>
          <p className="m-0 text-sm">
            <Link
              href="/jobs"
              className="font-semibold text-[var(--accent)] no-underline hover:underline"
            >
              Go to jobs
            </Link>
            <span className="text-[var(--foreground-muted)]">
              {' '}
              to attach this hiring voice to a role
            </span>
          </p>
          {can('agents.update') ? (
            <div className="grid gap-3">
              <Field
                label="Transfer numbers"
                hint="One +91 mobile per line for human handoff."
              >
                <Textarea
                  value={transferEdit}
                  onChange={(e) => setTransferEdit(e.target.value)}
                  rows={3}
                />
              </Field>
              <Button
                type="button"
                className="justify-self-start"
                disabled={savingTransfer}
                onClick={() => void saveTransferPhones()}
              >
                {savingTransfer ? 'Saving…' : 'Save transfer numbers'}
              </Button>
              {!published && (
                <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                  Publish the hiring voice before screening.
                </p>
              )}
            </div>
          ) : (
            <p className="m-0 text-sm">
              <strong>Transfer numbers</strong>
              {transferPhones.length === 0 ? (
                <span className="text-[var(--foreground-tertiary)]"> — none</span>
              ) : (
                <span>: {transferPhones.join(', ')}</span>
              )}
            </p>
          )}
        </Surface>
      )}

      {can('agents.test') || can('calls.initiate') ? (
        <VoiceTestPanel
          agentId={agentId}
          canTest={can('agents.test') || can('calls.initiate')}
          agentPublished={agent.status === 'published'}
          title={isHiring ? 'Try the hiring voice in your browser' : undefined}
        />
      ) : null}

      {showBuilderChrome && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide advanced settings' : 'Show advanced settings'}
          </Button>

          {showAdvanced && (
            <div className="space-y-4">
              <details open className="group rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface)]">
                <summary className="cursor-pointer list-none px-4 py-3 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
                  Saved setups
                  <span className="ml-2 text-[12px] font-medium text-[var(--foreground-muted)] group-open:hidden">
                    show
                  </span>
                </summary>
                <div className="space-y-3 border-t border-[var(--separator-subtle)] px-4 pb-4 pt-3">
                  <ul className="m-0 list-none space-y-0 p-0 text-sm">
                    {versions.map((v) => (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-center gap-2 border-t border-[var(--separator-subtle)] py-2 first:border-t-0"
                      >
                        <span>
                          Setup {v.version} ·{' '}
                          {v.status === 'published'
                            ? 'Live'
                            : v.status === 'draft'
                              ? 'Unpublished'
                              : v.status}
                        </span>
                        {v.status === 'draft' && can('agents.deploy') && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(
                                () => publishVersion(agentId, v.id),
                                'This setup is now live.',
                              )
                            }
                          >
                            Make this live
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {can('agents.update') && !draft && published && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void run(
                          () => createDraft(agentId, published.configuration),
                          'Started a new unpublished setup from the live one.',
                        )
                      }
                    >
                      Start a new setup
                    </Button>
                  )}
                </div>
              </details>

              <details className="rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface)]">
                <summary className="cursor-pointer list-none px-4 py-3 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
                  Intelligence
                </summary>
                <div className="space-y-3 border-t border-[var(--separator-subtle)] px-4 pb-4 pt-3">
                  <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                    A tier is a capability, not a model. Which model serves a tier is a
                    platform decision, so this setting survives changing providers.
                  </p>
                  <p className="m-0 text-sm">
                    Serving:{' '}
                    <strong>
                      {published ? tierOf(published.configuration) : 'not published'}
                    </strong>
                  </p>
                  {draft && can('agents.update') && (
                    <Field
                      label="Unpublished setup · intelligence"
                      className="max-w-xs"
                    >
                      <Select
                        value={tierOf(draft.configuration)}
                        onChange={(e) =>
                          void run(async () => {
                            const next = {
                              ...draft.configuration,
                              capabilities: {
                                ...((draft.configuration['capabilities'] as Record<
                                  string,
                                  unknown
                                >) ?? {}),
                                intelligenceTier: e.target.value,
                              },
                            };
                            await updateDraft(agentId, draft.id, next);
                            setDraftText(JSON.stringify(next, null, 2));
                          }, 'Intelligence updated. Publish to use on calls.')
                        }
                      >
                        {INTELLIGENCE_TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              </details>

              <details className="rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface)]">
                <summary className="cursor-pointer list-none px-4 py-3 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
                  Integrations
                </summary>
                <div className="space-y-3 border-t border-[var(--separator-subtle)] px-4 pb-4 pt-3">
                  <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                    Optional company integrations this hiring voice may request
                    during a screen. Most hiring teams leave this closed.
                  </p>
                  {catalogue.length === 0 ? (
                    <p className="m-0 text-sm text-[var(--foreground-secondary)]">
                      No integrations are available for this company yet. Phone
                      screens work without them.
                    </p>
                  ) : (
                    <ul className="m-0 list-none p-0 text-sm">
                      {catalogue.map((tool) => {
                        const isGranted = agentTools.some((t) => t.id === tool.id);
                        return (
                          <li
                            key={tool.id}
                            className="flex justify-between gap-3 border-t border-[var(--separator-subtle)] py-2 first:border-t-0"
                          >
                            <span>
                              {tool.name}
                              <span className="text-[12.5px] text-[var(--foreground-tertiary)]">
                                {' '}
                                · needs {tool.requiredPermission}
                                {!tool.enabled && ' · disabled for this company'}
                              </span>
                            </span>
                            {can('agents.update') && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void run(
                                    () =>
                                      isGranted
                                        ? revokeAgentTool(agentId, tool.id)
                                        : grantAgentTool(agentId, tool.id),
                                    isGranted
                                      ? `${tool.name} revoked from this hiring voice.`
                                      : `${tool.name} granted to this hiring voice.`,
                                  )
                                }
                              >
                                {isGranted ? 'Revoke' : 'Grant'}
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </details>

              {draft && can('agents.update') && (
                <details className="rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface)]">
                  <summary className="cursor-pointer list-none px-4 py-3 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
                    Advanced setup
                  </summary>
                  <div className="space-y-3 border-t border-[var(--separator-subtle)] px-4 pb-4 pt-3">
                    <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                      For technical admins. Most hiring teams never open this —
                      job questions and documents are set on each role instead.
                      Changes stay in draft until you publish.
                    </p>
                    <p className="m-0 text-[12px] text-[var(--foreground-muted)]">
                      Unpublished setup
                    </p>
                    <Textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={14}
                      className="min-h-[16rem] font-mono text-[12.5px]"
                      aria-label="Advanced hiring voice setup"
                    />
                    <Button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          let parsed: unknown;
                          try {
                            parsed = JSON.parse(draftText);
                          } catch {
                            throw new ApiClientError(422, {
                              code: 'validation_failed',
                              message:
                                'That setup text could not be read. Ask a technical admin to check it.',
                            });
                          }
                          return updateDraft(agentId, draft.id, parsed);
                        }, 'Setup saved.')
                      }
                    >
                      Save setup
                    </Button>
                  </div>
                </details>
              )}

              {can('agents.sessions.read') && (
                <details className="rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface)]">
                  <summary className="cursor-pointer list-none px-4 py-3 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
                    Sessions
                  </summary>
                  <div className="space-y-3 border-t border-[var(--separator-subtle)] px-4 pb-4 pt-3">
                    {can('agents.sessions.manage') && agent.status === 'published' && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          void run(async () => {
                            const s = await createSession(agentId);
                            await openSession(s.id);
                          }, 'Session started.')
                        }
                      >
                        Start a test session
                      </Button>
                    )}
                    <ul className="m-0 list-none p-0 text-sm">
                      {sessions.map((s) => (
                        <li
                          key={s.id}
                          className="border-t border-[var(--separator-subtle)] py-2 first:border-t-0"
                        >
                          <button
                            type="button"
                            className="border-0 bg-transparent p-0 text-[var(--accent)] underline-offset-2 hover:underline"
                            onClick={() => void openSession(s.id)}
                          >
                            {s.id.slice(0, 8)}
                          </button>
                          {' — '}setup {s.agentVersion} · {s.status}
                          {s.endedReason && ` (${s.endedReason})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              )}

              {activeSession && (
                <details open className="rounded-xl border border-[var(--separator-subtle)] bg-[var(--surface)]">
                  <summary className="cursor-pointer list-none px-4 py-3 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
                    Call log
                  </summary>
                  <div className="space-y-3 border-t border-[var(--separator-subtle)] px-4 pb-4 pt-3">
                    <ol className="m-0 space-y-1 pl-5 font-mono text-[12.5px]">
                      {events.map((e) => {
                        const citations = Array.isArray(e.payload?.['citations'])
                          ? (e.payload['citations'] as { documentName: string }[])
                          : [];
                        const tone =
                          e.type === 'ErrorOccurred' || e.type === 'ToolFailed'
                            ? 'text-[var(--danger)]'
                            : e.direction === 'inbound'
                              ? 'text-[var(--warning)]'
                              : 'text-[var(--success)]';
                        return (
                          <li key={e.id}>
                            <span className={tone}>
                              {e.sequence}. {e.type}
                            </span>
                            {typeof e.payload?.['content'] === 'string' && (
                              <span className="text-[var(--foreground-tertiary)]">
                                {' '}
                                — {String(e.payload['content'])}
                              </span>
                            )}
                            {typeof e.payload?.['message'] === 'string' && (
                              <span className="text-[var(--foreground-tertiary)]">
                                {' '}
                                — {String(e.payload['message'])}
                              </span>
                            )}
                            {typeof e.payload?.['toolName'] === 'string' && (
                              <span className="text-[var(--foreground-tertiary)]">
                                {' '}
                                — {String(e.payload['toolName'])}
                              </span>
                            )}
                            {citations.length > 0 && (
                              <span className="text-[var(--foreground-tertiary)]">
                                {' '}
                                · grounded in{' '}
                                {citations.map((c) => c.documentName).join(', ')}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ol>

                    {executions.length > 0 && (
                      <>
                        <h3 className="m-0 text-sm font-semibold">Tool calls</h3>
                        <ul className="m-0 mb-3.5 list-none p-0 font-mono text-[12.5px]">
                          {executions.map((x) => (
                            <li key={x.id} className="py-0.5">
                              <span
                                className={
                                  x.status === 'completed'
                                    ? 'text-[var(--success)]'
                                    : 'text-[var(--danger)]'
                                }
                              >
                                {x.toolName} — {x.status}
                              </span>
                              {x.denialReason && ` (${x.denialReason})`}
                              {x.durationMs !== null && ` · ${x.durationMs}ms`}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {can('agents.sessions.manage') && (
                      <div className="flex gap-2">
                        <Input
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder="Send a message to the hiring voice"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          onClick={() =>
                            void run(async () => {
                              await sendSessionMessage(activeSession, message);
                              setMessage('');
                              await openSession(activeSession);
                            }, 'Message processed.')
                          }
                        >
                          Send
                        </Button>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}

        </>
      )}
    </PageMain>
    </AppShell>
  );
}
