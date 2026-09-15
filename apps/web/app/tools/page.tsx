'use client';

/**
 * The organization's tool catalogue.
 *
 * Two things this page is careful about:
 *
 *   * `requiredPermission` is shown, because an operator debugging "why did
 *     the agent refuse?" needs to see it. It is never sent to the model —
 *     that asymmetry is the point.
 *   * Disabling a tool is presented as the immediate brake it is: the next
 *     call is refused regardless of what any agent or model believes.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  installBuiltInTools,
  listTools,
  me,
  setToolEnabled,
  type Me,
  type Tool,
} from '../../lib/api';

const shell: React.CSSProperties = { maxWidth: 900, margin: '0 auto', padding: 24 };
const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};

export default function ToolsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([me(), listTools()]);
      setProfile(p);
      setTools(t.tools);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else setNotice(e instanceof ApiClientError ? e.message : 'Could not load tools.');
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setNotice(ok);
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  return (
    <main style={shell}>
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
        <strong>Tools</strong>
        <Link href="/dashboard" style={{ fontSize: 14, color: '#0d6e63' }}>
          Dashboard
        </Link>
      </header>

      {notice && <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>{notice}</p>}

      <section style={panel}>
        <p style={{ marginTop: 0, fontSize: 14, color: '#545c56' }}>
          A tool is available to an agent only when it is enabled here, granted to
          that agent, and the person the agent is acting for holds the permission
          it requires. All three are checked on every call.
        </p>
        {can('agents.update') && (
          <button
            onClick={() =>
              void run(installBuiltInTools, 'Built-in tools installed.')
            }
          >
            {tools.length === 0 ? 'Install built-in tools' : 'Refresh built-in tools'}
          </button>
        )}
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Catalogue</h2>
        {tools.length === 0 && (
          <p style={{ fontSize: 13.5, color: '#545c56' }}>
            No tools installed yet.
          </p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
          {tools.map((tool) => (
            <li key={tool.id} style={{ borderTop: '1px solid #e4e7e0', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>{tool.name}</strong>
                  {!tool.enabled && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#8a2020' }}>
                      disabled
                    </span>
                  )}
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#545c56' }}>
                    {tool.description}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#545c56' }}>
                    Requires <code>{tool.requiredPermission}</code>
                  </p>
                </div>
                {can('agents.update') && (
                  <button
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() =>
                      void run(
                        () => setToolEnabled(tool.id, !tool.enabled),
                        tool.enabled
                          ? `${tool.name} disabled. The next call will be refused.`
                          : `${tool.name} enabled.`,
                      )
                    }
                  >
                    {tool.enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
