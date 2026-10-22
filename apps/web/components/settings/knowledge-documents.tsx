'use client';

/**
 * Knowledge (D2): the company facts the agent can answer from on every call. The documents
 * with their state in words, adding one (a file or pasted text), a search that finds what a
 * call would, then what belongs here or on a job, and the optional document sets.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  CircleQuestionMark,
  Clock,
  FileText,
  Hourglass,
  Lock,
  Plus,
  RotateCw,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { EmptyState, IconTile } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, FileInput, Input, SearchInput, Select, Textarea, formatBytes } from '@/components/ui/input';
import { Alert, type StatusTone } from '@/components/ui/notice';
import { SectionHead } from '@/components/settings/sections';
import { Segmented } from '@/components/ui/segmented';
import { SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import {
  JOB_SOURCE_DESCRIPTION,
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
} from '@/lib/api';
import { messageText, plainServerText, toUserMessage, type UserMessage } from '@/lib/errors';
import { ACCEPT_DOCUMENT, fileToBase64, resolveUploadContentType } from '@/lib/upload';
import { useUseCase } from '@/lib/use-cases';

const MAX_BYTES = 10 * 1024 * 1024;

const CARD = 'rounded-card border border-border bg-canvas p-5 sm:p-6';
const COUNT =
  'inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-subtle px-2 text-caption font-medium tabular-nums text-text-2';

// A document's state in words, never colour alone.
const DOC_STATE: Record<string, { tone: StatusTone; icon: LucideIcon; label: string }> = {
  pending: { tone: 'neutral', icon: Clock, label: 'Waiting' },
  processing: { tone: 'info', icon: Hourglass, label: 'Getting it ready' },
  ready: { tone: 'success', icon: CircleCheck, label: 'Ready' },
  failed: { tone: 'danger', icon: TriangleAlert, label: 'Couldn’t read it' },
};
const UNKNOWN_STATE = { tone: 'neutral' as const, icon: CircleQuestionMark, label: 'Unknown' };

const OUTCOME: Record<string, { kind: 'info' | 'warning'; text: string }> = {
  no_knowledge: { kind: 'info', text: 'Nothing in your documents matches this yet.' },
  below_threshold: {
    kind: 'info',
    text: 'Nothing was close enough to be useful. Try other words, or add a document that answers it.',
  },
  failed: { kind: 'warning', text: 'Search isn’t working right now. Try again in a minute.' },
};

function kindOf(contentType: string): string | null {
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType.includes('wordprocessingml')) return 'Word';
  if (contentType.includes('presentationml')) return 'PowerPoint';
  if (contentType.startsWith('text/')) return 'Text';
  return null;
}

type Removal = { kind: 'document' | 'set'; id: string; name: string };

export function KnowledgeDocuments() {
  const { labels } = useUseCase();
  const job = labels.workItem.one.toLowerCase();
  const contact = labels.contact.one.toLowerCase();
  const [profile, setProfile] = useState<Me | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [creatingSet, setCreatingSet] = useState(false);
  const [uploadSource, setUploadSource] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [pasteName, setPasteName] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UserMessage | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedChunk[] | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<UserMessage | null>(null);
  const [reindexing, setReindexing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const docsHeading = useRef<HTMLHeadingElement>(null);
  const removed = useRef(false);

  const reload = useCallback(async () => {
    try {
      const p = await me();
      setProfile(p);
      if (p.activeOrganization?.permissions.includes('knowledge.read')) {
        const [s, d] = await Promise.all([listKnowledgeSources(), listKnowledgeDocuments()]);
        setSources(s.sources);
        setDocuments(d.documents);
        setUploadSource(
          (prev) => prev || s.sources.find((x) => x.description !== JOB_SOURCE_DESCRIPTION)?.id || '',
        );
      }
      setLoadError(null);
    } catch (e) {
      // A 401 is already on its way to sign-in (lib/api).
      setLoadError(e);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // While a document is being read, check again every few seconds.
  useEffect(() => {
    const busy = documents?.some((d) => d.status === 'pending' || d.status === 'processing');
    if (!busy) return;
    const id = window.setInterval(() => {
      void reload();
    }, 2500);
    return () => window.clearInterval(id);
  }, [documents, reload]);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canRead = can('knowledge.read');
  const companySources = sources.filter((x) => x.description !== JOB_SOURCE_DESCRIPTION);
  const skeleton = useHeldLoading(documents === null && !loadError && (profile === null || canRead));

  const retry = async () => {
    setRetrying(true);
    await reload();
    setRetrying(false);
  };

  async function onCreateSource(event: FormEvent) {
    event.preventDefault();
    setCreatingSet(true);
    try {
      await createKnowledgeSource(sourceName);
      setSourceName('');
      toast.success('Document set created.');
      await reload();
    } catch (e) {
      const m = toUserMessage(e, 'create the set');
      toast.error(m.title, { description: m.detail });
    } finally {
      setCreatingSet(false);
    }
  }

  function added(name: string, deduplicated: boolean) {
    if (deduplicated) toast.info('That exact document is already here.');
    else toast.success(`Added ${name}`, { description: 'HRVoice can use it in a moment.' });
  }

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    setUploadError(null);
    try {
      let sourceId = uploadSource || companySources[0]?.id;
      if (!sourceId) {
        const created = await createKnowledgeSource('Company documents');
        sourceId = created.id;
        setUploadSource(created.id);
      }
      if (mode === 'file') {
        if (!docFile) {
          setUploadError({ title: 'Choose a file first.', detail: 'PDF, Word, PowerPoint or a text file.', action: 'fix_input' });
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
        added(docFile.name, res.deduplicated);
      } else {
        // Pasted text is stored as a text file, and the server wants its name to say so.
        const typed = pasteName.trim() || 'notes';
        const name = /\.(txt|text|md)$/i.test(typed) ? typed : `${typed}.txt`;
        const contentType = name.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
        const res = await uploadKnowledgeDocument({
          sourceId,
          name,
          contentType,
          content: pasteContent,
          contentEncoding: 'utf8',
        });
        setPasteName('');
        setPasteContent('');
        added(name, res.deduplicated);
      }
      await reload();
    } catch (e) {
      setUploadError(toUserMessage(e, 'add the document'));
    } finally {
      setUploading(false);
    }
  }

  async function onReindex(doc: KnowledgeDocument) {
    setReindexing(doc.id);
    try {
      await reindexKnowledgeDocument(doc.id);
      toast.success(`Reading ${doc.name} again.`);
      await reload();
    } catch (e) {
      const m = toUserMessage(e, `read ${doc.name} again`);
      toast.error(m.title, { description: m.detail });
    } finally {
      setReindexing(null);
    }
  }

  function askRemove(removal: Removal) {
    setRemoving(removal);
    setRemoveError(null);
    setRemoveOpen(true);
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      if (removing.kind === 'document') await deleteKnowledgeDocument(removing.id);
      else await deleteKnowledgeSource(removing.id);
      removed.current = true;
      setRemoveOpen(false);
      toast.success(removing.kind === 'document' ? `Removed ${removing.name}.` : `Removed the set ${removing.name}.`);
      await reload();
    } catch (e) {
      const m = toUserMessage(e, `remove ${removing.name}`);
      setRemoveError(messageText(m));
    } finally {
      setRemoveBusy(false);
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchKnowledge(query, 5);
      setOutcome(res.outcome);
      setResults(res.chunks);
    } catch (e) {
      setSearchError(toUserMessage(e, 'search your documents'));
    } finally {
      setSearching(false);
    }
  }

  const header = (
    <SectionHead
      id="company-facts"
      title="What HRVoice answers from"
      description={`Company facts it can use on every call. Anything about one ${job} goes on that ${job}.`}
    />
  );

  const shell = (children: ReactNode) => (
    <>
      {header}
      {children}
    </>
  );

  if (skeleton) return shell(<SkeletonRows rows={3} />);
  if (profile === null || (canRead && documents === null)) {
    const m = toUserMessage(loadError, 'load your documents');
    return shell(<ErrorState title={m.title} cause={m.detail} onRetry={() => void retry()} retrying={retrying} />);
  }
  if (!canRead || documents === null) {
    return shell(
      <div className="rounded-card border border-border bg-canvas">
        <EmptyState
          icon={<Lock />}
          title="You can’t see Company info in this workspace"
          description="Ask a workspace admin for access."
        />
      </div>,
    );
  }

  const jobSourceIds = new Set(
    sources.filter((x) => x.description === JOB_SOURCE_DESCRIPTION).map((x) => x.id),
  );
  const companyDocs = documents.filter((d) => !jobSourceIds.has(d.sourceId));
  const jobDocs = documents.length - companyDocs.length;
  const busyCount = companyDocs.filter((d) => d.status === 'pending' || d.status === 'processing').length;
  const outcomeNote = outcome ? OUTCOME[outcome] : undefined;

  return shell(
    <>
      {loadError ? (
        <Alert
          kind="warning"
          title="Couldn’t refresh your documents"
          action={
            <Button variant="secondary" size="sm" loading={retrying} onClick={() => void retry()}>
              Retry
            </Button>
          }
        >
          What you see is from the last time it loaded.
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="knowledge-docs" className="space-y-4">
            <h2
              id="knowledge-docs"
              ref={docsHeading}
              tabIndex={-1}
              className="m-0 flex items-center gap-2.5 text-section text-text"
            >
              Documents
              {companyDocs.length > 0 ? <span className={COUNT}>{companyDocs.length}</span> : null}
            </h2>
            <p role="status" className="sr-only">
              {busyCount > 0 ? `Getting ${busyCount} ${busyCount === 1 ? 'document' : 'documents'} ready` : ''}
            </p>
            {companyDocs.length === 0 ? (
              <div className="rounded-card border border-border bg-canvas">
                <EmptyState
                  headingLevel={3}
                  icon={<FileText />}
                  title="No company facts yet"
                  description={
                    can('knowledge.create')
                      ? `Add what’s true for every ${job}: who you are, your policies, benefits and locations. HRVoice answers from them on every call.`
                      : 'Ask a workspace admin to add your policies and facts about the company.'
                  }
                />
              </div>
            ) : (
              <ListRows
                aria-label="Documents"
                columns="minmax(0,1fr) auto auto"
                header={
                  <>
                    <span>Document</span>
                    <span>Status</span>
                    <span className="sr-only">Actions</span>
                  </>
                }
              >
                {companyDocs.map((d) => {
                  const state = DOC_STATE[d.status] ?? UNKNOWN_STATE;
                  const details = [kindOf(d.contentType), d.byteSize > 0 ? formatBytes(d.byteSize) : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <ListRow key={d.id}>
                      <ListRowPrimary
                        avatar={
                          <IconTile className="size-9 rounded-input [&_svg]:size-4">
                            <FileText />
                          </IconTile>
                        }
                        title={d.name}
                        meta={
                          d.status === 'failed' ? (
                            // Wraps, unlike the usual one-line meta: the reason is the next step.
                            <span className="block whitespace-normal text-status-danger-text">
                              {plainServerText(d.failureReason) ?? 'Try a PDF with real text, or a Word file, then retry.'}
                            </span>
                          ) : (
                            details || undefined
                          )
                        }
                      />
                      <ListCell kind="tag">
                        <StatusBadge tone={state.tone} icon={state.icon}>
                          {state.label}
                        </StatusBadge>
                      </ListCell>
                      <ListCell kind="actions">
                        {can('knowledge.create') && d.status === 'failed' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={reindexing === d.id}
                            onClick={() => void onReindex(d)}
                          >
                            <RotateCw aria-hidden strokeWidth={1.5} />
                            Retry
                          </Button>
                        ) : null}
                        {can('knowledge.delete') ? (
                          <IconButton
                            size="sm"
                            variant="quiet"
                            label={`Remove ${d.name}`}
                            onClick={() => askRemove({ kind: 'document', id: d.id, name: d.name })}
                          >
                            <Trash2 aria-hidden strokeWidth={1.5} />
                          </IconButton>
                        ) : null}
                      </ListCell>
                    </ListRow>
                  );
                })}
              </ListRows>
            )}
            {jobDocs > 0 ? (
              <p className="m-0 text-meta text-text-3">
                {labels.workItem.one} descriptions stay on their {labels.workItem.many.toLowerCase()} and aren’t listed here.
              </p>
            ) : null}
          </section>

          {can('knowledge.create') ? (
            <section aria-labelledby="knowledge-add" className={CARD}>
              <h2 id="knowledge-add" className="m-0 text-section text-text">
                {companyDocs.length === 0 ? 'Add your first document' : 'Add a document'}
              </h2>
              <p className="mb-0 mt-1 text-text-2">
                PDF, Word, PowerPoint or plain text, up to 10 MB. A PDF with real text works better than a scan.
              </p>
              <form onSubmit={onUpload} className="mt-5 grid max-w-xl gap-4">
                <Segmented
                  label="How to add it"
                  value={mode}
                  onValueChange={(next) => {
                    setMode(next);
                    setUploadError(null);
                  }}
                  options={[
                    { value: 'file', label: 'Upload a file' },
                    { value: 'paste', label: 'Paste text' },
                  ]}
                  className="justify-self-start"
                />
                {companySources.length > 1 ? (
                  <Field label="Document set">
                    <Select value={uploadSource} onChange={(e) => setUploadSource(e.target.value)}>
                      {companySources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {mode === 'file' ? (
                  <Field label="File">
                    <FileInput
                      key={fileInputKey}
                      accept={ACCEPT_DOCUMENT}
                      maxBytes={MAX_BYTES}
                      required
                      variant="dropzone"
                      onFileChange={setDocFile}
                      emptyLabel="Drop a PDF, Word, PowerPoint or text file here"
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Name" hint="How it shows in the list. It’s saved as a text file.">
                      <Input
                        value={pasteName}
                        onChange={(e) => setPasteName(e.target.value)}
                        placeholder="For example, Leave policy"
                      />
                    </Field>
                    <Field label="Text">
                      <Textarea
                        value={pasteContent}
                        onChange={(e) => setPasteContent(e.target.value)}
                        placeholder="Paste the document’s text here"
                        required
                        rows={8}
                      />
                    </Field>
                  </>
                )}
                {uploadError ? (
                  <Alert kind="error" title={uploadError.title}>
                    {uploadError.detail}
                  </Alert>
                ) : null}
                <div>
                  <Button type="submit" loading={uploading}>
                    <Plus aria-hidden strokeWidth={1.5} />
                    Add document
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          <section aria-labelledby="knowledge-search" className={CARD}>
            <h2 id="knowledge-search" className="m-0 text-section text-text">
              Check what HRVoice can find
            </h2>
            <p className="mb-0 mt-1 text-text-2">
              Ask the way a {contact} might. It searches your documents the way a call does.
            </p>
            <form role="search" onSubmit={onSearch} className="mt-4 flex max-w-xl flex-col gap-2 sm:flex-row">
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="For example, is there a night shift allowance?"
                aria-label="What to search for"
                required
                className="sm:flex-1"
              />
              <Button type="submit" variant="secondary" loading={searching}>
                Search
              </Button>
            </form>
            {searchError ? (
              <Alert kind="error" title={searchError.title} className="mt-4">
                {searchError.detail}
              </Alert>
            ) : outcomeNote ? (
              <Alert kind={outcomeNote.kind} className="mt-4">
                {outcomeNote.text}
              </Alert>
            ) : outcome === 'ok' && results?.length === 0 ? (
              <Alert kind="info" className="mt-4">
                Nothing matched.
              </Alert>
            ) : null}
            {!searchError && results && results.length > 0 ? (
              <ol role="list" aria-label="What it found" className="m-0 mt-4 list-none space-y-2 p-0">
                {results.map((c, i) => (
                  <li key={`${c.documentId}-${i}`} className="rounded-card-sm bg-subtle px-4 py-3">
                    <p className="m-0 text-meta font-medium text-text-2">
                      {[c.documentName?.trim(), c.section?.trim()].filter(Boolean).join(' · ') || `Passage ${i + 1}`}
                    </p>
                    <p className="mb-0 mt-1 whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{c.content}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>

        <aside className="min-w-0 space-y-6 lg:pt-11">
          <section aria-labelledby="knowledge-guide" className={CARD}>
            <h2 id="knowledge-guide" className="m-0 text-title font-semibold text-text">
              What goes here
            </h2>
            <ul role="list" className="m-0 mt-3 list-none space-y-2 p-0 text-text-2">
              {[
                'About the company and how you work',
                `Policies for every ${job}`,
                'Benefits, holidays and office locations',
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Check aria-hidden strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-text-3" />
                  {item}
                </li>
              ))}
            </ul>
            <h3 className="mb-0 mt-5 text-label font-semibold text-text">On the {job} instead</h3>
            <ul role="list" className="m-0 mt-2 list-none space-y-2 p-0 text-text-2">
              {[
                `The ${job} description`,
                'Pay, notice period and must-ask questions',
                `Anything that changes from ${job} to ${job}`,
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <ArrowUpRight aria-hidden strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-text-3" />
                  {item}
                </li>
              ))}
            </ul>
            {can('jobs.read') ? (
              <Button asChild variant="secondary" size="sm" className="mt-5">
                <Link href="/jobs">Open {labels.workItem.many.toLowerCase()}</Link>
              </Button>
            ) : null}
          </section>

          {can('knowledge.create') ? (
            <details className="group rounded-card border border-border bg-canvas">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-5 marker:content-none focus-visible:-outline-offset-2 sm:px-6 [&::-webkit-details-marker]:hidden">
                <h2 className="m-0 text-title font-semibold text-text">Document sets</h2>
                <span className="flex items-center gap-2 text-meta text-text-3">
                  Optional
                  <ChevronDown
                    aria-hidden
                    strokeWidth={1.5}
                    className="size-4 transition-transform duration-fast group-open:rotate-180"
                  />
                </span>
              </summary>
              <div className="border-t border-border px-5 pb-5 pt-4 sm:px-6">
                <p className="m-0 text-text-2">
                  Group company files, say policies apart from facts about the company. Don’t make a set for each {job}.
                </p>
                <form onSubmit={onCreateSource} className="mt-4 grid gap-3">
                  <Field label="Set name">
                    <Input
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      placeholder="For example, Company policies"
                      required
                      minLength={2}
                    />
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary" size="sm" loading={creatingSet}>
                      Create set
                    </Button>
                  </div>
                </form>
                {companySources.length > 0 ? (
                  <ul role="list" className="m-0 mt-4 list-none divide-y divide-border border-t border-border p-0">
                    {companySources.map((s) => (
                      <li key={s.id} className="flex min-h-12 items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-text">{s.name}</span>
                          <span className="block text-meta tabular-nums text-text-3">
                            {s.documentCount === 0
                              ? 'Empty'
                              : `${s.documentCount} ${s.documentCount === 1 ? 'file' : 'files'}`}
                          </span>
                        </span>
                        {can('knowledge.delete') ? (
                          <IconButton
                            size="sm"
                            variant="quiet"
                            label={`Remove the set ${s.name}`}
                            onClick={() => askRemove({ kind: 'set', id: s.id, name: s.name })}
                          >
                            <Trash2 aria-hidden strokeWidth={1.5} />
                          </IconButton>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
          ) : null}
        </aside>
      </div>

      {removing ? (
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={removing.kind === 'document' ? `Remove ${removing.name}?` : `Remove the set ${removing.name}?`}
          body={
            removing.kind === 'document'
              ? 'HRVoice stops using it on calls. You can add it again later.'
              : 'Its documents are removed too, and HRVoice stops using them on calls.'
          }
          confirmLabel="Remove"
          tone="danger"
          busy={removeBusy}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCloseAutoFocus={(event) => {
            // The row that opened the dialog is about to go, so focus waits on the list's heading.
            if (!removed.current) return;
            removed.current = false;
            event.preventDefault();
            docsHeading.current?.focus();
          }}
        />
      ) : null}
    </>,
  );
}
