'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  Circle,
  CircleCheck,
  CircleDashed,
  FileText,
  Hourglass,
  PenLine,
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Agent } from '@/components/brand/agent';
import { cleanQuestions, jobReadiness, jobStatusLabel, lineState, readinessLine, sameQuestions } from '@/components/jobs/setup';
import { requirementsDirty, toForm, type RequirementsForm } from '@/components/jobs/requirements';
import { RequirementsEditor, RequirementsSummary } from '@/components/jobs/requirements-form';
import { CareersPagePanel } from '@/components/jobs/careers-page-panel';
import { JobHeader } from '@/components/shared/job-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, FileInput, Select, Textarea, formatBytes } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import { toastUndo } from '@/components/ui/toaster';
import { Skeleton, SkeletonRecord, useHeldLoading } from '@/components/ui/skeleton';
import { StatusBadge, StatusTag } from '@/components/ui/state-tag';
import {
  ApiClientError,
  assistJobDescription,
  attachJobKnowledge,
  createKnowledgeSource,
  formatApiError,
  getAgent,
  getJob,
  getTelephonyStatus,
  isScreeningLanguage,
  JOB_SOURCE_DESCRIPTION,
  listAgents,
  listJobCandidates,
  listJobKnowledge,
  listKnowledgeSources,
  saveJobDescriptionText,
  SCREENING_LANGUAGE_LABEL,
  updateJob,
  uploadKnowledgeDocument,
  type Job,
  type ScreeningLanguage,
  type JobKnowledgeSource,
} from '@/lib/api';
import {
  ENGINE_LABEL,
  GOOGLE_VOICE_ENGINE,
  PERSONA_LABEL,
  setJobEngine,
  TTS_MODEL_LABEL,
  type TtsModel,
  type VoiceEngine,
  type VoicePersona,
} from '@/app/admin/costs-api';
import { useUnsavedChangesGuard } from '@/lib/drafts';
import { toUserMessage } from '@/lib/errors';
import { shortRef } from '@/lib/format';
import { fromPublicId, toPublicId } from '@/lib/public-id';
import { ACCEPT_DOCUMENT, fileToBase64, resolveUploadContentType } from '@/lib/upload';
import { useMe } from '@/lib/use-me';
import { useUseCase } from '@/lib/use-cases';

/*
  Job setup (D2): the job's header and tabs, then the steps that make it ready for calls, each
  a white card: the description, the must-ask questions and the call language, the AI hiring
  agent. Beside them (below on phones) what is still missing and the job's status. Every
  "ready" comes from saved data; unsaved edits are marked and guarded.
*/

const JOB_STATUS_ACTION = {
  draft: 'Move to draft',
  open: 'Open for calls',
  closed: 'Close job',
} as const;
type JobStatus = keyof typeof JOB_STATUS_ACTION;

// The backend's limits: 30 questions of up to 300 characters, documents up to 10 MB.
const MAX_QUESTIONS = 30;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  // Keyed, so moving to another job starts from a clean page.
  return <JobSetup key={params.id} publicId={params.id} />;
}

function JobSetup({ publicId }: { publicId: string }) {
  const jobId = fromPublicId(publicId) ?? publicId;
  const me = useMe();
  const { labels } = useUseCase();

  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // The linked agent's raw status: null while loading, 'unknown' when it couldn't be read.
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [docsPreparing, setDocsPreparing] = useState(false);
  const [jobKnowledge, setJobKnowledge] = useState<JobKnowledgeSource[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [requirementsForm, setRequirementsForm] = useState<RequirementsForm>(() => toForm(null));
  const [screeningLanguage, setScreeningLanguage] = useState<ScreeningLanguage>('en');
  const [savingScreening, setSavingScreening] = useState(false);
  const [jdFiles, setJdFiles] = useState<File[]>([]);
  const [uploadingJd, setUploadingJd] = useState(false);
  const [jdText, setJdText] = useState('');
  const [jdMode, setJdMode] = useState<'paste' | 'file'>('paste');
  const [assisting, setAssisting] = useState<'generate' | 'format' | 'questions' | null>(null);
  const [jdError, setJdError] = useState<string | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [savingJdText, setSavingJdText] = useState(false);
  // null while loading.
  const [agents, setAgents] = useState<{ id: string; name: string; status: string }[] | null>(null);
  const [linkAgentId, setLinkAgentId] = useState('');
  const [linking, setLinking] = useState(false);
  const [changingStatus, setChangingStatus] = useState<JobStatus | null>(null);
  // null when the roster couldn't be read: shown as unknown, never as 0.
  const [peopleTotal, setPeopleTotal] = useState<number | null>(null);
  const hydrated = useRef(false);
  const questionInputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const addQuestionButton = useRef<HTMLButtonElement>(null);

  const reloadJobKnowledge = useCallback(async () => {
    try {
      const { sources } = await listJobKnowledge(jobId);
      setJobKnowledge(sources);
      setDocsPreparing(sources.some((s) => s.pendingDocs > 0));
    } catch {
      setJobKnowledge([]);
      setDocsPreparing(false);
    }
  }, [jobId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const j = await getJob(jobId);
      setJob(j);
      setLoadError(null);
      // The editors take the saved values once; later reloads never overwrite work in progress.
      if (!hydrated.current) {
        hydrated.current = true;
        setJdText((j.description ?? '').trim());
        setQuestions((j.screeningQuestions ?? []).map((q) => q.label));
        setRequirementsForm(toForm(j.requirements));
        setScreeningLanguage(isScreeningLanguage(j.screeningLanguage) ? j.screeningLanguage : 'en');
      }
      void reloadJobKnowledge();
      try {
        const roster = await listJobCandidates(jobId, { limit: 1 });
        setPeopleTotal(roster.totals.all);
      } catch {
        setPeopleTotal(null);
      }
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, [jobId, reloadJobKnowledge]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const jobLoaded = job !== null;
  const linkedId = job?.agentId ?? null;
  useEffect(() => {
    if (!jobLoaded) return;
    let cancelled = false;
    setAgentStatus(null);
    async function loadAgent() {
      try {
        const a = await listAgents();
        if (!cancelled) {
          const mapped = a.agents.map((x) => ({ id: x.id, name: x.name, status: x.status }));
          // The picker: live agents only, plus the one already on this job.
          const forPicker = mapped.filter((x) => x.status === 'published' || x.id === linkedId);
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
      if (!linkedId) return;
      try {
        const agent = await getAgent(linkedId);
        if (!cancelled) {
          setAgentStatus(agent.status);
          setLinkAgentId(agent.id);
        }
      } catch {
        if (!cancelled) setAgentStatus('unknown');
      }
    }
    void loadAgent();
    return () => {
      cancelled = true;
    };
  }, [jobLoaded, linkedId]);

  // Long questions wrap: each box grows to its text. Native where field-sizing is supported.
  useEffect(() => {
    if (CSS.supports('field-sizing', 'content')) return;
    const fit = () =>
      questionInputs.current.forEach((el) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight + 2}px`; // plus the 1px borders
      });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [questions]);

  // While uploaded files are being read, check again every 3 seconds.
  useEffect(() => {
    if (!docsPreparing) return;
    const id = window.setInterval(() => void reloadJobKnowledge(), 3000);
    return () => window.clearInterval(id);
  }, [docsPreparing, reloadJobKnowledge]);

  const savedDescription = (job?.description ?? '').trim();
  const savedQuestions = (job?.screeningQuestions ?? []).map((q) => q.label);
  const savedLanguage: ScreeningLanguage = isScreeningLanguage(job?.screeningLanguage) ? job.screeningLanguage : 'en';
  const jdDirty = job !== null && jdText.trim() !== savedDescription;
  const questionsDirty =
    job !== null && (!sameQuestions(questions, savedQuestions) || screeningLanguage !== savedLanguage);
  const reqDirty = job !== null && requirementsDirty(requirementsForm, job.requirements);
  useUnsavedChangesGuard(jdDirty || questionsDirty || reqDirty);

  const permissions = me.data?.activeOrganization?.permissions ?? [];
  const canEdit = permissions.includes('jobs.update');
  const linkedAgent = agents?.find((a) => a.id === job?.agentId) ?? null;
  // Unknown while loading or when it couldn't be read: then nothing claims it is or isn't live.
  const agentLive =
    agentStatus === null || agentStatus === 'unknown' ? null : agentStatus === 'published';
  const otherAgents = agents?.filter((a) => a.id !== job?.agentId) ?? [];
  // The same calling-number check as Settings and the candidates board.
  const canCheckLine = permissions.includes('calls.initiate') || permissions.includes('agents.test');
  const telephony = useQuery({ queryKey: ['telephony-status'], queryFn: getTelephonyStatus, enabled: canCheckLine });
  const line = lineState(telephony.data?.outboundPhone, telephony.isError || (me.data != null && !canCheckLine));
  const showSkeleton = useHeldLoading(loading && !job);

  async function onLinkAgent() {
    if (!linkAgentId) return;
    setLinking(true);
    await run(
      () => updateJob(jobId, { agentId: linkAgentId }),
      job?.agentId ? 'Agent changed for this job.' : 'Agent chosen for this job.',
      'Couldn’t change the agent. Try again.',
    );
    setLinking(false);
  }

  async function onSaveScreening() {
    setSavingScreening(true);
    setQuestionsError(null);
    try {
      const text = jdText.trim();
      const withDescription = text.length >= 20 && text !== savedDescription;
      if (withDescription) await saveJobDescriptionText(jobId, text);
      const cleaned = cleanQuestions(questions);
      await updateJob(jobId, { mustAskQuestions: cleaned, screeningLanguage });
      setQuestions(cleaned);
      toast.success(
        withDescription
          ? 'Description, questions and language saved.'
          : cleaned.length === 0
            ? 'Saved. Calls use the questions set on the agent.'
            : 'Questions and language saved.',
      );
      await reload();
    } catch (e) {
      setQuestionsError(formatApiError(e, 'Couldn’t save the questions. Try again.'));
    } finally {
      setSavingScreening(false);
    }
  }

  async function resolveJdSourceId(): Promise<string> {
    // Already linked to this job: upload into it (covers empty sources from a create that never
    // finished uploading).
    const linked = jobKnowledge[0]?.id;
    if (linked) return linked;

    const title = job?.title?.trim() || 'Job';
    const ref = shortRef(jobId);
    // Unique per job, so two jobs with the same title don't collide.
    const preferred = ref ? `${title} description · ${ref}` : `${title} description`;
    const legacy = `${title} description`;

    try {
      const created = await createKnowledgeSource(preferred, JOB_SOURCE_DESCRIPTION);
      return created.id;
    } catch (e) {
      if (!(e instanceof ApiClientError) || e.status !== 409) throw e;
      const { sources } = await listKnowledgeSources();
      const match = sources.find((s) => s.name === preferred) ?? sources.find((s) => s.name === legacy);
      if (!match) throw e;
      return match.id;
    }
  }

  async function onUploadJd() {
    if (jdFiles.length === 0) return;
    setUploadingJd(true);
    setJdError(null);
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
      toast.success(jdFiles.length === 1 ? 'File uploaded. It’s being read now.' : 'Files uploaded. They’re being read now.');
      await reloadJobKnowledge();
    } catch (e) {
      setJdError(formatApiError(e, 'Couldn’t upload the file. Try again.'));
    } finally {
      setUploadingJd(false);
    }
  }

  async function onAssistJd(mode: 'generate' | 'format' | 'questions') {
    const notes = mode === 'questions' ? jdText.trim() || savedDescription : jdText.trim();
    const fail = mode === 'questions' ? setQuestionsError : setJdError;
    if (notes.length < 20) {
      fail(
        mode === 'generate'
          ? 'Write a few lines about the job in the box first: what the person does and what they need. Then try again.'
          : mode === 'questions'
            ? 'Add the job description first. The questions are suggested from it.'
            : 'Paste the job description in the box first, then clean it up.',
      );
      return;
    }
    setAssisting(mode);
    fail(null);
    try {
      const result = await assistJobDescription(jobId, { mode, notes, title: job?.title });
      if (mode === 'questions') {
        const lines =
          result.questions && result.questions.length > 0
            ? result.questions
            : result.jdText
                .split(/\n+/)
                .map((l) => l.trim())
                .filter(Boolean);
        setQuestions(lines.slice(0, MAX_QUESTIONS));
        toast.success('Questions suggested from the description. Edit them, then save.');
      } else {
        setJdText(result.jdText);
        toast.success(
          mode === 'generate'
            ? 'Draft written. Read it through, then save.'
            : 'Formatting cleaned up. Read it through, then save.',
        );
      }
    } catch (e) {
      fail(
        formatApiError(
          e,
          mode === 'questions'
            ? 'Couldn’t suggest questions. Try again.'
            : 'Couldn’t write the description. Try again.',
        ),
      );
    } finally {
      setAssisting(null);
    }
  }

  async function onSaveJdText() {
    const text = jdText.trim();
    if (text.length < 20) {
      setJdError('Paste or write the job description first. A short paragraph is enough.');
      return;
    }
    setSavingJdText(true);
    setJdError(null);
    try {
      await saveJobDescriptionText(jobId, text);
      toast.success('Description saved. The agent uses it on every call for this job.');
      const refreshed = await getJob(jobId);
      setJob(refreshed);
      setJdText(text);
      await reloadJobKnowledge();
    } catch (e) {
      setJdError(formatApiError(e, 'Couldn’t save the description. Try again.'));
    } finally {
      setSavingJdText(false);
    }
  }

  async function run(action: () => Promise<unknown>, ok: string, failed: string) {
    try {
      await action();
      toast.success(ok);
      await reload();
    } catch (e) {
      toast.error(formatApiError(e, failed));
    }
  }

  async function onJobStatusChange(status: JobStatus) {
    setChangingStatus(status);
    await run(
      () => updateJob(jobId, { status }),
      status === 'open' ? 'The job is open for calls.' : status === 'closed' ? 'Job closed.' : 'Job moved to draft.',
      'Couldn’t change the job’s status. Try again.',
    );
    setChangingStatus(null);
  }

  function focusQuestion(index: number | null) {
    // After React has drawn the new list. null: the list is empty, so Add question.
    window.requestAnimationFrame(() =>
      (index === null ? addQuestionButton.current : questionInputs.current[index])?.focus(),
    );
  }

  function addQuestion() {
    setQuestions((qs) => [...qs, '']);
    focusQuestion(questions.length);
  }

  function removeQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
    // Focus stays in the list: the question that took its place, or the one before.
    focusQuestion(questions.length > 1 ? Math.min(index, questions.length - 2) : null);
  }

  if (!job) {
    let body: ReactNode = null;
    if (showSkeleton) body = <SetupSkeleton />;
    else if (loadError) {
      const m = toUserMessage(loadError, `load this ${labels.workItem.one.toLowerCase()}`);
      // The whole page: the error names it (h1). Retry when it may help; the way out is the list.
      body = (
        <ErrorState
          headingLevel={1}
          title={m.title}
          cause={m.detail}
          onRetry={m.action === 'retry' ? () => void reload() : undefined}
          retrying={loading}
          action={
            <Button asChild variant={m.action === 'retry' ? 'tertiary' : 'secondary'}>
              <Link href="/jobs">Back to {labels.workItem.many.toLowerCase()}</Link>
            </Button>
          }
        />
      );
    }
    return (
      <AppShell profile={me.data ?? null}>
        <PageMain>{body}</PageMain>
      </AppShell>
    );
  }

  const readiness = jobReadiness(job, jobKnowledge, agentLive, line);
  const contacts = labels.contact.many.toLowerCase();

  return (
    <AppShell
      profile={me.data ?? null}
      breadcrumb={[{ label: labels.workItem.many, href: '/jobs' }, { label: job.title }]}
    >
      <PageMain>
        <JobHeader
          jobId={toPublicId(jobId)}
          title={job.title}
          status={job.status}
          testCallsOnly={jobStatusLabel(readiness) !== null}
          current="setup"
          readiness={readinessLine(readiness)}
          workItemLabel={labels.workItem.many}
          contactLabel={labels.contact.many}
        />

        {loadError ? (
          <Alert
            kind="warning"
            title={`Couldn’t refresh this ${labels.workItem.one.toLowerCase()}`}
            action={
              <Button variant="secondary" size="sm" loading={loading} onClick={() => void reload()}>
                Retry
              </Button>
            }
          >
            What you see is from the last time it loaded.
          </Alert>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0 space-y-6">
            <SetupCard
              id="job-description"
              step={canEdit ? 1 : undefined}
              title="Job description"
              description="The agent uses it on every call for this job."
              badge={
                canEdit && jdDirty ? (
                  <UnsavedBadge />
                ) : readiness.description === 'saved' ? (
                  <StatusBadge tone="success" icon={CircleCheck}>
                    Saved
                  </StatusBadge>
                ) : readiness.description === 'preparing' ? (
                  <StatusBadge tone="info" icon={Hourglass}>
                    Reading your file
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="neutral" icon={Circle}>
                    Not added yet
                  </StatusBadge>
                )
              }
            >
              {canEdit ? (
                <>
                  <Segmented
                    label="How to add the description"
                    options={[
                      { value: 'paste', label: 'Paste text' },
                      { value: 'file', label: 'Upload a file' },
                    ]}
                    value={jdMode}
                    onValueChange={setJdMode}
                  />
                  {jdMode === 'paste' ? (
                    <div className="mt-4 grid gap-3">
                      <Textarea
                        value={jdText}
                        onChange={(e) => setJdText(e.target.value)}
                        rows={12}
                        maxLength={40000}
                        aria-labelledby="job-description-title"
                        placeholder="Paste the job description here. Or write a few lines about the job and choose Draft from notes."
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={assisting === 'generate'}
                          disabled={assisting !== null || savingJdText}
                          onClick={() => void onAssistJd('generate')}
                        >
                          <Sparkles aria-hidden strokeWidth={1.5} />
                          Draft from notes
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={assisting === 'format'}
                          disabled={assisting !== null || savingJdText}
                          onClick={() => void onAssistJd('format')}
                        >
                          Clean up formatting
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={jdDirty ? 'primary' : 'secondary'}
                          className="sm:ml-auto"
                          loading={savingJdText}
                          disabled={assisting !== null}
                          onClick={() => void onSaveJdText()}
                        >
                          Save description
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      <FileInput
                        accept={ACCEPT_DOCUMENT}
                        maxBytes={MAX_FILE_BYTES}
                        multiple
                        variant="dropzone"
                        onFilesChange={setJdFiles}
                        emptyLabel="Drop a PDF, Word or PowerPoint file here, up to 10 MB"
                        aria-label="Job description files"
                      />
                      {jdFiles.length > 1 ? (
                        <ul role="list" className="m-0 list-none space-y-1 p-0 text-meta text-text-2">
                          {jdFiles.map((f) => (
                            <li key={`${f.name}-${f.size}`} className="flex gap-2">
                              <span className="min-w-0 truncate">{f.name}</span>
                              <span className="shrink-0 tabular-nums text-text-3">{formatBytes(f.size)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <Button
                        type="button"
                        className="justify-self-start"
                        variant={jdFiles.length > 0 ? 'primary' : 'secondary'}
                        loading={uploadingJd}
                        disabled={jdFiles.length === 0}
                        onClick={() => void onUploadJd()}
                      >
                        <Upload aria-hidden strokeWidth={1.5} />
                        Upload to this job
                      </Button>
                    </div>
                  )}
                  {jdError ? (
                    <Alert kind="error" className="mt-4">
                      {jdError}
                    </Alert>
                  ) : null}
                </>
              ) : savedDescription ? (
                <p className="m-0 max-w-[75ch] whitespace-pre-wrap text-text">{savedDescription}</p>
              ) : (
                <p className="m-0 text-text-2">
                  {readiness.description === 'missing'
                    ? 'No description yet. Ask someone who can edit this job to add it.'
                    : 'The description is in the documents below.'}
                </p>
              )}
              {readiness.description === 'preparing' ? (
                <Alert kind="info" className="mt-4">
                  Reading your file. Calls can use it once it shows Ready.
                </Alert>
              ) : null}
              {jobKnowledge.length > 0 ? <Documents sources={jobKnowledge} /> : null}
            </SetupCard>

            <SetupCard
              id="questions"
              step={canEdit ? 2 : undefined}
              title="Must-ask questions"
              description="The agent asks each of these on every call. Leave the list empty and it asks the questions set on the agent."
              badge={
                canEdit && questionsDirty ? (
                  <UnsavedBadge />
                ) : savedQuestions.length > 0 ? (
                  <StatusBadge tone="success" icon={CircleCheck}>
                    {savedQuestions.length} saved
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="neutral" icon={CircleDashed}>
                    Optional
                  </StatusBadge>
                )
              }
            >
              {canEdit ? (
                <>
                  {questions.length > 0 ? (
                    <ol role="list" className="m-0 grid list-none gap-2 p-0">
                      {questions.map((q, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span aria-hidden className="w-5 shrink-0 pt-3 text-right text-label tabular-nums text-text-3">
                            {i + 1}
                          </span>
                          <Textarea
                            ref={(el) => {
                              questionInputs.current[i] = el;
                            }}
                            rows={1}
                            value={q}
                            // One question per box: a pasted line break becomes a space.
                            onChange={(e) => {
                              const text = e.target.value.replace(/\s*\n\s*/g, ' ');
                              setQuestions((qs) => qs.map((x, j) => (j === i ? text : x)));
                            }}
                            // Enter moves to the next question, or starts one after the last.
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                              e.preventDefault();
                              if (i < questions.length - 1) focusQuestion(i + 1);
                              else if (q.trim() && questions.length < MAX_QUESTIONS) addQuestion();
                            }}
                            aria-label={`Question ${i + 1}`}
                            maxLength={300}
                            placeholder="For example, what is your notice period?"
                            className="min-h-11 resize-none overflow-hidden [field-sizing:content]"
                          />
                          <IconButton
                            label={`Remove question ${i + 1}`}
                            variant="quiet"
                            onClick={() => removeQuestion(i)}
                          >
                            <X aria-hidden strokeWidth={1.5} />
                          </IconButton>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="m-0 rounded-card-sm border border-dashed border-border-input px-4 py-5 text-center text-text-2">
                      No must-ask questions yet. Add your own, or let the description suggest some.
                    </p>
                  )}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                      ref={addQuestionButton}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={questions.length >= MAX_QUESTIONS}
                      onClick={addQuestion}
                    >
                      <Plus aria-hidden strokeWidth={1.5} />
                      Add question
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={assisting === 'questions'}
                      disabled={assisting !== null || savingScreening}
                      onClick={() => void onAssistJd('questions')}
                    >
                      <Sparkles aria-hidden strokeWidth={1.5} />
                      Suggest from the description
                    </Button>
                    {questions.length > 1 ? (
                      <Button
                        type="button"
                        variant="tertiary"
                        size="sm"
                        onClick={() => {
                          const removed = questions;
                          setQuestions([]);
                          focusQuestion(null);
                          toastUndo(`Removed ${removed.length} questions`, () => setQuestions(removed), {
                            description: 'Nothing is saved until you save the questions.',
                          });
                        }}
                      >
                        Remove all
                      </Button>
                    ) : null}
                  </div>
                  {questionsError ? (
                    <Alert kind="error" className="mt-4">
                      {questionsError}
                    </Alert>
                  ) : null}
                  <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-end sm:justify-between">
                    <Field
                      label="Call language"
                      hint="The agent speaks this on calls for this job."
                      className="sm:w-64"
                    >
                      <Select
                        value={screeningLanguage}
                        onChange={(e) => setScreeningLanguage(isScreeningLanguage(e.target.value) ? e.target.value : 'en')}
                      >
                        {(Object.keys(SCREENING_LANGUAGE_LABEL) as ScreeningLanguage[]).map((code) => (
                          <option key={code} value={code}>
                            {SCREENING_LANGUAGE_LABEL[code]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button
                      type="button"
                      variant={questionsDirty ? 'primary' : 'secondary'}
                      className="sm:mb-6"
                      loading={savingScreening}
                      onClick={() => void onSaveScreening()}
                    >
                      Save questions
                    </Button>
                  </div>
                </>
              ) : savedQuestions.length > 0 ? (
                <>
                  <ol className="m-0 list-decimal space-y-2 pl-5 text-text marker:tabular-nums marker:text-text-3">
                    {savedQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ol>
                  <p className="mb-0 mt-4 text-meta text-text-3">
                    Calls are in {SCREENING_LANGUAGE_LABEL[savedLanguage]}.
                  </p>
                </>
              ) : (
                <p className="m-0 text-text-2">
                  No must-ask questions. The agent asks the questions set on the agent.
                </p>
              )}
            </SetupCard>

            <SetupCard
              id="requirements"
              step={canEdit ? 3 : undefined}
              title="Requirements"
              description="What the role needs. After each call, the answers are checked against these, so candidates sort into Meets all, Check and Doesn’t meet. You decide who moves forward."
              badge={
                canEdit && reqDirty ? (
                  <UnsavedBadge />
                ) : readiness.requirements > 0 ? (
                  <StatusBadge tone="success" icon={CircleCheck}>
                    {readiness.requirements} set
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="neutral" icon={CircleDashed}>
                    Optional
                  </StatusBadge>
                )
              }
            >
              {canEdit ? (
                <RequirementsEditor
                  jobId={jobId}
                  form={requirementsForm}
                  setForm={setRequirementsForm}
                  dirty={reqDirty}
                  hasDescription={savedDescription.length >= 20}
                  onSaved={(requirements) => setJob((j) => (j ? { ...j, requirements } : j))}
                />
              ) : (
                <RequirementsSummary requirements={job.requirements} />
              )}
            </SetupCard>

            <SetupCard
              id="agent"
              step={canEdit ? 4 : undefined}
              title="AI hiring agent"
              description="Makes the calls for this job, in its own voice."
              badge={
                job.agentId && agentLive !== null ? (
                  <StatusTag domain="agent" value={agentStatus} />
                ) : !job.agentId ? (
                  <StatusBadge tone="neutral" icon={Circle}>
                    Not chosen
                  </StatusBadge>
                ) : null
              }
            >
              <div className="flex flex-wrap items-center gap-4 rounded-card-sm border border-border bg-subtle p-4">
                <Agent size={48} colour="glass" onLight />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="m-0 truncate font-medium text-text">
                    {job.agentId ? (linkedAgent?.name ?? 'The agent on this job') : 'No agent chosen yet'}
                  </p>
                  <p className="m-0 mt-0.5 text-meta text-text-3">
                    {!job.agentId
                      ? agents === null || agents.length > 0
                        ? 'Choose which agent calls for this job.'
                        : `Set one up once. It calls ${contacts} for every job you give it.`
                      : agentStatus === 'unknown'
                        ? 'Couldn’t check this agent. Reload the page to try again.'
                        : agentLive === null
                          ? 'Checking the agent…'
                          : agentLive
                            ? line === 'connected'
                              ? 'Live and ready to call.'
                              : 'Live. Ready for test calls in your browser.'
                            : 'Not live yet. Publish it before calling.'}
                  </p>
                </div>
                {job.agentId ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/agents/${toPublicId(job.agentId)}`}>
                      {agentLive === false ? 'Publish agent' : 'Agent settings'}
                    </Link>
                  </Button>
                ) : agents?.length === 0 ? (
                  <Button asChild size="sm">
                    <Link href="/agents/new">Set up agent</Link>
                  </Button>
                ) : null}
              </div>
              {canEdit && agents && (job.agentId ? otherAgents.length > 0 : agents.length > 0) ? (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field label={job.agentId ? 'Change the agent' : 'Agent for this job'} className="min-w-0 flex-1">
                    <Select value={linkAgentId} onChange={(e) => setLinkAgentId(e.target.value)}>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.status === 'published' ? '' : ' (not live)'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant={job.agentId ? 'secondary' : 'primary'}
                    loading={linking}
                    disabled={!linkAgentId || linkAgentId === job.agentId}
                    onClick={() => void onLinkAgent()}
                  >
                    Use this agent
                  </Button>
                </div>
              ) : null}
            </SetupCard>
            {permissions.includes('integrations.read') ? (
              <CareersPagePanel jobId={jobId} jobTitle={job.title} permissions={permissions} />
            ) : null}
            {me.data?.isPlatformAdmin && job ? <EngineCard job={job} onChange={setJob} /> : null}
          </div>

          <ReadyPanel
            readiness={readiness}
            agentName={linkedAgent?.name}
            peopleTotal={peopleTotal}
            contact={labels.contact}
            boardHref={`/jobs/${toPublicId(jobId)}/candidates`}
            canEdit={canEdit}
            changingStatus={changingStatus}
            onStatus={(s) => void onJobStatusChange(s)}
          />
        </div>
      </PageMain>
    </AppShell>
  );
}

function SetupCard({
  id,
  step,
  title,
  description,
  badge,
  children,
}: {
  id: string;
  /** The step's number, for people who can edit the job. */
  step?: number;
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 rounded-card border border-border bg-canvas p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        {step ? (
          // Home's first-run step marker.
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-pill border border-border bg-subtle text-label font-semibold tabular-nums text-text-2"
          >
            {step}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2 id={`${id}-title`} className="m-0 text-section text-text">
              {title}
            </h2>
            {badge}
          </div>
          <p className="mb-0 mt-1 max-w-[65ch] text-text-2">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Platform admin only: which voice engine phones this job's candidates (the A/B arms). */
function EngineCard({ job, onChange }: { job: Job; onChange: (job: Job) => void }) {
  const [saving, setSaving] = useState(false);
  const current = job.voiceEngine ?? GOOGLE_VOICE_ENGINE;
  const persona = job.voicePersona ?? 'kore';
  const ttsModel = job.ttsModel ?? 'gemini_flash';
  async function pick(engine: VoiceEngine, voice: { persona?: VoicePersona; ttsModel?: TtsModel } = {}) {
    setSaving(true);
    try {
      await setJobEngine(job.id, engine, voice);
      onChange({ ...job, voiceEngine: engine, ...(voice.persona ? { voicePersona: voice.persona } : {}), ...(voice.ttsModel ? { ttsModel: voice.ttsModel } : {}) });
      toast.success(
        voice.persona
          ? `Calls for this job now use the ${PERSONA_LABEL[voice.persona]} voice`
          : voice.ttsModel
            ? `Calls for this job now use ${TTS_MODEL_LABEL[voice.ttsModel]}`
            : `Calls for this job now use: ${ENGINE_LABEL[engine]}`,
      );
    } catch (err) {
      toast.error(toUserMessage(err).detail);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-labelledby="engine-title" className="rounded-card border border-border bg-canvas p-5 sm:p-6">
      <h2 id="engine-title" className="m-0 text-section text-text">
        Voice engine
      </h2>
      <p className="m-0 mt-1 text-meta text-text-3">Only platform admins see this. New calls use the engine picked here.</p>
      <Field label="Engine" htmlFor="voice-engine" className="mt-4">
        <Select id="voice-engine" value={current} disabled={saving} onChange={(e) => void pick(e.target.value as VoiceEngine)}>
          {(Object.keys(ENGINE_LABEL) as VoiceEngine[]).map((e) => (
            <option key={e} value={e}>
              {ENGINE_LABEL[e]}
            </option>
          ))}
        </Select>
      </Field>
      {current === GOOGLE_VOICE_ENGINE ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Voice" htmlFor="voice-persona">
            <Select
              id="voice-persona"
              value={persona}
              disabled={saving}
              onChange={(e) => void pick(current, { persona: e.target.value as VoicePersona })}
            >
              {(Object.keys(PERSONA_LABEL) as VoicePersona[]).map((p) => (
                <option key={p} value={p}>
                  {PERSONA_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Voice model" htmlFor="tts-model">
            <Select
              id="tts-model"
              value={ttsModel}
              disabled={saving}
              onChange={(e) => void pick(current, { ttsModel: e.target.value as TtsModel })}
            >
              {(Object.keys(TTS_MODEL_LABEL) as TtsModel[]).map((m) => (
                <option key={m} value={m}>
                  {TTS_MODEL_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </section>
  );
}

function UnsavedBadge() {
  return (
    <StatusBadge tone="warning" icon={PenLine}>
      Not saved yet
    </StatusBadge>
  );
}

/** The job's documents: pasted text is kept as one too. */
function Documents({ sources }: { sources: JobKnowledgeSource[] }) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="m-0 text-label font-medium text-text">Documents on this job</h3>
      <ul role="list" className="m-0 mt-2 list-none space-y-2 p-0">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center gap-2 text-text-2">
              <FileText aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-text-3" />
              <span className="min-w-0 truncate">{s.name}</span>
            </span>
            {s.pendingDocs > 0 ? (
              <StatusBadge tone="info" icon={Hourglass}>
                Reading
              </StatusBadge>
            ) : s.readyDocs > 0 ? (
              <StatusBadge tone="success">Ready</StatusBadge>
            ) : s.failedDocs > 0 ? (
              <StatusBadge tone="danger">Couldn’t read the file</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">No files yet</StatusBadge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyPanel({
  readiness: r,
  agentName,
  peopleTotal,
  contact,
  boardHref,
  canEdit,
  changingStatus,
  onStatus,
}: {
  readiness: ReturnType<typeof jobReadiness>;
  agentName?: string;
  peopleTotal: number | null;
  contact: { one: string; many: string };
  boardHref: string;
  canEdit: boolean;
  changingStatus: JobStatus | null;
  onStatus: (status: JobStatus) => void;
}) {
  const steps: { anchor: string; href?: string; label: string; done: boolean; optional?: boolean; detail: string }[] = [
    {
      anchor: 'job-description',
      label: 'Job description',
      done: r.description === 'saved',
      detail: { saved: 'Saved', preparing: 'Reading your file', missing: 'Not added yet' }[r.description],
    },
    {
      anchor: 'questions',
      label: 'Must-ask questions',
      done: r.questions > 0,
      optional: true,
      detail: r.questions > 0 ? `${r.questions} saved` : 'Optional',
    },
    {
      anchor: 'requirements',
      label: 'Requirements',
      done: r.requirements > 0,
      optional: true,
      detail: r.requirements > 0 ? `${r.requirements} set` : 'Add requirements to sort candidates',
    },
    {
      anchor: 'agent',
      label: 'AI hiring agent',
      done: r.agent === 'live',
      detail: {
        live: agentName ? `${agentName}, live` : 'Live',
        'not-live': 'Not live yet',
        missing: 'Not chosen yet',
        checking: 'Checking…',
      }[r.agent],
    },
    {
      anchor: 'calling-number',
      href: '/settings?section=workspace',
      label: 'Calling number',
      done: r.line === 'connected',
      detail: {
        connected: 'Connected',
        'not-connected': 'Not connected yet',
        checking: 'Checking…',
        unknown: 'Not checked',
      }[r.line],
    },
    {
      anchor: 'job-status',
      label: 'Open for calls',
      done: r.status === 'open',
      detail:
        r.status === 'open'
          ? (jobStatusLabel(r) ?? 'Open')
          : r.status === 'closed'
            ? 'Closed'
            : 'Still a draft',
    },
  ];
  const required = steps.filter((s) => !s.optional);
  const others = (['open', 'draft', 'closed'] as const).filter((s) => s !== r.status);

  return (
    <aside
      aria-labelledby="ready-title"
      className="rounded-card border border-border bg-canvas p-5 sm:p-6 lg:sticky lg:top-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ready-title" className="m-0 text-section text-text">
          Before you call
        </h2>
        <p className="m-0 text-label tabular-nums text-text-2">
          {required.filter((s) => s.done).length} of {required.length} done
        </p>
      </div>
      <ul role="list" className="m-0 mt-3 list-none p-0">
        {steps.map((step) => {
          const Icon = step.done ? CircleCheck : step.optional ? CircleDashed : Circle;
          return (
            <li key={step.anchor}>
              <Link
                href={step.href ?? `#${step.anchor}`}
                className="-mx-2 flex min-h-12 items-center gap-3 rounded-input px-2 py-1.5 text-text no-underline transition-colors duration-fast hover:bg-subtle"
              >
                <Icon
                  aria-hidden
                  strokeWidth={1.75}
                  className={cn('size-5 shrink-0', step.done ? 'text-status-success-text' : 'text-text-3')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-label font-medium">{step.label}</span>
                  <span className="block truncate text-meta text-text-3">{step.detail}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* The handoff: calls start from the job's candidates. */}
      <div className="mt-4 border-t border-border pt-4">
        {peopleTotal !== null ? (
          <p className="m-0 text-meta text-text-3">
            {peopleTotal === 0
              ? `No ${contact.many.toLowerCase()} on this job yet. Add them, then call them from the list.`
              : `${peopleTotal} ${(peopleTotal === 1 ? contact.one : contact.many).toLowerCase()} on this job.${r.ready ? ' Call them from the list.' : ''}`}
          </p>
        ) : null}
        <Button asChild variant={r.ready ? 'primary' : 'secondary'} className={cn('w-full', peopleTotal !== null && 'mt-3')}>
          <Link href={boardHref}>
            {peopleTotal === 0 ? `Add ${contact.many.toLowerCase()}` : `Go to ${contact.many.toLowerCase()}`}
            <ArrowRight aria-hidden strokeWidth={1.5} />
          </Link>
        </Button>
      </div>

      <div id="job-status" className="mt-4 scroll-mt-6 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-label font-medium text-text">Job status</h3>
          <StatusTag domain="job" value={jobStatusLabel(r) ? 'open_test_only' : r.status} />
        </div>
        {canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {others.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={s === 'open' ? (r.ready ? 'primary' : 'secondary') : 'tertiary'}
                loading={changingStatus === s}
                disabled={changingStatus !== null && changingStatus !== s}
                onClick={() => onStatus(s)}
              >
                {s === 'open' && r.status === 'closed' ? 'Reopen for calls' : JOB_STATUS_ACTION[s]}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** Header, tabs and the cards, as the page draws them. */
function SetupSkeleton() {
  return (
    <SkeletonRecord>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          {['h-[26rem]', 'h-72'].map((h) => (
            <div key={h} className={cn('rounded-card border border-border p-6', h)}>
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-pill" />
                <Skeleton className="h-4 w-48 rounded-pill" />
              </div>
              <Skeleton className="mt-6 h-40 w-full" />
            </div>
          ))}
        </div>
        <div className="h-80 rounded-card border border-border p-6">
          <Skeleton className="h-4 w-40 rounded-pill" />
          <div className="mt-6 space-y-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-3 w-3/4 rounded-pill" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRecord>
  );
}
