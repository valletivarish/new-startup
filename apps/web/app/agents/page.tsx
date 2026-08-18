'use client';

/**
 * Agents list and creation. Permission-gated for usability only — the API
 * enforces every decision server-side.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  createAgent,
  listAgents,
  me,
  type Agent,
  type Me,
} from '../../lib/api';

const shell: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: 24 };
const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};

const STATUS_COLOR: Record<string, string> = {
  draft: '#8a6108',
  published: '#0d6e63',
  paused: '#545c56',
  archived: '#a63a24',
};

export default function AgentsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([me(), listAgents()]);
      setProfile(p);
      setAgents(a.agents);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else if (e instanceof ApiClientError && e.status === 403) setNotice(e.message);
      else setNotice('Could not load agents.');
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    try {
      await createAgent({ name, purpose });
      setName('');
      setPurpose('');
      setNotice('Agent created as a draft.');
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Could not create the agent.');
    }
  }

  return (
    <main style={shell}>
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
        <strong>Agents</strong>
        <Link href="/dashboard" style={{ fontSize: 14, color: '#0d6e63' }}>
          Back to dashboard
        </Link>
      </header>

      {notice && <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>{notice}</p>}

      {can('agents.create') && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Create an agent</h2>
          <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              required
              minLength={2}
              style={{ flex: '1 1 200px', padding: '8px 10px' }}
            />
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="What should this agent do?"
              required
              style={{ flex: '2 1 300px', padding: '8px 10px' }}
            />
            <button type="submit">Create</button>
          </form>
        </section>
      )}

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Your agents</h2>
        {agents.length === 0 && (
          <p style={{ fontSize: 14, color: '#545c56' }}>No agents yet.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {agents.map((a) => (
            <li
              key={a.id}
              style={{
                borderTop: '1px solid #e4e7e0',
                padding: '12px 0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span>
                <Link href={`/agents/${a.id}`} style={{ fontWeight: 600, color: '#1a1f1c' }}>
                  {a.name}
                </Link>
                <span style={{ display: 'block', fontSize: 13, color: '#545c56' }}>
                  {a.purpose}
                </span>
              </span>
              <span style={{ fontSize: 13, color: STATUS_COLOR[a.status] ?? '#545c56' }}>
                {a.status}
                {a.currentVersion !== null && ` · v${a.currentVersion}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
