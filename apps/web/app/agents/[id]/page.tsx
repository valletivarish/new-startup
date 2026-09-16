'use client';

/**
 * Agent detail: versions, draft editing, lifecycle actions, and a session
 * inspector that exercises the runtime end to end.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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

const shell: React.CSSProperties = { maxWidth: 900, margin: '0 auto', padding: 24 };
const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
};

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const agentId = params.id;

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
      if (draft) setDraftText(JSON.stringify(draft.configuration, null, 2));
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
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else setNotice(e instanceof ApiClientError ? e.message : 'Could not load the agent.');
    }
  }, [agentId, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const draft = versions.find((v) => v.status === 'draft');
  const published = versions.find((v) => v.status === 'published');

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setNotice(ok);
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  async function openSession(id: string) {
    setActiveSession(id);
    setEvents((await listSessionEvents(id)).events);
    if (can('agents.sessions.read')) {
      setExecutions((await listToolExecutions(id)).executions);
    }
  }

  if (!agent) return <main style={shell}>Loading…</main>;

  return (
    <main style={shell}>
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
        <strong>{agent.name}</strong>
        <Link href="/agents" style={{ fontSize: 14, color: '#0d6e63' }}>
          All agents
        </Link>
      </header>

      {notice && <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>{notice}</p>}

      <section style={panel}>
        <p style={{ margin: 0, fontSize: 14, color: '#545c56' }}>{agent.purpose}</p>
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          Status: <strong>{agent.status}</strong>
          {agent.currentVersion !== null && ` · serving v${agent.currentVersion}`}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('agents.deploy') && agent.status !== 'published' && (
            <button onClick={() => void run(() => agentAction(agentId, 'publish'), 'Agent published.')}>
              Publish agent
            </button>
          )}
          {can('agents.pause') && agent.status === 'published' && (
            <button onClick={() => void run(() => agentAction(agentId, 'pause'), 'Agent paused.')}>
              Pause
            </button>
          )}
          {can('agents.archive') && agent.status !== 'archived' && (
            <button onClick={() => void run(() => agentAction(agentId, 'archive'), 'Agent archived.')}>
              Archive
            </button>
          )}
        </div>
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Versions</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
          {versions.map((v) => (
            <li key={v.id} style={{ borderTop: '1px solid #e4e7e0', padding: '8px 0' }}>
              v{v.version} — {v.status}
              {v.status === 'draft' && can('agents.deploy') && (
                <button
                  style={{ marginLeft: 12 }}
                  onClick={() => void run(() => publishVersion(agentId, v.id), `v${v.version} published.`)}
                >
                  Publish this version
                </button>
              )}
            </li>
          ))}
        </ul>
        {can('agents.update') && !draft && published && (
          <button
            style={{ marginTop: 12 }}
            onClick={() =>
              void run(
                () => createDraft(agentId, published.configuration),
                'New draft created from the published version.',
              )
            }
          >
            Create a new draft
          </button>
        )}
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Intelligence</h2>
        <p style={{ fontSize: 13, color: '#545c56', marginTop: 0 }}>
          A tier is a capability, not a model. Which model serves a tier is a
          platform decision, so this setting survives changing providers.
        </p>
        <p style={{ fontSize: 13.5 }}>
          Serving:{' '}
          <strong>{published ? tierOf(published.configuration) : 'not published'}</strong>
        </p>
        {draft && can('agents.update') && (
          <label style={{ fontSize: 13.5 }}>
            Draft v{draft.version} tier{' '}
            <select
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
                }, 'Intelligence tier updated on the draft.')
              }
            >
              {INTELLIGENCE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Tools</h2>
        <p style={{ fontSize: 13, color: '#545c56', marginTop: 0 }}>
          Granting a tool lets this agent <em>ask</em> for it. Whether it runs is
          decided per call against the permissions of the person the agent is
          acting for.
        </p>
        {catalogue.length === 0 ? (
          <p style={{ fontSize: 13.5 }}>
            No tools in the catalogue yet — <Link href="/tools">install them</Link>.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
            {catalogue.map((tool) => {
              const isGranted = agentTools.some((t) => t.id === tool.id);
              return (
                <li
                  key={tool.id}
                  style={{
                    borderTop: '1px solid #e4e7e0',
                    padding: '8px 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span>
                    {tool.name}
                    <span style={{ color: '#545c56', fontSize: 12.5 }}>
                      {' '}
                      · needs {tool.requiredPermission}
                      {!tool.enabled && ' · disabled organization-wide'}
                    </span>
                  </span>
                  {can('agents.update') && (
                    <button
                      onClick={() =>
                        void run(
                          () =>
                            isGranted
                              ? revokeAgentTool(agentId, tool.id)
                              : grantAgentTool(agentId, tool.id),
                          isGranted
                            ? `${tool.name} revoked from this agent.`
                            : `${tool.name} granted to this agent.`,
                        )
                      }
                    >
                      {isGranted ? 'Revoke' : 'Grant'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {draft && can('agents.update') && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Draft v{draft.version}</h2>
          <p style={{ fontSize: 13, color: '#545c56' }}>
            Published versions are immutable. Edits apply to this draft until you publish it.
          </p>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={14}
            style={{ ...mono, width: '100%', boxSizing: 'border-box', padding: 10 }}
          />
          <button
            onClick={() =>
              void run(async () => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(draftText);
                } catch {
                  throw new ApiClientError(422, {
                    code: 'validation_failed',
                    message: 'That is not valid JSON.',
                  });
                }
                return updateDraft(agentId, draft.id, parsed);
              }, 'Draft saved.')
            }
          >
            Save draft
          </button>
        </section>
      )}

      {can('agents.sessions.read') && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Sessions</h2>
          {can('agents.sessions.manage') && agent.status === 'published' && (
            <button
              onClick={() =>
                void run(async () => {
                  const s = await createSession(agentId);
                  await openSession(s.id);
                }, 'Session started.')
              }
            >
              Start a test session
            </button>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', fontSize: 13.5 }}>
            {sessions.map((s) => (
              <li key={s.id} style={{ borderTop: '1px solid #e4e7e0', padding: '8px 0' }}>
                <button
                  style={{ background: 'none', border: 'none', color: '#0d6e63', cursor: 'pointer', padding: 0 }}
                  onClick={() => void openSession(s.id)}
                >
                  {s.id.slice(0, 8)}
                </button>
                {' — '}v{s.agentVersion} · {s.status}
                {s.endedReason && ` (${s.endedReason})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* MVP-01: Voice test panel (ElevenLabs browser-voice) */}
      <VoiceTestPanel
        agentId={agentId}
        canTest={can('agents.test')}
        agentPublished={agent.status === 'published'}
      />

      {activeSession && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Event stream</h2>
          <ol style={{ ...mono, paddingLeft: 20 }}>
            {events.map((e) => {
              const citations = Array.isArray(e.payload?.['citations'])
                ? (e.payload['citations'] as { documentName: string }[])
                : [];
              return (
                <li key={e.id} style={{ marginBottom: 4 }}>
                  <span
                    style={{
                      color:
                        e.type === 'ErrorOccurred' || e.type === 'ToolFailed'
                          ? '#8a2020'
                          : e.direction === 'inbound'
                            ? '#8a6108'
                            : '#0d6e63',
                    }}
                  >
                    {e.sequence}. {e.type}
                  </span>
                  {typeof e.payload?.['content'] === 'string' && (
                    <span style={{ color: '#545c56' }}> — {String(e.payload['content'])}</span>
                  )}
                  {typeof e.payload?.['message'] === 'string' && (
                    <span style={{ color: '#545c56' }}> — {String(e.payload['message'])}</span>
                  )}
                  {typeof e.payload?.['toolName'] === 'string' && (
                    <span style={{ color: '#545c56' }}> — {String(e.payload['toolName'])}</span>
                  )}
                  {citations.length > 0 && (
                    <span style={{ color: '#545c56' }}>
                      {' '}
                      · grounded in {citations.map((c) => c.documentName).join(', ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {executions.length > 0 && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 6 }}>Tool calls</h3>
              <ul style={{ ...mono, listStyle: 'none', padding: 0, margin: '0 0 14px' }}>
                {executions.map((x) => (
                  <li key={x.id} style={{ padding: '3px 0' }}>
                    <span
                      style={{ color: x.status === 'completed' ? '#0d6e63' : '#8a2020' }}
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
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Send a message to the agent"
                style={{ flex: 1, padding: '8px 10px' }}
              />
              <button
                onClick={() =>
                  void run(async () => {
                    await sendSessionMessage(activeSession, message);
                    setMessage('');
                    await openSession(activeSession);
                  }, 'Message processed.')
                }
              >
                Send
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
