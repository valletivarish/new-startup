'use client';

/**
 * Knowledge section — the minimum needed to operate the layer.
 *
 * Failures are explained in business language: a user who uploads a PDF
 * should be told the format is not supported and what to do, not shown a
 * MIME type and a stack trace.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  createKnowledgeSource,
  deleteKnowledgeDocument,
  deleteKnowledgeSource,
  listKnowledgeDocuments,
  listKnowledgeSources,
  me,
  reindexKnowledgeDocument,
  searchKnowledge,
  uploadKnowledgeDocument,
  type KnowledgeDocument,
  type KnowledgeSource,
  type Me,
  type RetrievedChunk,
} from '../../lib/api';

const shell: React.CSSProperties = { maxWidth: 900, margin: '0 auto', padding: 24 };
const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};

/** Processing state, in words a non-technical user can act on. */
const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting to be indexed',
  processing: 'Indexing…',
  ready: 'Ready to use',
  failed: 'Could not be indexed',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#8a6108',
  processing: '#8a6108',
  ready: '#0d6e63',
  failed: '#a63a24',
};

/** Retrieval outcomes, explained rather than named. */
const OUTCOME_LABEL: Record<string, string> = {
  ok: 'Found relevant knowledge',
  no_knowledge: 'Nothing indexed matches this yet',
  below_threshold: 'Nothing was close enough to be useful',
  failed: 'Search is temporarily unavailable',
};

export default function KnowledgePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [uploadSource, setUploadSource] = useState('');
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedChunk[] | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const p = await me();
      setProfile(p);
      if (p.activeOrganization?.permissions.includes('knowledge.read')) {
        const [s, d] = await Promise.all([
          listKnowledgeSources(),
          listKnowledgeDocuments(),
        ]);
        setSources(s.sources);
        setDocuments(d.documents);
        if (!uploadSource && s.sources[0]) setUploadSource(s.sources[0].id);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else if (e instanceof ApiClientError && e.status === 403) {
        setNotice('You do not have access to knowledge in this organization.');
      } else setNotice('Could not load knowledge.');
    }
  }, [router, uploadSource]);

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
      // ApiClientError messages are already business language by design.
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  async function onCreateSource(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await createKnowledgeSource(sourceName);
      setSourceName('');
    }, 'Knowledge source created.');
  }

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const contentType = docName.toLowerCase().endsWith('.md')
        ? 'text/markdown'
        : 'text/plain';
      const res = await uploadKnowledgeDocument({
        sourceId: uploadSource,
        name: docName,
        contentType,
        content: docContent,
      });
      setDocName('');
      setDocContent('');
      if (res.deduplicated) {
        throw new ApiClientError(200, {
          code: 'ok',
          message: 'That exact document was already added — nothing to re-index.',
        });
      }
    }, 'Document added and indexed.');
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    try {
      const res = await searchKnowledge(query, 5);
      setOutcome(res.outcome);
      setResults(res.chunks);
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Search failed.');
    }
  }

  if (!profile) return <main style={shell}>Loading…</main>;

  return (
    <main style={shell}>
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
        <strong>Knowledge</strong>
        <Link href="/dashboard" style={{ fontSize: 14, color: '#0d6e63' }}>
          Back to dashboard
        </Link>
      </header>

      {notice && <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>{notice}</p>}

      {can('knowledge.create') && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Create a knowledge source</h2>
          <p style={{ fontSize: 13, color: '#545c56' }}>
            A source groups related documents — a handbook, a set of FAQs, a
            policy library. Agents reference sources, so the same one can serve
            several agents.
          </p>
          <form onSubmit={onCreateSource} style={{ display: 'flex', gap: 8 }}>
            <input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="Source name"
              required
              minLength={2}
              style={{ flex: 1, padding: '8px 10px' }}
            />
            <button type="submit">Create</button>
          </form>
        </section>
      )}

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Sources</h2>
        {sources.length === 0 && (
          <p style={{ fontSize: 14, color: '#545c56' }}>No sources yet.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
          {sources.map((s) => (
            <li
              key={s.id}
              style={{
                borderTop: '1px solid #e4e7e0',
                padding: '10px 0',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>
                <strong>{s.name}</strong>
                <span style={{ color: '#545c56' }}> — {s.documentCount} document(s)</span>
              </span>
              {can('knowledge.delete') && (
                <button onClick={() => void run(() => deleteKnowledgeSource(s.id), 'Source removed.')}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {can('knowledge.create') && sources.length > 0 && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Add a document</h2>
          <p style={{ fontSize: 13, color: '#545c56' }}>
            Plain text and Markdown can be indexed today. Other formats are
            rejected rather than partially indexed.
          </p>
          <form onSubmit={onUpload} style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={uploadSource}
                onChange={(e) => setUploadSource(e.target.value)}
                aria-label="Knowledge source"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="handbook.md"
                required
                style={{ flex: 1, padding: '8px 10px' }}
              />
            </div>
            <textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="Paste the document text here"
              required
              rows={8}
              style={{ padding: 10, fontFamily: 'inherit' }}
            />
            <button type="submit" style={{ justifySelf: 'start' }}>
              Add document
            </button>
          </form>
        </section>
      )}

      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Documents</h2>
        {documents.length === 0 && (
          <p style={{ fontSize: 14, color: '#545c56' }}>No documents yet.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
          {documents.map((d) => (
            <li key={d.id} style={{ borderTop: '1px solid #e4e7e0', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>
                  <strong>{d.name}</strong>
                  <span style={{ display: 'block', fontSize: 13, color: STATUS_COLOR[d.status] ?? '#545c56' }}>
                    {STATUS_LABEL[d.status] ?? d.status}
                    {d.status === 'ready' && ` · ${d.chunkCount} section(s) · v${d.version}`}
                  </span>
                  {d.status === 'failed' && d.failureReason && (
                    <span style={{ display: 'block', fontSize: 13, color: '#a63a24' }}>
                      {d.failureReason}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                  {can('knowledge.reindex') && (
                    <button onClick={() => void run(() => reindexKnowledgeDocument(d.id), 'Re-indexing started.')}>
                      Re-index
                    </button>
                  )}
                  {can('knowledge.delete') && (
                    <button onClick={() => void run(() => deleteKnowledgeDocument(d.id), 'Document removed.')}>
                      Delete
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {can('knowledge.read') && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Test retrieval</h2>
          <p style={{ fontSize: 13, color: '#545c56' }}>
            Ask a question the way a candidate or customer would, and see what
            the agent would find.
          </p>
          <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What is the notice period?"
              required
              style={{ flex: 1, padding: '8px 10px' }}
            />
            <button type="submit">Search</button>
          </form>

          {outcome && (
            <p style={{ fontSize: 13, marginTop: 12, color: outcome === 'ok' ? '#0d6e63' : '#8a6108' }}>
              {OUTCOME_LABEL[outcome] ?? outcome}
            </p>
          )}
          {results && results.length > 0 && (
            <ol style={{ fontSize: 14, paddingLeft: 20 }}>
              {results.map((c) => (
                <li key={c.chunkId} style={{ marginBottom: 10 }}>
                  <strong>{c.documentName}</strong>
                  {c.section && <span style={{ color: '#545c56' }}> · {c.section}</span>}
                  <span style={{ color: '#545c56' }}> · {(c.similarity * 100).toFixed(0)}% match</span>
                  <div style={{ color: '#545c56' }}>{c.content.slice(0, 220)}…</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
