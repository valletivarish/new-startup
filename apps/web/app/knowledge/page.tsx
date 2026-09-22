'use client';

/**
 * Documents — upload hiring docs recruiters actually have (PDF, Word, PPT).
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Field,
  FileInput,
  Input,
  Select,
  Textarea,
} from '../../components/ui/input';
import {
  EmptyState,
  Notice,
  PageHeader,
  PageMain,
  Surface,
} from '../../components/ui/page';
import { SkeletonPage, SkeletonRows } from '../../components/ui/skeleton';
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
import { loginPathForReturn } from '../../lib/auth-redirect';
import {
  ACCEPT_DOCUMENT,
  fileToBase64,
  resolveUploadContentType,
} from '../../lib/upload';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting to be indexed',
  processing: 'Indexing…',
  ready: 'Ready to use',
  failed: 'Could not be indexed',
};

const OUTCOME_LABEL: Record<string, string> = {
  ok: 'Found matching documents',
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
  const [docFile, setDocFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [pasteName, setPasteName] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedChunk[] | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'err'>('ok');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

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
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
      } else if (e instanceof ApiClientError && e.status === 403) {
        setNoticeKind('err');
        setNotice('You do not have access to documents for this company.');
      } else {
        setNoticeKind('err');
        setNotice('Could not load documents.');
      }
    } finally {
      setLoading(false);
    }
  }, [router, uploadSource]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const busy = documents.some(
      (d) => d.status === 'pending' || d.status === 'processing',
    );
    if (!busy) return;
    const id = window.setInterval(() => {
      void reload();
    }, 2500);
    return () => window.clearInterval(id);
  }, [documents, reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setNoticeKind('ok');
      setNotice(ok);
      await reload();
    } catch (e) {
      setNoticeKind('err');
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  async function onCreateSource(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await createKnowledgeSource(sourceName);
      setSourceName('');
    }, 'Document set created.');
  }

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    try {
      let sourceId = uploadSource || sources[0]?.id;
      if (!sourceId) {
        const created = await createKnowledgeSource('Company documents');
        sourceId = created.id;
        setUploadSource(created.id);
      }
      if (mode === 'file') {
        if (!docFile) {
          setNoticeKind('err');
          setNotice('Choose a PDF, Word, PowerPoint, or text file.');
          return;
        }
        const contentType = resolveUploadContentType(docFile);
        const content = await fileToBase64(docFile);
        const res = await uploadKnowledgeDocument({
          sourceId,
          name: docFile.name,
          contentType,
          content,
          contentEncoding: 'base64',
        });
        setDocFile(null);
        setFileInputKey((k) => k + 1);
        setNoticeKind('ok');
        setNotice(
          res.deduplicated
            ? 'That exact document was already added.'
            : 'Document added and indexing.',
        );
      } else {
        const name = pasteName.trim() || 'notes.txt';
        const contentType = name.toLowerCase().endsWith('.md')
          ? 'text/markdown'
          : 'text/plain';
        const res = await uploadKnowledgeDocument({
          sourceId,
          name,
          contentType,
          content: pasteContent,
          contentEncoding: 'utf8',
        });
        setPasteName('');
        setPasteContent('');
        setNoticeKind('ok');
        setNotice(
          res.deduplicated
            ? 'That exact document was already added.'
            : 'Document added and indexing.',
        );
      }
      await reload();
    } catch (e) {
      setNoticeKind('err');
      setNotice(e instanceof ApiClientError ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    try {
      const res = await searchKnowledge(query, 5);
      setOutcome(res.outcome);
      setResults(res.chunks);
    } catch (e) {
      setNoticeKind('err');
      setNotice(e instanceof ApiClientError ? e.message : 'Search failed.');
    }
  }

  if (!profile) {
    return (
      <AppShell profile={null}>
        <PageMain>
          {loading ? <SkeletonPage withAction={false} /> : null}
          {notice ? <Notice kind={noticeKind}>{notice}</Notice> : null}
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Documents"
          description="Job descriptions, policies, and FAQs your hiring voice can use on calls."
        />

        {notice ? <Notice kind={noticeKind}>{notice}</Notice> : null}

        {/* Empty library: lead with upload. Populated: library first. */}
        {documents.length > 0 || loading ? (
          <section className="space-y-3">
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              Library
            </h2>
            {loading ? (
              <SkeletonRows rows={3} />
            ) : (
              <Surface className="overflow-hidden p-0">
                <ul className="m-0 list-none divide-y divide-[var(--separator-subtle)] p-0">
                  {documents.map((d) => (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 transition-colors duration-fast hover:bg-[var(--surface-secondary)]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="m-0 text-sm font-semibold">{d.name}</p>
                          <Badge tone={statusTone(d.status)}>
                            {STATUS_LABEL[d.status] ?? d.status}
                          </Badge>
                        </div>
                        {d.status === 'ready' ? (
                          <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                            Ready for screens to use
                          </p>
                        ) : null}
                        {d.status === 'failed' && d.failureReason ? (
                          <p className="mt-1 mb-0 text-sm text-[var(--danger)]">
                            {d.failureReason}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {can('knowledge.create') && d.status === 'failed' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(
                                () => reindexKnowledgeDocument(d.id),
                                'Re-indexing started.',
                              )
                            }
                          >
                            Retry
                          </Button>
                        ) : null}
                        {can('knowledge.delete') ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void run(
                                () => deleteKnowledgeDocument(d.id),
                                'Document removed.',
                              )
                            }
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Surface>
            )}
          </section>
        ) : !can('knowledge.create') ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" aria-hidden />}
            title="No documents yet"
            description="Ask an admin to upload a JD pack or FAQ so screens can cite company facts."
          />
        ) : null}

        {can('knowledge.create') ? (
          <Surface className="space-y-4">
            <div>
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                {documents.length === 0 ? 'Add your first document' : 'Add a document'}
              </h2>
              <p className="mt-1 mb-0 max-w-prose text-sm leading-relaxed text-[var(--foreground-tertiary)]">
                PDF, Word, PowerPoint, or plain text — up to 10 MB. Prefer a
                text-based PDF (not a scan). First upload creates a Company
                documents set.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="How to add"
              className="inline-flex rounded-md border border-[var(--separator)] bg-[var(--surface-secondary)] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'file'}
                className={
                  mode === 'file'
                    ? 'rounded-[5px] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm'
                    : 'rounded-[5px] px-3 py-1.5 text-xs font-medium text-[var(--foreground-tertiary)] hover:text-[var(--foreground-secondary)]'
                }
                onClick={() => setMode('file')}
              >
                Upload file
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'paste'}
                className={
                  mode === 'paste'
                    ? 'rounded-[5px] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm'
                    : 'rounded-[5px] px-3 py-1.5 text-xs font-medium text-[var(--foreground-tertiary)] hover:text-[var(--foreground-secondary)]'
                }
                onClick={() => setMode('paste')}
              >
                Paste text
              </button>
            </div>
            <form onSubmit={onUpload} className="grid max-w-xl gap-3">
              {sources.length > 1 ? (
                <Field label="Document set">
                  <Select
                    value={uploadSource}
                    onChange={(e) => setUploadSource(e.target.value)}
                  >
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {mode === 'file' ? (
                <Field label="File" compound>
                  <FileInput
                    key={fileInputKey}
                    accept={ACCEPT_DOCUMENT}
                    required
                    variant="dropzone"
                    onFileChange={setDocFile}
                    emptyLabel="Drop a PDF, Word, or text file here"
                  />
                </Field>
              ) : (
                <>
                  <Field label="File name">
                    <Input
                      value={pasteName}
                      onChange={(e) => setPasteName(e.target.value)}
                      placeholder="notes.txt"
                    />
                  </Field>
                  <Field label="Document text">
                    <Textarea
                      value={pasteContent}
                      onChange={(e) => setPasteContent(e.target.value)}
                      placeholder="Paste the document text here"
                      required
                      rows={8}
                    />
                  </Field>
                </>
              )}
              <div>
                <Button type="submit" disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Add document'}
                </Button>
              </div>
            </form>
          </Surface>
        ) : null}

        {can('knowledge.create') ? (
          <details className="group rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)]">
            <summary className="cursor-pointer list-none px-5 py-4 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
              Optional: name a document set
            </summary>
            <div className="space-y-3 border-t border-[var(--separator-subtle)] px-5 py-4">
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                Only if you want separate groups (for example “Engineering JD
                pack”).
              </p>
              <form
                onSubmit={onCreateSource}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <Field label="Set name" className="sm:flex-1">
                  <Input
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="Name (e.g. Backend role docs)"
                    required
                    minLength={2}
                  />
                </Field>
                <Button type="submit">Create set</Button>
              </form>
              {sources.length > 0 ? (
                <ul className="m-0 list-none divide-y divide-[var(--separator-subtle)] p-0">
                  {sources.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 py-3 text-sm"
                    >
                      <span className="min-w-0">
                        <strong className="font-semibold">{s.name}</strong>
                        <span className="text-[var(--foreground-tertiary)]">
                          {' '}
                          ({s.documentCount} file
                          {s.documentCount === 1 ? '' : 's'})
                        </span>
                        {s.documentCount === 0 ? (
                          <span className="mt-0.5 block text-[12px] text-[var(--foreground-muted)]">
                            Empty — add a file above
                          </span>
                        ) : null}
                      </span>
                      {can('knowledge.delete') ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void run(
                              () => deleteKnowledgeSource(s.id),
                              'Document set removed.',
                            )
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}

        {can('knowledge.read') ? (
          <details className="group rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface)]">
            <summary className="cursor-pointer list-none px-5 py-4 font-display text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
              Check what screens can find
            </summary>
            <div className="space-y-3 border-t border-[var(--separator-subtle)] px-5 py-4">
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                Optional — search your uploaded docs the same way a screen would.
              </p>
              <form
                onSubmit={onSearch}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. notice period, remote work, benefits"
                  required
                  className="sm:flex-1"
                />
                <Button type="submit">Search</Button>
              </form>
              {outcome ? (
                <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                  {OUTCOME_LABEL[outcome] ?? outcome}
                </p>
              ) : null}
              {results && results.length > 0 ? (
                <ul className="m-0 list-none divide-y divide-[var(--separator-subtle)] p-0">
                  {results.map((c, i) => (
                    <li key={`${c.documentId}-${i}`} className="py-3">
                      <p className="m-0 text-[12px] font-medium text-[var(--foreground-muted)]">
                        {[c.documentName?.trim(), c.section?.trim()]
                          .filter(Boolean)
                          .join(' · ') || `Passage ${i + 1}`}
                      </p>
                      <p className="mt-1 mb-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground-secondary)]">
                        {c.content}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
      </PageMain>
    </AppShell>
  );
}
