'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '../../../components/AppShell';
import { Badge, statusTone } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Field, FileInput, Select, Textarea } from '../../../components/ui/input';
import { Notice, PageHeader, PageMain, Surface } from '../../../components/ui/page';
import { SkeletonCard } from '../../../components/ui/skeleton';
import { formatWhen, shortRef } from '../../../lib/format';
import {
  ApiClientError,
  assistJobDescription,
  attachJobKnowledge,
  createKnowledgeSource,
  formatApiError,
  getAgent,
  getJob,
  listAgents,
  listJobCandidates,
  listJobKnowledge,
  listKnowledgeSources,
  me,
  saveJobDescriptionText,
  updateJob,
  uploadKnowledgeDocument,
  type Job,
  type JobKnowledgeSource,
  type Me,
} from '../../../lib/api';
import { loginPathForReturn } from '../../../lib/auth-redirect';
import { toPublicId, fromPublicId } from '../../../lib/public-id';
import { JOB_STATUS_LABEL } from '../../../lib/status-labels';
import {
  ACCEPT_DOCUMENT,
  fileToBase64,
  resolveUploadContentType,
} from '../../../lib/upload';
const JOB_STATUSES = ['draft', 'open', 'closed'] as const;
const JOB_STATUS_ACTION: Record<(typeof JOB_STATUSES)[number], string> = {
  draft: 'Mark as draft',
  open: 'Open for hiring',
  closed: 'Close role',
};

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const jobId = fromPublicId(params.id) ?? params.id;

  const [profile, setProfile] = useState<Me | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentPublished, setAgentPublished] = useState(false);
  const [docsPreparing, setDocsPreparing] = useState(false);
  const [jobKnowledge, setJobKnowledge] = useState<JobKnowledgeSource[]>([]);
  const [mustAskEdit, setMustAskEdit] = useState('');
  const [screeningLanguage, setScreeningLanguage] = useState<'en' | 'hi'>('en');
  const [savingScreening, setSavingScreening] = useState(false);
  const [jdFiles, setJdFiles] = useState<File[]>([]);
  const [uploadingJd, setUploadingJd] = useState(false);
  const [jdText, setJdText] = useState('');
  const [jdMode, setJdMode] = useState<'paste' | 'file'>('paste');
  const [jdAssistBusy, setJdAssistBusy] = useState(false);
  const [jdNotice, setJdNotice] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [questionsNotice, setQuestionsNotice] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [savingJdText, setSavingJdText] = useState(false);
  const [agents, setAgents] = useState<{ id: string; name: string; status: string }[]>([]);
  const [linkAgentId, setLinkAgentId] = useState('');
  const [peopleTotal, setPeopleTotal] = useState(0);

  const reloadJobKnowledge = useCallback(async () => {
    try {
      const { sources } = await listJobKnowledge(jobId);
      setJobKnowledge(sources);
      const pending = sources.reduce((n, s) => n + s.pendingDocs, 0);
      setDocsPreparing(pending > 0);
    } catch {
      setJobKnowledge([]);
      setDocsPreparing(false);
    }
  }, [jobId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await me();
      setProfile(p);
      try {
        const j = await getJob(jobId);
        setJob(j);
        setJdText((prev) => {
          const fromJob = (j.description ?? '').trim();
          // Keep in-progress edits; only hydrate when the editor is empty.
          if (prev.trim().length > 0) return prev;
          return fromJob;
        });
        setMustAskEdit(
          (j.screeningQuestions ?? []).map((q) => q.label).join('\n'),
        );
        setScreeningLanguage(j.screeningLanguage === 'hi' ? 'hi' : 'en');
        void reloadJobKnowledge();
        try {
          const roster = await listJobCandidates(jobId, { limit: 1 });
          setPeopleTotal(roster.totals.all);
        } catch {
          setPeopleTotal(0);
        }
      } catch (e) {
        setJob(null);
        setPeopleTotal(0);
        if (e instanceof ApiClientError && e.status === 404) {
          setNotice('Job not found.');
        } else if (e instanceof ApiClientError && e.status === 403) {
          setNotice('You do not have access to this job.');
        } else setNotice('Could not load job.');
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push(loginPathForReturn());
      else setNotice('Could not load profile.');
    } finally {
      setLoading(false);
    }
  }, [jobId, router, reloadJobKnowledge]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    async function loadAgent() {
      try {
        const a = await listAgents();
        if (!cancelled) {
          const mapped = a.agents.map((x) => ({
            id: x.id,
            name: x.name,
            status: x.status,
          }));
          // HR picker: published agents only, plus the one already on this job.
          const linkedId = job?.agentId;
          const forPicker = mapped.filter(
            (x) => x.status === 'published' || x.id === linkedId,
          );
          setAgents(forPicker.length > 0 ? forPicker : mapped);
          setLinkAgentId(
            (prev) =>
              prev ||
              linkedId ||
              forPicker.find((x) => x.status === 'published')?.id ||
              forPicker[0]?.id ||
              '',
          );
        }
      } catch {
        if (!cancelled) setAgents([]);
      }
      if (!job?.agentId) {
        if (!cancelled) setAgentPublished(false);
        return;
      }
      try {
        const agent = await getAgent(job.agentId);
        if (!cancelled) {
          setAgentPublished(agent.status === 'published');
          setLinkAgentId(agent.id);
        }
      } catch {
        if (!cancelled) setAgentPublished(false);
      }
    }
    void loadAgent();
    return () => {
      cancelled = true;
    };
  }, [job?.agentId]);

  // Keep preparing warning live while job JD docs are not ready.
  useEffect(() => {
    if (!docsPreparing) return;
    const id = window.setInterval(() => {
      void reloadJobKnowledge();
    }, 3000);
    return () => window.clearInterval(id);
  }, [docsPreparing, reloadJobKnowledge]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;
  const linkedAgent = agents.find((a) => a.id === job?.agentId) ?? null;

  async function onLinkAgent() {
    if (!linkAgentId) return;
    await run(
      () => updateJob(jobId, { agentId: linkAgentId }),
      job?.agentId ? 'Hiring voice updated.' : 'Hiring voice linked.',
    );
  }

  async function onSaveScreening() {
    setSavingScreening(true);
    setNotice(null);
    try {
      const text = jdText.trim();
      const prior = (job?.description ?? '').trim();
      if (text.length >= 20 && text !== prior) {
        await saveJobDescriptionText(jobId, text);
      }
      await updateJob(jobId, {
        mustAskQuestions: parseLines(mustAskEdit),
        screeningLanguage,
      });
      setNotice(
        text.length >= 20 && text !== prior
          ? 'Job description and screening setup saved.'
          : parseLines(mustAskEdit).length === 0
            ? 'Screening language saved. Questions left blank (optional).'
            : 'Questions and language saved for this job.',
      );
      await reload();
    } catch (e) {
      setNotice(formatApiError(e, 'Could not save screening setup.'));
    } finally {
      setSavingScreening(false);
    }
  }

  async function resolveJdSourceId(): Promise<string> {
    // Already linked to this job — upload into it (covers empty sources from a
    // prior create that never finished uploading).
    const linked = jobKnowledge[0]?.id;
    if (linked) return linked;

    const title = job?.title?.trim() || 'Job';
    const ref = shortRef(jobId);
    // Unique per job so two "Java Backend Developer" roles don't collide.
    const preferred = ref
      ? `${title} description · ${ref}`
      : `${title} description`;
    const legacy = `${title} description`;

    try {
      const created = await createKnowledgeSource(
        preferred,
        'Job description and role docs for screening',
      );
      return created.id;
    } catch (e) {
      if (!(e instanceof ApiClientError) || e.status !== 409) throw e;
      const { sources } = await listKnowledgeSources();
      const match =
        sources.find((s) => s.name === preferred) ??
        sources.find((s) => s.name === legacy);
      if (!match) throw e;
      return match.id;
    }
  }

  async function onUploadJd() {
    if (jdFiles.length === 0) return;
    setUploadingJd(true);
    setJdNotice(null);
    try {
      const sourceId = await resolveJdSourceId();
      for (const file of jdFiles) {
        await uploadKnowledgeDocument({
          sourceId,
          name: file.name,
          contentType: resolveUploadContentType(file),
          content: await fileToBase64(file),
          contentEncoding: 'base64',
        });
      }
      await attachJobKnowledge(jobId, sourceId);
      setJdFiles([]);
      setJdNotice({ kind: 'ok', text: 'Job description uploaded to this job.' });
      await reloadJobKnowledge();
    } catch (e) {
      setJdNotice({
        kind: 'err',
        text: formatApiError(e, 'Could not upload job description.'),
      });
    } finally {
      setUploadingJd(false);
    }
  }

  async function onAssistJd(mode: 'generate' | 'format' | 'questions') {
    const notes =
      mode === 'questions'
        ? jdText.trim() || (job?.description ?? '').trim()
        : jdText.trim();
    const flash = (kind: 'ok' | 'err', text: string) => {
      if (mode === 'questions') setQuestionsNotice({ kind, text });
      else setJdNotice({ kind, text });
    };
    if (notes.length < 20) {
      flash(
        'err',
        mode === 'generate'
          ? 'Add at least a short outline of roles and responsibilities in the box above, then try again.'
          : mode === 'questions'
            ? 'Paste or generate the JD in the box above first, then suggest questions.'
            : 'Paste at least a short job description to format.',
      );
      return;
    }
    setJdAssistBusy(true);
    if (mode === 'questions') setQuestionsNotice(null);
    else setJdNotice(null);
    try {
      const result = await assistJobDescription(jobId, {
        mode,
        notes,
        title: job?.title,
      });
      if (mode === 'questions') {
        const lines =
          result.questions && result.questions.length > 0
            ? result.questions
            : result.jdText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        setMustAskEdit(lines.join('\n'));
        flash(
          'ok',
          'Suggested questions added below. Edit if needed, then save. Or clear and leave blank.',
        );
      } else {
        setJdText(result.jdText);
        flash(
          'ok',
          mode === 'generate'
            ? 'Draft generated. Review it, then save the description.'
            : 'Formatted. Review it, then save the description.',
        );
      }
    } catch (e) {
      flash(
        'err',
        formatApiError(
          e,
          mode === 'questions'
            ? 'Could not suggest questions.'
            : 'Could not assist with the job description.',
        ),
      );
    } finally {
      setJdAssistBusy(false);
    }
  }

  async function onSaveJdText() {
    const text = jdText.trim();
    if (text.length < 20) {
      setJdNotice({
        kind: 'err',
        text: 'Type or paste a job description (at least a short paragraph) before saving.',
      });
      return;
    }
    setSavingJdText(true);
    setJdNotice(null);
    try {
      await saveJobDescriptionText(jobId, text);
      setJdNotice({ kind: 'ok', text: 'Job description saved to this job.' });
      const refreshed = await getJob(jobId);
      setJob(refreshed);
      setJdText(text);
      await reloadJobKnowledge();
    } catch (e) {
      setJdNotice({
        kind: 'err',
        text: formatApiError(e, 'Could not save job description.'),
      });
    } finally {
      setSavingJdText(false);
    }
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setNotice(ok);
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  async function onJobStatusChange(status: (typeof JOB_STATUSES)[number]) {
    await run(() => updateJob(jobId, { status }), 'Job status updated.');
  }

  if (!profile || !job) {
    return (
      <AppShell profile={profile}>
        <PageMain className="space-y-4">
          {loading ? (
            <SkeletonCard />
          ) : (
            <>
              <Link
                href="/jobs"
                className="text-sm text-[var(--accent)] no-underline hover:underline"
              >
                All jobs
              </Link>
              {notice ? (
                <Notice kind="err">{notice}</Notice>
              ) : null}
            </>
          )}
        </PageMain>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title={job.title}
          description={[
            formatWhen(job.createdAt)
              ? `Created ${formatWhen(job.createdAt)}`
              : null,
            'Job setup — description, questions, and voice for this role.',
          ]
            .filter(Boolean)
            .join(' · ')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(job.status)}>
                {JOB_STATUS_LABEL[job.status] ?? job.status}
              </Badge>
              <Button asChild size="sm">
                <Link href={`/jobs/${toPublicId(jobId)}/candidates`}>
                  People
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/jobs">All jobs</Link>
              </Button>
            </div>
          }
        />
        {notice ? <Notice kind="ok">{notice}</Notice> : null}

        {(() => {
          const jdReady =
            Boolean(job.hasJdDocs) ||
            jobKnowledge.some((s) => s.readyDocs > 0) ||
            (job.description ?? '').trim().length >= 20 ||
            jdText.trim().length >= 20;
          const questionsReady =
            (job.screeningQuestions?.length ?? 0) > 0 ||
            mustAskEdit
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean).length > 0;
          const agentReady = Boolean(job.agentId && agentPublished);
          const agentLinked = Boolean(job.agentId);
          const steps = [
            {
              ok: jdReady,
              label: jdReady
                ? 'Job description ready'
                : docsPreparing
                  ? 'Job description still preparing'
                  : 'Add the job description',
            },
            {
              ok: questionsReady,
              soft: true as const,
              label: questionsReady
                ? 'Screening questions ready'
                : 'Add screening questions (optional)',
            },
            {
              ok: agentReady,
              label: agentReady
                ? `Hiring voice ready${linkedAgent?.name ? ` · ${linkedAgent.name}` : ''}`
                : agentLinked
                  ? 'Publish the hiring voice before screens'
                  : 'Choose a hiring voice for this role',
            },
            {
              ok: peopleTotal > 0,
              soft: true as const,
              label:
                peopleTotal > 0
                  ? peopleTotal === 1
                    ? '1 person added'
                    : `${peopleTotal} people added`
                  : 'Add people and run screens',
            },
          ];
          const nextHref = `/jobs/${toPublicId(jobId)}/candidates`;
          return (
            <Surface className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                    Before you call
                  </h2>
                  <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                    Description, questions, and hiring voice — then People.
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link href={nextHref}>
                    {jdReady && agentReady
                      ? 'Go to people →'
                      : 'People on this job →'}
                  </Link>
                </Button>
              </div>
              <ul className="m-0 list-none space-y-2 p-0">
                {steps.map((step) => (
                  <li
                    key={step.label}
                    className="flex flex-wrap items-center gap-2 text-sm text-[var(--foreground-secondary)]"
                  >
                    <Badge
                      tone={
                        step.ok
                          ? 'success'
                          : 'soft' in step && step.soft
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {step.ok
                        ? 'Ready'
                        : 'soft' in step && step.soft
                          ? 'Next'
                          : 'Needed'}
                    </Badge>
                    <span>{step.label}</span>
                  </li>
                ))}
              </ul>
            </Surface>
          );
        })()}

        {can('jobs.update') ? (
          <Surface className="space-y-4">
            <div>
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                1. Description
              </h2>
              <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                Upload a file or paste the job description. This is what screens
                use for role context.
              </p>
            </div>
            {!jdText.trim() && job.description ? (
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                Saved description is on file. Edit below to change it.
              </p>
            ) : null}
            {jobKnowledge.some((s) => s.readyDocs > 0) &&
            !(job.description ?? '').trim() &&
            !jdText.trim() ? (
              <p className="m-0 text-sm">Job description file is ready.</p>
            ) : null}
            {docsPreparing ? (
              <p
                role="status"
                className="m-0 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-3.5 py-2.5 text-[13px] text-[var(--warning)]"
              >
                Uploaded documents are still preparing. You can screen now, but
                the call may miss role context until they show Ready.
              </p>
            ) : null}
            <div
              role="tablist"
              aria-label="How to add the description"
              className="inline-flex rounded-md border border-[var(--separator)] bg-[var(--surface-secondary)] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={jdMode === 'file'}
                className={
                  jdMode === 'file'
                    ? 'rounded-[5px] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm'
                    : 'rounded-[5px] px-3 py-1.5 text-xs font-medium text-[var(--foreground-tertiary)] hover:text-[var(--foreground-secondary)]'
                }
                onClick={() => setJdMode('file')}
              >
                Upload file
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={jdMode === 'paste'}
                className={
                  jdMode === 'paste'
                    ? 'rounded-[5px] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm'
                    : 'rounded-[5px] px-3 py-1.5 text-xs font-medium text-[var(--foreground-tertiary)] hover:text-[var(--foreground-secondary)]'
                }
                onClick={() => setJdMode('paste')}
              >
                Paste text
              </button>
            </div>
            {jdMode === 'file' ? (
              <div className="grid max-w-xl gap-3">
                <Field label="Job description file" compound>
                  <FileInput
                    accept={ACCEPT_DOCUMENT}
                    multiple
                    variant="dropzone"
                    onFilesChange={setJdFiles}
                    emptyLabel="Drop a PDF, Word, or PowerPoint here"
                    aria-label="Job description documents"
                  />
                </Field>
                {jdFiles.length > 0 ? (
                  <ul className="m-0 list-disc pl-5 text-sm">
                    {jdFiles.map((f) => (
                      <li key={`${f.name}-${f.size}`}>{f.name}</li>
                    ))}
                  </ul>
                ) : null}
                <Button
                  type="button"
                  className="justify-self-start"
                  disabled={uploadingJd || jdFiles.length === 0}
                  onClick={() => void onUploadJd()}
                >
                  {uploadingJd ? 'Uploading…' : 'Upload to this job'}
                </Button>
              </div>
            ) : (
              <>
                <Field label="Job description">
                  <Textarea
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    rows={10}
                    placeholder="Paste the job description, or jot roles and responsibilities then Generate from roles…"
                    aria-label="Job description text"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={jdAssistBusy || savingJdText}
                    onClick={() => void onAssistJd('generate')}
                  >
                    {jdAssistBusy ? 'Working…' : 'Generate from roles'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={jdAssistBusy || savingJdText}
                    onClick={() => void onAssistJd('format')}
                  >
                    Format pasted text
                  </Button>
                  <Button
                    type="button"
                    disabled={savingJdText || jdAssistBusy}
                    onClick={() => void onSaveJdText()}
                  >
                    {savingJdText ? 'Saving…' : 'Save description'}
                  </Button>
                </div>
              </>
            )}
            {jdNotice ? (
              <Notice kind={jdNotice.kind === 'err' ? 'err' : 'ok'}>
                {jdNotice.text}
              </Notice>
            ) : null}
            {jobKnowledge.length > 0 ? (
              <ul className="m-0 list-disc pl-5 text-sm text-[var(--foreground-secondary)]">
                {jobKnowledge.map((s) => (
                  <li key={s.id}>
                    {s.name}
                    {s.pendingDocs > 0
                      ? ' · preparing'
                      : s.readyDocs > 0
                        ? ' · ready'
                        : s.failedDocs > 0
                          ? ' · could not read file'
                          : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </Surface>
        ) : (
          <Surface className="space-y-3">
            <h2 className="m-0 font-display text-base font-semibold tracking-tight">
              Description
            </h2>
            {job.description ? (
              <p className="m-0 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                {job.description}
              </p>
            ) : jobKnowledge.some((s) => s.readyDocs > 0) ? (
              <p className="m-0 text-sm">Job description is ready.</p>
            ) : (
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                No description on this job yet.
              </p>
            )}
          </Surface>
        )}

        {can('jobs.update') ? (
          <Surface className="space-y-4">
            <div>
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                2. Questions
              </h2>
              <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                Optional. Leave blank if the description is enough for the
                phone screen.
              </p>
            </div>
            <Field label="Screening questions">
              <Textarea
                value={mustAskEdit}
                onChange={(e) => setMustAskEdit(e.target.value)}
                rows={5}
                placeholder="Leave blank, or type one question per line…"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={jdAssistBusy || savingScreening}
                onClick={() => void onAssistJd('questions')}
              >
                {jdAssistBusy ? 'Working…' : 'Suggest questions'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={savingScreening || !mustAskEdit.trim()}
                onClick={() => setMustAskEdit('')}
              >
                Clear questions
              </Button>
            </div>
            {questionsNotice ? (
              <Notice kind={questionsNotice.kind === 'err' ? 'err' : 'ok'}>
                {questionsNotice.text}
              </Notice>
            ) : null}
            <Field label="Screening language" className="max-w-xs">
              <Select
                value={screeningLanguage}
                onChange={(e) =>
                  setScreeningLanguage(e.target.value === 'hi' ? 'hi' : 'en')
                }
                className="max-w-xs"
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </Select>
            </Field>
            <Button
              type="button"
              disabled={savingScreening}
              onClick={() => void onSaveScreening()}
            >
              {savingScreening ? 'Saving…' : 'Save questions'}
            </Button>
          </Surface>
        ) : null}

        <Surface className="space-y-4">
          <div>
            <h2 className="m-0 font-display text-base font-semibold tracking-tight">
              3. Hiring voice
            </h2>
            <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
              The hiring voice that runs screens for this role.
            </p>
          </div>
          {job.agentId ? (
            <div className="space-y-3">
              <p className="m-0 text-sm">
                Hiring voice for this role:{' '}
                <strong>{linkedAgent?.name ?? 'Linked'}</strong>
                {agentPublished ? ' · ready' : ' · publish before screens'}
              </p>
              <Link
                href={`/agents/${toPublicId(job.agentId)}`}
                className="text-sm font-semibold text-[var(--accent)] no-underline hover:underline"
              >
                {agentPublished
                  ? 'Hiring voice settings →'
                  : 'Publish hiring voice →'}
              </Link>
              {can('jobs.update') && agents.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={linkAgentId}
                    onChange={(e) => setLinkAgentId(e.target.value)}
                    aria-label="Change hiring voice for this role"
                    className="min-w-[11rem] flex-1"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.status === 'published' ? '' : ' (not published)'}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!linkAgentId || linkAgentId === job.agentId}
                    onClick={() => void onLinkAgent()}
                  >
                    Change hiring voice
                  </Button>
                </div>
              ) : null}
            </div>
          ) : can('jobs.update') ? (
            <div className="space-y-3">
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                Choose a hiring voice so you can run browser screens and Call
                phone.
              </p>
              {agents.length === 0 ? (
                <Link
                  href="/agents/new"
                  className="text-sm text-[var(--accent)] hover:underline"
                >
                  Create a hiring voice
                </Link>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={linkAgentId}
                    onChange={(e) => setLinkAgentId(e.target.value)}
                    aria-label="Hiring voice for this role"
                    className="min-w-[11rem] flex-1"
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  <Button type="button" onClick={() => void onLinkAgent()}>
                    Use this hiring voice
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
              No hiring voice linked to this job yet.
            </p>
          )}
          {can('jobs.update') ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--separator-subtle)] pt-4">
              <p className="m-0 w-full text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                Job status
              </p>
              {JOB_STATUSES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={job.status === s ? 'secondary' : 'outline'}
                  disabled={job.status === s}
                  onClick={() => void onJobStatusChange(s)}
                >
                  {JOB_STATUS_ACTION[s]}
                </Button>
              ))}
            </div>
          ) : null}
        </Surface>
      </PageMain>
    </AppShell>
  );
}
