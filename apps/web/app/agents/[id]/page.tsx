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
  listSessionEvents,
  listSessions,
  listVersions,
  me,
  publishVersion,
  sendSessionMessage,
  updateDraft,
  type Agent,
  type AgentSession,
  type AgentVersion,
  type Me,
  type SessionEvent,
} from '../../../lib/api';

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

      {activeSession && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Event stream</h2>
          <ol style={{ ...mono, paddingLeft: 20 }}>
            {events.map((e) => (
              <li key={e.id} style={{ marginBottom: 4 }}>
                <span style={{ color: e.direction === 'inbound' ? '#8a6108' : '#0d6e63' }}>
                  {e.sequence}. {e.type}
                </span>
                {typeof e.payload?.['content'] === 'string' && (
                  <span style={{ color: '#545c56' }}> — {String(e.payload['content'])}</span>
                )}
              </li>
            ))}
          </ol>
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
                    setEvents((await listSessionEvents(activeSession)).events);
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
