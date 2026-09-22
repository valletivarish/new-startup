'use client';

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../components/AppShell';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogClose,
} from '../../../../components/ui/dialog';
import { Field, FileInput, Input, Select, Textarea } from '../../../../components/ui/input';
import { EmptyState, Notice, PageHeader, PageMain, Surface } from '../../../../components/ui/page';
import { SkeletonPage } from '../../../../components/ui/skeleton';
import {
  DataList,
  DataListBody,
  DataListHeader,
  DataListMeta,
  DataListRow,
  DataListTitle,
} from '../../../../components/ui/list';
import { UserPlus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PhoneField } from '../../../../components/PhoneField';
import {
  CandidateDetailSheet,
  type CandidateSheetTab,
} from '../../../../components/candidates';
import {
  ApiClientError,
  confirmCandidateImport,
  createCandidate,
  formatApiError,
  getAgent,
  getJob,
  getTelephonyStatus,
  listJobCandidates,
  listJobKnowledge,
  listCandidateStageHistory,
  me,
  previewCandidateImport,
  reconcileVoiceSession,
  startOutboundCall,
  updateCandidate,
  bulkUpdateJobCandidateStatus,
  type CandidateImportRow,
  type CandidateStageHistoryEvent,
  type Job,
  type JobCandidateAssignment,
  type Me,
} from '../../../../lib/api';
import { loginPathForReturn } from '../../../../lib/auth-redirect';
import { fromPublicId, toPublicId } from '../../../../lib/public-id';
import {
  CALL_STATUS_LABEL,
  JOB_STATUS_LABEL,
  PIPELINE_STATUS_LABEL,
  labelImportIssues,
} from '../../../../lib/status-labels';
import {
  ACCEPT_DOCUMENT,
  fileToBase64,
  resolveUploadContentType,
} from '../../../../lib/upload';

const ASSIGNMENT_STATUSES = ['new', 'screening', 'reviewed'] as const;
const PEOPLE_PAGE_SIZE = 40;

type LiveOutbound = {
  voiceSessionId: string;
  agentId: string;
  status: string;
};

export default function JobCandidatesPage() {
  return (
    <Suspense
      fallback={
        <AppShell profile={null}>
          <PageMain>
            <SkeletonPage rows={6} />
          </PageMain>
        </AppShell>
      }
    >
      <JobCandidatesPageInner />
    </Suspense>
  );
}

function JobCandidatesPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const jobId = fromPublicId(params.id) ?? params.id;
  const jobPublicId = toPublicId(jobId);
  const selectedCandidateParam = searchParams.get('c');
  const selectedCandidateId = fromPublicId(selectedCandidateParam);

  const [profile, setProfile] = useState<Me | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [assignments, setAssignments] = useState<JobCandidateAssignment[]>([]);
  const [addFullName, setAddFullName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addResumeText, setAddResumeText] = useState('');
  const [addResumeFile, setAddResumeFile] = useState<File | null>(null);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [importText, setImportText] = useState('');
  const [importRows, setImportRows] = useState<CandidateImportRow[] | null>(null);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    valid: number;
    invalid: number;
  } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentPublished, setAgentPublished] = useState(false);
  const [docsPreparing, setDocsPreparing] = useState(false);
  const [callNoticeByCandidate, setCallNoticeByCandidate] = useState<
    Record<string, { kind: 'ok' | 'err'; text: string }>
  >({});
  const [screenCandidate, setScreenCandidate] = useState<{
    id: string;
    fullName: string;
  } | null>(null);
  const [outboundPhone, setOutboundPhone] = useState(false);
  const [openOutbound, setOpenOutbound] = useState(false);
  const [telephonyMessage, setTelephonyMessage] = useState<string | null>(null);
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [savingPhoneId, setSavingPhoneId] = useState<string | null>(null);
  const [callingCandidateId, setCallingCandidateId] = useState<string | null>(null);
  const [openAskCandidateId, setOpenAskCandidateId] = useState<string | null>(
    null,
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [listCursor, setListCursor] = useState(0);
  const [peoplePage, setPeoplePage] = useState(0);
  const [peoplePageCursors, setPeoplePageCursors] = useState<
    (string | undefined)[]
  >([undefined]);
  const [nextPeopleCursor, setNextPeopleCursor] = useState<string | null>(
    null,
  );
  const [pipelineTotals, setPipelineTotals] = useState({
    all: 0,
    new: 0,
    screening: 0,
    reviewed: 0,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBulkStatus, setPendingBulkStatus] = useState<
    (typeof ASSIGNMENT_STATUSES)[number] | null
  >(null);
  const [bulkConfirmText, setBulkConfirmText] = useState('');
  const [sheetStageReason, setSheetStageReason] = useState('');
  const [bulkStageReason, setBulkStageReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stageHistory, setStageHistory] = useState<
    CandidateStageHistoryEvent[]
  >([]);
  const [stageHistoryLoading, setStageHistoryLoading] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleQueryDraft, setPeopleQueryDraft] = useState('');
  const [callFilter, setCallFilter] = useState<
    'all' | 'not_called' | 'calling' | 'completed' | 'failed'
  >('all');
  const stageParam = searchParams.get('stage');
  const pipelineFilter: 'all' | (typeof ASSIGNMENT_STATUSES)[number] =
    stageParam === 'new' ||
    stageParam === 'screening' ||
    stageParam === 'reviewed'
      ? stageParam
      : 'all';
  const [sheetTab, setSheetTab] = useState<CandidateSheetTab>('overview');
  const [liveOutboundByCandidate, setLiveOutboundByCandidate] = useState<
    Record<string, LiveOutbound>
  >({});
  const outboundInFlight = useRef<Set<string>>(new Set());

  function setPipelineFilter(key: 'all' | (typeof ASSIGNMENT_STATUSES)[number]) {
    setPeoplePage(0);
    setPeoplePageCursors([undefined]);
    setNextPeopleCursor(null);
    setListCursor(0);
    setSelectedIds(new Set());
    const q = new URLSearchParams(searchParams.toString());
    if (key === 'all') q.delete('stage');
    else q.set('stage', key);
    const qs = q.toString();
    router.replace(
      `/jobs/${jobPublicId}/candidates${qs ? `?${qs}` : ''}`,
      { scroll: false },
    );
  }

  function openCandidate(
    candidateId: string,
    opts?: { tab?: CandidateSheetTab },
  ) {
    const row = assignments.find((a) => a.candidateId === candidateId);
    const tab =
      opts?.tab ??
      (row?.callStatus === 'completed' || row?.callStatus === 'failed'
        ? 'results'
        : 'overview');
    setSheetTab(tab);
    const q = new URLSearchParams(searchParams.toString());
    q.set('c', toPublicId(candidateId));
    router.replace(`/jobs/${jobPublicId}/candidates?${q.toString()}`, {
      scroll: false,
    });
  }

  function closeCandidate() {
    const q = new URLSearchParams(searchParams.toString());
    q.delete('c');
    const qs = q.toString();
    router.replace(
      `/jobs/${jobPublicId}/candidates${qs ? `?${qs}` : ''}`,
      { scroll: false },
    );
  }

  const pagedAssignments = useMemo(() => {
    if (callFilter === 'all') return assignments;
    return assignments.filter(
      (row) => (row.callStatus ?? 'not_called') === callFilter,
    );
  }, [assignments, callFilter]);

  useEffect(() => {
    setListCursor((c) =>
      Math.min(c, Math.max(0, pagedAssignments.length - 1)),
    );
  }, [pagedAssignments.length]);

  const selectedVisibleIndex = useMemo(() => {
    if (!selectedCandidateId) return -1;
    return pagedAssignments.findIndex(
      (a) => a.candidateId === selectedCandidateId,
    );
  }, [pagedAssignments, selectedCandidateId]);

  function goRelativeCandidate(delta: number) {
    if (pagedAssignments.length === 0) return;
    const from =
      selectedVisibleIndex >= 0 ? selectedVisibleIndex : listCursor;
    const nextIdx = Math.min(
      Math.max(from + delta, 0),
      pagedAssignments.length - 1,
    );
    const next = pagedAssignments[nextIdx];
    if (next) {
      setListCursor(nextIdx);
      openCandidate(next.candidateId);
    }
  }

  function toggleSelected(candidateId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  async function requestBulkStatus(
    status: (typeof ASSIGNMENT_STATUSES)[number],
  ) {
    if (selectedIds.size >= 24) {
      setPendingBulkStatus(status);
      setBulkConfirmText('');
      return;
    }
    await bulkStatus(status);
  }

  async function bulkStatus(status: (typeof ASSIGNMENT_STATUSES)[number]) {
    const ids = [...selectedIds];
    if (ids.length === 0 || !can('jobs.update') || bulkBusy) return;
    const updates = ids
      .map((candidateId) => {
        const row = assignments.find((a) => a.candidateId === candidateId);
        if (!row) return null;
        const previous = row.status as (typeof ASSIGNMENT_STATUSES)[number];
        if (
          previous !== 'new' &&
          previous !== 'screening' &&
          previous !== 'reviewed'
        ) {
          return null;
        }
        if (previous === status) return null;
        return { candidateId, status, previous, name: row.candidate.fullName };
      })
      .filter((u): u is NonNullable<typeof u> => u != null);
    if (updates.length === 0) {
      setSelectedIds(new Set());
      setPendingBulkStatus(null);
      return;
    }
    setBulkBusy(true);
    try {
      await applyCandidateStatuses(
        updates,
        `${updates.length} ${updates.length === 1 ? 'person' : 'people'} → ${PIPELINE_STATUS_LABEL[status]}`,
        bulkStageReason,
      );
      setSelectedIds(new Set());
      setPendingBulkStatus(null);
      setBulkConfirmText('');
      setBulkStageReason('');
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (selectedCandidateId) {
        if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
          e.preventDefault();
          goRelativeCandidate(1);
        } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
          e.preventDefault();
          goRelativeCandidate(-1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeCandidate();
        }
        return;
      }
      if (pagedAssignments.length === 0) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(pagedAssignments.map((a) => a.candidateId)));
        return;
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        const row = pagedAssignments[listCursor];
        if (row) toggleSelected(row.candidateId);
        return;
      }
      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
        return;
      }
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        e.preventDefault();
        setListCursor((i) =>
          Math.min(i + 1, pagedAssignments.length - 1),
        );
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault();
        setListCursor((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = pagedAssignments[listCursor];
        if (row) openCandidate(row.candidateId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCandidateId,
    selectedVisibleIndex,
    pagedAssignments,
    listCursor,
    selectedIds.size,
  ]);

  useEffect(() => {
    if (!selectedCandidateId) {
      setStageHistory([]);
      return;
    }
    void refreshStageHistory(selectedCandidateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidateId, jobId]);

  const reloadJobKnowledge = useCallback(async () => {
    try {
      const { sources } = await listJobKnowledge(jobId);
      const pending = sources.reduce((n, s) => n + s.pendingDocs, 0);
      setDocsPreparing(pending > 0);
    } catch {
      setDocsPreparing(false);
    }
  }, [jobId]);

  const fetchPeoplePage = useCallback(
    async (cursor?: string) => {
      const status =
        pipelineFilter === 'all' ? undefined : pipelineFilter;
      const res = await listJobCandidates(jobId, {
        limit: PEOPLE_PAGE_SIZE,
        cursor,
        status,
        q: peopleQuery.trim() || undefined,
      });
      setAssignments(res.candidates);
      setPipelineTotals(res.totals);
      setNextPeopleCursor(res.nextCursor);
    },
    [jobId, pipelineFilter, peopleQuery],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = peopleQueryDraft.trim();
      if (next === peopleQuery) return;
      setPeopleQuery(next);
      setPeoplePage(0);
      setPeoplePageCursors([undefined]);
      setNextPeopleCursor(null);
      setListCursor(0);
      setSelectedIds(new Set());
    }, 280);
    return () => window.clearTimeout(handle);
  }, [peopleQueryDraft, peopleQuery]);

  useEffect(() => {
    if (!profile) return;
    void fetchPeoplePage(undefined).catch(() => {
      setAssignments([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleQuery]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await me();
      setProfile(p);
      try {
        const j = await getJob(jobId);
        setJob(j);
        void reloadJobKnowledge();

        const perms = new Set(p.activeOrganization?.permissions ?? []);
        if (perms.has('agents.test') || perms.has('calls.initiate')) {
          try {
            const tel = await getTelephonyStatus();
            setOutboundPhone(tel.outboundPhone);
            setOpenOutbound(Boolean(tel.openOutbound));
            setTelephonyMessage(tel.message);
          } catch {
            setTelephonyMessage(
              (prev) =>
                prev ??
                'Could not check phone line status. Refresh the page, or try again in a moment.',
            );
          }
        }
        if (perms.has('candidates.read')) {
          try {
            await fetchPeoplePage(peoplePageCursors[peoplePage]);
          } catch {
            setAssignments([]);
            setNotice('Could not load candidates for this job.');
          }
        } else {
          setAssignments([]);
        }
      } catch (e) {
        setJob(null);
        setAssignments([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, router, reloadJobKnowledge, fetchPeoplePage, peoplePage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!profile) return;
    void fetchPeoplePage(peoplePageCursors[0]).catch(() => {
      setAssignments([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineFilter]);

  useEffect(() => {
    let cancelled = false;
    async function loadAgent() {
      if (!job?.agentId) {
        if (!cancelled) setAgentPublished(false);
        return;
      }
      try {
        const agent = await getAgent(job.agentId);
        if (!cancelled) setAgentPublished(agent.status === 'published');
      } catch {
        if (!cancelled) setAgentPublished(false);
      }
    }
    void loadAgent();
    return () => {
      cancelled = true;
    };
  }, [job?.agentId]);

  useEffect(() => {
    if (!docsPreparing) return;
    const id = window.setInterval(() => {
      void reloadJobKnowledge();
    }, 3000);
    return () => window.clearInterval(id);
  }, [docsPreparing, reloadJobKnowledge]);

  const liveOutboundEntries = Object.entries(liveOutboundByCandidate);
  const hasLiveOutbound = liveOutboundEntries.some(
    ([, s]) => s.status === 'pending' || s.status === 'active',
  );
  const liveOutboundRef = useRef(liveOutboundByCandidate);
  liveOutboundRef.current = liveOutboundByCandidate;

  useEffect(() => {
    if (!hasLiveOutbound) return;
    let cancelled = false;

    async function pollLive() {
      const entries = Object.entries(liveOutboundRef.current).filter(
        ([, s]) => s.status === 'pending' || s.status === 'active',
      );
      if (entries.length === 0) return;

      let anyTerminal = false;
      for (const [candidateId, live] of entries) {
        try {
          const { voiceSession } = await reconcileVoiceSession(
            live.agentId,
            live.voiceSessionId,
          );
          if (cancelled) return;
          setLiveOutboundByCandidate((prev) => {
            const cur = prev[candidateId];
            if (!cur || cur.voiceSessionId !== live.voiceSessionId) return prev;
            return {
              ...prev,
              [candidateId]: { ...cur, status: voiceSession.status },
            };
          });
          if (
            voiceSession.status === 'ended' ||
            voiceSession.status === 'failed'
          ) {
            anyTerminal = true;
            setCallNoticeByCandidate((prev) => ({
              ...prev,
              [candidateId]: {
                kind: voiceSession.status === 'failed' ? 'err' : 'ok',
                text:
                  voiceSession.status === 'failed'
                    ? 'Call failed. You can try again.'
                    : 'Call ended. Open screening results below.',
              },
            }));
          }
        } catch {
          // Keep last known status; next tick retries.
        }
      }
      if (!cancelled && anyTerminal) {
        try {
          await fetchPeoplePage(peoplePageCursors[peoplePage]);
        } catch {
          /* ignore — badge refresh is best-effort */
        }
      }
    }

    void pollLive();
    const id = window.setInterval(() => {
      void pollLive();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hasLiveOutbound, jobId]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canScreen = can('calls.initiate') || can('agents.test');

  async function onOutbound(candidateId: string) {
    if (outboundInFlight.current.has(candidateId)) return;
    if (!job?.agentId) {
      setCallNoticeByCandidate((prev) => ({
        ...prev,
        [candidateId]: {
          kind: 'err',
          text: 'This job has no hiring voice yet. Attach one before calling.',
        },
      }));
      return;
    }
    outboundInFlight.current.add(candidateId);
    setCallingCandidateId(candidateId);
    setCallNoticeByCandidate((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    setLiveOutboundByCandidate((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    try {
      const result = await startOutboundCall(jobId, candidateId);
      setLiveOutboundByCandidate((prev) => ({
        ...prev,
        [candidateId]: {
          voiceSessionId: result.voiceSessionId,
          agentId: job.agentId!,
          status: result.voiceSession?.status ?? 'pending',
        },
      }));
      setCallNoticeByCandidate((prev) => ({
        ...prev,
        [candidateId]: {
          kind: 'ok',
          text: 'Call started. Status updates here as the call progresses.',
        },
      }));
      await reload();
    } catch (e) {
      setCallNoticeByCandidate((prev) => ({
        ...prev,
        [candidateId]: {
          kind: 'err',
          text: formatApiError(e, 'Could not start phone call.'),
        },
      }));
    } finally {
      outboundInFlight.current.delete(candidateId);
      setCallingCandidateId(null);
    }
  }

  async function onSavePhone(candidateId: string) {
    const raw = phoneDrafts[candidateId] ?? '';
    const phone = raw.trim() || null;
    setSavingPhoneId(candidateId);
    try {
      await updateCandidate(candidateId, { phone });
      setNotice(phone ? 'Mobile saved.' : 'Mobile cleared.');
      setPhoneDrafts((prev) => {
        const next = { ...prev };
        delete next[candidateId];
        return next;
      });
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Could not save mobile.');
    } finally {
      setSavingPhoneId(null);
    }
  }

  async function onAddCandidate() {
    const fullName = addFullName.trim();
    if (!fullName) {
      setNotice('Enter the candidate name.');
      return;
    }
    const phone = addPhone.trim();
    if (!phone && !addResumeText.trim() && !addResumeFile) {
      setNotice('Add a mobile number (required for new candidates).');
      return;
    }
    setAddingCandidate(true);
    try {
      let resumeFile:
        | {
            name: string;
            contentType: string;
            content: string;
            contentEncoding: 'base64';
          }
        | undefined;
      if (addResumeFile) {
        resumeFile = {
          name: addResumeFile.name,
          contentType: resolveUploadContentType(addResumeFile),
          content: await fileToBase64(addResumeFile),
          contentEncoding: 'base64',
        };
      }
      await createCandidate({
        jobId,
        fullName,
        phone: phone || undefined,
        countryCode: '+91',
        resumeText: addResumeText.trim() || undefined,
        resumeFile,
      });
      setAddFullName('');
      setAddPhone('');
      setAddResumeText('');
      setAddResumeFile(null);
      setShowAddForm(false);
      setNotice('Candidate added to this job.');
      await reload();
    } catch (e) {
      setNotice(formatApiError(e, 'Could not add candidate.'));
    } finally {
      setAddingCandidate(false);
    }
  }

  async function onImportPreview() {
    const csvText = importText.trim();
    if (!csvText) {
      setNotice('Paste CSV rows or choose a CSV file first.');
      return;
    }
    setImportBusy(true);
    setNotice(null);
    try {
      const result = await previewCandidateImport(jobId, csvText);
      setImportRows(result.rows.map((r) => ({ ...r, issues: [...r.issues] })));
      setImportSummary(result.summary);
      setNotice(
        result.summary.valid === 0
          ? 'No valid rows yet. Fix highlighted fields, then preview again.'
          : `Ready to import ${result.summary.valid} of ${result.summary.total} rows.`,
      );
    } catch (e) {
      setNotice(formatApiError(e, 'Could not preview import.'));
    } finally {
      setImportBusy(false);
    }
  }

  async function onImportFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      setImportRows(null);
      setImportSummary(null);
    } catch {
      setNotice('Could not read that file.');
    }
  }

  function patchImportRow(
    rowIndex: number,
    patch: Partial<Pick<CandidateImportRow, 'fullName' | 'countryCode' | 'phone' | 'email'>>,
  ) {
    setImportRows((prev) => {
      if (!prev) return prev;
      return prev.map((row) => {
        if (row.rowIndex !== rowIndex) return row;
        const next = { ...row, ...patch };
        const issues: CandidateImportRow['issues'] = [];
        if (!next.fullName?.trim()) issues.push('missing_full_name');
        if (!next.countryCode?.trim()) issues.push('missing_country_code');
        if (!next.phone?.trim()) issues.push('missing_phone');
        for (const issue of row.issues) {
          if (
            issue === 'duplicate_in_batch' ||
            issue === 'duplicate_on_job' ||
            issue === 'invalid_phone' ||
            issue === 'invalid_email'
          ) {
            issues.push(issue);
          }
        }
        return { ...next, issues, valid: issues.length === 0 };
      });
    });
  }

  async function onImportConfirm() {
    if (!importRows) return;
    const validRows = importRows.filter((r) => r.valid && r.fullName && r.countryCode && r.phone);
    if (validRows.length === 0) {
      setNotice('No valid rows to import. Fix highlighted cells or preview again.');
      return;
    }
    setImportBusy(true);
    setNotice(null);
    try {
      const result = await confirmCandidateImport(
        jobId,
        validRows.map((r) => ({
          fullName: r.fullName!,
          countryCode: r.countryCode!,
          phone: r.phone!,
          ...(r.email ? { email: r.email } : {}),
        })),
      );
      const created = result.created.length;
      const skipped = result.skipped;
      setNotice(
        skipped > 0
          ? `Imported ${created} candidate${created === 1 ? '' : 's'}; skipped ${skipped} invalid or duplicate.`
          : `Imported ${created} candidate${created === 1 ? '' : 's'}.`,
      );
      const createdPhones = new Set(result.created.map((c) => c.phone));
      setImportRows((prev) => {
        if (!prev) return prev;
        const remaining = prev.filter(
          (r) => !(r.valid && r.phone && createdPhones.has(r.phone)),
        );
        setImportSummary({
          total: remaining.length,
          valid: remaining.filter((r) => r.valid).length,
          invalid: remaining.filter((r) => !r.valid).length,
        });
        return remaining.length > 0 ? remaining : null;
      });
      if (created > 0 && skipped === 0) {
        setImportText('');
        setShowImportForm(false);
      }
      await reload();
    } catch (e) {
      setNotice(formatApiError(e, 'Could not confirm import.'));
    } finally {
      setImportBusy(false);
    }
  }

  async function applyCandidateStatuses(
    updates: {
      candidateId: string;
      status: (typeof ASSIGNMENT_STATUSES)[number];
      previous: (typeof ASSIGNMENT_STATUSES)[number];
      name?: string;
    }[],
    message: string,
    reason?: string,
  ) {
    if (updates.length === 0) return;
    const snapshot = assignments;
    setAssignments((prev) =>
      prev.map((row) => {
        const hit = updates.find((u) => u.candidateId === row.candidateId);
        return hit ? { ...row, status: hit.status } : row;
      }),
    );
    try {
      await bulkUpdateJobCandidateStatus(
        jobId,
        updates.map((u) => ({
          candidateId: u.candidateId,
          status: u.status,
        })),
        reason,
      );
      toast.success(message, {
        duration: 8_000,
        action: {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              const reverse = updates.map((u) => ({
                candidateId: u.candidateId,
                status: u.previous,
                previous: u.status,
                name: u.name,
              }));
              setAssignments((prev) =>
                prev.map((row) => {
                  const hit = reverse.find(
                    (u) => u.candidateId === row.candidateId,
                  );
                  return hit ? { ...row, status: hit.status } : row;
                }),
              );
              try {
                await bulkUpdateJobCandidateStatus(
                  jobId,
                  reverse.map((u) => ({
                    candidateId: u.candidateId,
                    status: u.status,
                  })),
                  'Undone',
                );
                toast.success('Change undone.');
                if (selectedCandidateId) {
                  void refreshStageHistory(selectedCandidateId);
                }
              } catch {
                setAssignments(snapshot);
                toast.error('Could not undo. Refresh and try again.');
              }
            })();
          },
        },
      });
      if (
        selectedCandidateId &&
        updates.some((u) => u.candidateId === selectedCandidateId)
      ) {
        void refreshStageHistory(selectedCandidateId);
      }
    } catch (e) {
      setAssignments(snapshot);
      const err =
        e instanceof ApiClientError ? e.message : 'Could not update status.';
      setNotice(err);
      toast.error(err);
    }
  }

  async function refreshStageHistory(candidateId: string) {
    setStageHistoryLoading(true);
    try {
      const { events } = await listCandidateStageHistory(jobId, candidateId);
      setStageHistory(events);
    } catch {
      setStageHistory([]);
    } finally {
      setStageHistoryLoading(false);
    }
  }

  async function onAssignmentStatusChange(
    candidateId: string,
    status: (typeof ASSIGNMENT_STATUSES)[number],
  ) {
    const row = assignments.find((a) => a.candidateId === candidateId);
    if (!row) return;
    const previous = row.status as (typeof ASSIGNMENT_STATUSES)[number];
    if (
      previous !== 'new' &&
      previous !== 'screening' &&
      previous !== 'reviewed'
    ) {
      return;
    }
    if (previous === status) return;
    await applyCandidateStatuses(
      [
        {
          candidateId,
          status,
          previous,
          name: row.candidate.fullName,
        },
      ],
      `${row.candidate.fullName} → ${PIPELINE_STATUS_LABEL[status]}`,
      sheetStageReason,
    );
    setSheetStageReason('');
  }

  if (!profile || !job) {
    return (
      <AppShell profile={profile}>
        <PageMain>
          {loading ? (
            <SkeletonPage rows={6} />
          ) : (
            <>
              <Link href={`/jobs/${jobPublicId}`} className="text-sm text-[var(--accent)] no-underline hover:underline">
                Back to job
              </Link>
              {notice && (
                <Notice kind="err">
                  {notice}
                </Notice>
              )}
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
          description="People on this role — call, review, and move them forward."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(job.status)}>
                {JOB_STATUS_LABEL[job.status] ?? job.status}
              </Badge>
              {can('candidates.create') ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setShowAddForm(true);
                      setShowImportForm(false);
                    }}
                  >
                    Add person
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowImportForm(true);
                      setShowAddForm(false);
                    }}
                  >
                    Bulk upload
                  </Button>
                </>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <Link href={`/jobs/${jobPublicId}`}>Job setup</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/jobs">All jobs</Link>
              </Button>
            </div>
          }
        />

        <p className="m-0 -mt-4 mb-2 text-sm text-[var(--foreground-tertiary)]">
          <Link
            href="/jobs"
            className="text-[var(--accent)] no-underline hover:underline"
          >
            Jobs
          </Link>
          <span className="mx-1.5 text-[var(--foreground-muted)]">/</span>
          <span>{job.title}</span>
          <span className="mx-1.5 text-[var(--foreground-muted)]">/</span>
          <span>People</span>
        </p>
        {notice ? <Notice kind="ok">{notice}</Notice> : null}

        {docsPreparing ? (
          <Notice kind="warn">
            Job description documents are still preparing. You can screen now,
            but the call may miss role context until they show Ready.
          </Notice>
        ) : null}

        {can('candidates.create') ? (
          <Dialog
            open={showAddForm}
            onOpenChange={(open) => {
              setShowAddForm(open);
              if (open) setShowImportForm(false);
            }}
          >
            <DialogContent
              className="top-[10%] max-h-[min(86vh,880px)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto p-5"
              aria-describedby={undefined}
            >
              <div className="pr-8">
                <h2 className="m-0 font-display text-lg font-semibold tracking-tight">
                  Add a candidate
                </h2>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                  People belong to this job only. Phone is required.
                </p>
              </div>
              <div className="mt-4 grid gap-3">
                <Field label="Full name">
                  <Input
                    value={addFullName}
                    onChange={(e) => setAddFullName(e.target.value)}
                  />
                </Field>
                <Field label="Mobile">
                  <PhoneField
                    value={addPhone}
                    onChange={setAddPhone}
                    aria-label="Candidate mobile"
                    placeholder="Mobile number"
                  />
                </Field>
                <Field label="Resume file (optional)">
                  <FileInput
                    accept={ACCEPT_DOCUMENT}
                    onFileChange={setAddResumeFile}
                    emptyLabel="Optional — PDF, Word, or text"
                  />
                </Field>
                <Field label="Or paste resume text (optional)">
                  <Textarea
                    value={addResumeText}
                    onChange={(e) => setAddResumeText(e.target.value)}
                    rows={4}
                  />
                </Field>
                <div className="mt-1 flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button type="button" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    size="sm"
                    disabled={addingCandidate}
                    onClick={() => void onAddCandidate()}
                  >
                    {addingCandidate ? 'Adding…' : 'Add to this job'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}

        {can('candidates.create') ? (
          <Dialog
            open={showImportForm}
            onOpenChange={(open) => {
              setShowImportForm(open);
              if (open) setShowAddForm(false);
            }}
          >
            <DialogContent
              className="top-[6%] max-h-[min(90vh,920px)] w-[min(52rem,calc(100vw-1.5rem))] overflow-y-auto p-5"
              aria-describedby={undefined}
            >
              <div className="pr-8">
                <h2 className="m-0 font-display text-lg font-semibold tracking-tight">
                  Bulk upload
                </h2>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                  Paste or upload a CSV for this job. Required columns: full name,
                  country code, phone. Headers like Name, Mobile, or Dial code also
                  work.
                </p>
              </div>
              <div className="mt-4 grid gap-3">
                <Field label="CSV file">
                  <FileInput
                    accept=".csv,text/csv,text/plain"
                    onFileChange={(file) => void onImportFile(file)}
                    buttonLabel="Choose CSV"
                    emptyLabel="No CSV chosen"
                  />
                </Field>
                <Field label="Or paste CSV">
                  <Textarea
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      setImportRows(null);
                      setImportSummary(null);
                    }}
                    rows={6}
                    placeholder="Full Name,Country,Phone,Email"
                    className="font-mono text-[12.5px]"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={importBusy || !importText.trim()}
                    onClick={() => void onImportPreview()}
                  >
                    {importBusy ? 'Working…' : 'Preview'}
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      importBusy ||
                      !importRows ||
                      importRows.filter((r) => r.valid).length === 0
                    }
                    onClick={() => void onImportConfirm()}
                  >
                    Confirm import
                    {importSummary && importSummary.valid > 0
                      ? ` (${importSummary.valid} valid)`
                      : ''}
                  </Button>
                  {importRows &&
                  importRows.some((r) => !r.countryCode?.trim()) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={importBusy}
                      onClick={() => {
                        setImportRows((prev) => {
                          if (!prev) return prev;
                          return prev.map((r) => {
                            if (r.countryCode?.trim()) return r;
                            const next = {
                              ...r,
                              countryCode: '+91',
                              issues: r.issues.filter(
                                (i) => i !== 'missing_country_code',
                              ),
                            };
                            const stillBroken =
                              !next.fullName?.trim() ||
                              !next.phone?.trim() ||
                              next.issues.length > 0;
                            return {
                              ...next,
                              valid: !stillBroken && Boolean(next.countryCode),
                            };
                          });
                        });
                      }}
                    >
                      Apply +91 to empty codes
                    </Button>
                  ) : null}
                  <DialogClose asChild>
                    <Button type="button" variant="ghost" size="sm">
                      Close
                    </Button>
                  </DialogClose>
                </div>
                {importSummary && (
                  <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                    {importSummary.valid} valid · {importSummary.invalid} need
                    fixes · confirm creates valid rows only
                  </p>
                )}
                {importRows && importRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[var(--separator-subtle)] text-left">
                          <th className="px-2 py-1.5 font-medium">#</th>
                          <th className="px-2 py-1.5 font-medium">Full name</th>
                          <th className="px-2 py-1.5 font-medium">Country</th>
                          <th className="px-2 py-1.5 font-medium">Phone</th>
                          <th className="px-2 py-1.5 font-medium">Email</th>
                          <th className="px-2 py-1.5 font-medium">Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((row) => {
                          const bad = (fieldName: string) =>
                            row.issues.some((i) => i.includes(fieldName));
                          const cellCls = (highlight: boolean) =>
                            highlight
                              ? 'border-b border-[var(--separator-subtle)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-1.5 py-1'
                              : 'border-b border-[var(--separator-subtle)] px-1.5 py-1';
                          const inputCls = (highlight: boolean, extra = '') =>
                            [
                              'rounded border bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--foreground)]',
                              highlight
                                ? 'border-[var(--danger)]'
                                : 'border-[var(--separator)]',
                              extra,
                            ].join(' ');
                          const phoneBad =
                            bad('phone') ||
                            row.issues.includes('duplicate_in_batch') ||
                            row.issues.includes('duplicate_on_job');
                          return (
                            <tr key={row.rowIndex}>
                              <td className={cellCls(false)}>{row.rowIndex}</td>
                              <td className={cellCls(bad('full_name'))}>
                                <input
                                  value={row.fullName ?? ''}
                                  onChange={(e) =>
                                    patchImportRow(row.rowIndex, {
                                      fullName: e.target.value || null,
                                    })
                                  }
                                  className={inputCls(
                                    bad('full_name'),
                                    'box-border w-full',
                                  )}
                                />
                              </td>
                              <td className={cellCls(bad('country_code'))}>
                                <input
                                  value={row.countryCode ?? ''}
                                  onChange={(e) =>
                                    patchImportRow(row.rowIndex, {
                                      countryCode: e.target.value || null,
                                    })
                                  }
                                  className={inputCls(
                                    bad('country_code'),
                                    'w-[4.5rem]',
                                  )}
                                />
                              </td>
                              <td className={cellCls(phoneBad)}>
                                <input
                                  value={row.phone ?? ''}
                                  onChange={(e) =>
                                    patchImportRow(row.rowIndex, {
                                      phone: e.target.value || null,
                                    })
                                  }
                                  className={inputCls(phoneBad, 'w-[7.5rem]')}
                                />
                              </td>
                              <td className={cellCls(bad('email'))}>
                                <input
                                  value={row.email ?? ''}
                                  onChange={(e) =>
                                    patchImportRow(row.rowIndex, {
                                      email: e.target.value || null,
                                    })
                                  }
                                  className={inputCls(
                                    bad('email'),
                                    'box-border w-full min-w-[8.75rem]',
                                  )}
                                />
                              </td>
                              <td
                                className={
                                  row.valid
                                    ? `${cellCls(false)} whitespace-nowrap text-[var(--success)]`
                                    : `${cellCls(true)} whitespace-nowrap text-[var(--danger)]`
                                }
                              >
                                {row.valid ? 'OK' : labelImportIssues(row.issues)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}

        {can('candidates.read') && (
          <Surface className="space-y-4">
            <h2 className="m-0 font-display text-base font-semibold tracking-tight">
              People on this job
            </h2>
            {telephonyMessage && (
              <p
                role="status"
                className={
                  openOutbound
                    ? 'm-0 text-sm text-[var(--foreground-tertiary)]'
                    : 'm-0 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-3 py-2.5 text-sm text-[var(--warning)]'
                }
              >
                {telephonyMessage}
              </p>
            )}
            {assignments.length === 0 &&
            !peopleQuery.trim() &&
            pipelineFilter === 'all' ? (
              <EmptyState
                icon={<UserPlus className="h-5 w-5" aria-hidden />}
                title="No people on this job yet"
                description="Add one person, or upload a CSV with name, country code, and phone."
                action={
                  can('candidates.create') ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          setShowAddForm(true);
                          setShowImportForm(false);
                        }}
                      >
                        <UserPlus className="h-4 w-4" aria-hidden />
                        Add person
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowImportForm(true);
                          setShowAddForm(false);
                        }}
                      >
                        <Upload className="h-4 w-4" aria-hidden />
                        Bulk upload
                      </Button>
                    </div>
                  ) : null
                }
              />
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="tablist"
                    aria-label="Filter by review stage"
                  >
                  {(
                    [
                      ['all', 'All'] as const,
                      ...ASSIGNMENT_STATUSES.map(
                        (s) => [s, PIPELINE_STATUS_LABEL[s]] as const,
                      ),
                    ]
                  ).map(([key, label]) => {
                    const count =
                      key === 'all'
                        ? pipelineTotals.all
                        : key === 'new'
                          ? pipelineTotals.new
                          : key === 'screening'
                            ? pipelineTotals.screening
                            : pipelineTotals.reviewed;
                    const active = pipelineFilter === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setPipelineFilter(key)}
                        className={
                          active
                            ? 'rounded-md border-0 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent)]'
                            : 'rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]'
                        }
                      >
                        {label}
                        <span className="ml-1.5 tabular-nums opacity-70">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                  </div>
                  <Field label="Find people" className="w-full sm:max-w-xs">
                    <Input
                      value={peopleQueryDraft}
                      onChange={(e) => setPeopleQueryDraft(e.target.value)}
                      placeholder="Name or mobile"
                      aria-label="Find people by name or mobile"
                    />
                  </Field>
                  <Field label="Call" className="w-full sm:w-auto sm:min-w-[10rem]">
                    <Select
                      value={callFilter}
                      onChange={(e) =>
                        setCallFilter(
                          e.target.value as
                            | 'all'
                            | 'not_called'
                            | 'calling'
                            | 'completed'
                            | 'failed',
                        )
                      }
                      aria-label="Filter by call status"
                    >
                      <option value="all">All calls</option>
                      <option value="not_called">Not called yet</option>
                      <option value="calling">Call in progress</option>
                      <option value="completed">Call finished</option>
                      <option value="failed">Call failed</option>
                    </Select>
                  </Field>
                </div>
                {pagedAssignments.length === 0 ? (
                  <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                    {peopleQuery.trim()
                      ? `No people match “${peopleQuery.trim()}”.`
                      : callFilter !== 'all'
                        ? 'No people match this call filter.'
                        : 'No people in this stage.'}
                  </p>
                ) : (
                  <>
                {selectedIds.size === 0 ? (
                  <p className="m-0 text-[12px] text-[var(--foreground-muted)]">
                    <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                      J
                    </kbd>
                    <span className="mx-0.5">/</span>
                    <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                      K
                    </kbd>
                    <span className="ml-1.5">move</span>
                    <span className="mx-2 text-[var(--separator)]">·</span>
                    <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                      Enter
                    </kbd>
                    <span className="ml-1.5">open</span>
                    <span className="mx-2 text-[var(--separator)]">·</span>
                    <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                      X
                    </kbd>
                    <span className="ml-1.5">select</span>
                    <span className="mx-2 text-[var(--separator)]">·</span>
                    <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                      ⌘A
                    </kbd>
                    <span className="ml-1.5">all</span>
                  </p>
                ) : null}
                <DataList>
                  <DataListHeader
                    className={
                      can('candidates.read_pii')
                        ? 'grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]'
                        : 'grid-cols-[auto_minmax(0,1fr)_auto_auto]'
                    }
                  >
                    <span className="w-8">
                      <span className="sr-only">Select</span>
                    </span>
                    <span>Name</span>
                    {can('candidates.read_pii') ? (
                      <span className="hidden sm:inline">Mobile</span>
                    ) : null}
                    <span className="hidden sm:inline">Review</span>
                    <span className="pr-1">Call</span>
                  </DataListHeader>
                  <DataListBody>
                    {pagedAssignments.map((row, index) => (
                      <DataListRow
                        key={row.id}
                        selected={
                          row.candidateId === selectedCandidateId ||
                          (!selectedCandidateId && index === listCursor) ||
                          selectedIds.has(row.candidateId)
                        }
                        onClick={() => {
                          setListCursor(index);
                          openCandidate(row.candidateId);
                        }}
                        className={
                          can('candidates.read_pii')
                            ? 'grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]'
                            : 'grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]'
                        }
                      >
                        <span
                          className="flex w-8 items-center"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[var(--accent)]"
                            checked={selectedIds.has(row.candidateId)}
                            onChange={() => toggleSelected(row.candidateId)}
                            aria-label={`Select ${row.candidate.fullName}`}
                          />
                        </span>
                        <div className="min-w-0">
                          <DataListTitle>{row.candidate.fullName}</DataListTitle>
                          <DataListMeta>
                            {row.candidate.source || 'Added'}
                          </DataListMeta>
                        </div>
                        {can('candidates.read_pii') ? (
                          <span className="hidden text-sm text-[var(--foreground-secondary)] sm:block">
                            {row.candidate.phone?.trim() || '—'}
                          </span>
                        ) : null}
                        <Badge
                          tone={statusTone(row.status)}
                          className="hidden sm:inline-flex"
                        >
                          {PIPELINE_STATUS_LABEL[
                            row.status as (typeof ASSIGNMENT_STATUSES)[number]
                          ] ?? row.status}
                        </Badge>
                        <Badge
                          tone={
                            row.callStatus === 'completed'
                              ? 'success'
                              : row.callStatus === 'failed'
                                ? 'danger'
                                : row.callStatus === 'calling'
                                  ? 'accent'
                                  : 'neutral'
                          }
                        >
                          {CALL_STATUS_LABEL[row.callStatus ?? 'not_called']}
                        </Badge>
                      </DataListRow>
                    ))}
                  </DataListBody>
                </DataList>
                {pipelineTotals.all > PEOPLE_PAGE_SIZE ||
                nextPeopleCursor ||
                peoplePage > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                      Page {peoplePage + 1}
                      {pipelineFilter === 'all'
                        ? ` · ${pipelineTotals.all} people`
                        : ` · ${
                            pipelineFilter === 'new'
                              ? pipelineTotals.new
                              : pipelineFilter === 'screening'
                                ? pipelineTotals.screening
                                : pipelineTotals.reviewed
                          } in this stage`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={peoplePage <= 0}
                        onClick={() => {
                          const prevPage = peoplePage - 1;
                          setPeoplePage(prevPage);
                          setListCursor(0);
                          void fetchPeoplePage(peoplePageCursors[prevPage]);
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!nextPeopleCursor}
                        onClick={() => {
                          if (!nextPeopleCursor) return;
                          const nextPage = peoplePage + 1;
                          setPeoplePageCursors((prev) => {
                            const copy = prev.slice(0, peoplePage + 1);
                            copy[nextPage] = nextPeopleCursor;
                            return copy;
                          });
                          setPeoplePage(nextPage);
                          setListCursor(0);
                          void fetchPeoplePage(nextPeopleCursor);
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
                {selectedIds.size > 0 && can('jobs.update') ? (
                  <div className="sticky bottom-3 z-20 mt-3 flex flex-col gap-2 rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-4 py-3 shadow-md">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p
                        className="m-0 text-sm text-[var(--foreground-secondary)]"
                        aria-live="polite"
                      >
                        {selectedIds.size} selected
                        <span className="ml-2 text-xs text-[var(--foreground-muted)]">
                          Move forward · Put on hold · Back to queue · Esc clear
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={bulkBusy}
                          onClick={() => void requestBulkStatus('reviewed')}
                        >
                          Move forward
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={bulkBusy}
                          onClick={() => void requestBulkStatus('screening')}
                        >
                          Put on hold
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={bulkBusy}
                          onClick={() => void requestBulkStatus('new')}
                        >
                          Back to queue
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={bulkBusy}
                          onClick={() => setSelectedIds(new Set())}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <Field label="Reason (optional)">
                      <Input
                        value={bulkStageReason}
                        onChange={(e) => setBulkStageReason(e.target.value)}
                        placeholder="e.g. Strong screen notes · Needs another look"
                        maxLength={500}
                      />
                    </Field>
                  </div>
                ) : null}
                  </>
                )}
                <Dialog
                  open={pendingBulkStatus != null}
                  onOpenChange={(open) => {
                    if (!open && !bulkBusy) {
                      setPendingBulkStatus(null);
                      setBulkConfirmText('');
                      setBulkStageReason('');
                    }
                  }}
                >
                  <DialogContent hideClose={bulkBusy}>
                    <div className="space-y-4 p-5">
                      <div>
                        <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                          Confirm bulk update
                        </h2>
                        <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                          You’re changing {selectedIds.size} people. Type{' '}
                          <span className="font-semibold text-[var(--foreground)]">
                            {pendingBulkStatus === 'reviewed'
                              ? 'MOVE FORWARD'
                              : pendingBulkStatus === 'screening'
                                ? 'ON HOLD'
                                : 'BACK TO QUEUE'}
                          </span>{' '}
                          to continue. You can still Undo afterward.
                        </p>
                      </div>
                      <Field label="Confirmation">
                        <Input
                          value={bulkConfirmText}
                          onChange={(e) => setBulkConfirmText(e.target.value)}
                          placeholder={
                            pendingBulkStatus === 'reviewed'
                              ? 'MOVE FORWARD'
                              : pendingBulkStatus === 'screening'
                                ? 'ON HOLD'
                                : 'BACK TO QUEUE'
                          }
                          autoFocus
                        />
                      </Field>
                      <Field label="Reason (optional)">
                        <Input
                          value={bulkStageReason}
                          onChange={(e) => setBulkStageReason(e.target.value)}
                          placeholder="Why you’re moving these people"
                          maxLength={500}
                        />
                      </Field>
                      <div className="flex justify-end gap-2">
                        <DialogClose asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={bulkBusy}
                          >
                            Cancel
                          </Button>
                        </DialogClose>
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            bulkBusy ||
                            !pendingBulkStatus ||
                            bulkConfirmText !==
                              (pendingBulkStatus === 'reviewed'
                                ? 'MOVE FORWARD'
                                : pendingBulkStatus === 'screening'
                                  ? 'ON HOLD'
                                  : 'BACK TO QUEUE')
                          }
                          onClick={() => {
                            if (pendingBulkStatus)
                              void bulkStatus(pendingBulkStatus);
                          }}
                        >
                          {bulkBusy ? 'Updating…' : 'Perform update'}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </Surface>
        )}

        {(() => {
          const row = assignments.find(
            (a) => a.candidateId === selectedCandidateId,
          );
          if (!row || !job) return null;
          return (
            <CandidateDetailSheet
              open={Boolean(selectedCandidateId)}
              row={row}
              job={job}
              jobId={jobId}
              sheetTab={sheetTab}
              setSheetTab={setSheetTab}
              can={can}
              canScreen={canScreen}
              selectedVisibleIndex={selectedVisibleIndex}
              visibleCount={pagedAssignments.length}
              goRelativeCandidate={goRelativeCandidate}
              closeCandidate={closeCandidate}
              sheetStageReason={sheetStageReason}
              setSheetStageReason={setSheetStageReason}
              onAssignmentStatusChange={onAssignmentStatusChange}
              stageHistory={stageHistory}
              stageHistoryLoading={stageHistoryLoading}
              phoneDrafts={phoneDrafts}
              setPhoneDrafts={setPhoneDrafts}
              savingPhoneId={savingPhoneId}
              onSavePhone={onSavePhone}
              openAskCandidateId={openAskCandidateId}
              setOpenAskCandidateId={setOpenAskCandidateId}
              callNotice={callNoticeByCandidate[row.candidateId]}
              callingCandidateId={callingCandidateId}
              liveOutbound={liveOutboundByCandidate[row.candidateId]}
              onOutbound={onOutbound}
              agentPublished={agentPublished}
              outboundPhone={outboundPhone}
              screenCandidate={screenCandidate}
              setScreenCandidate={setScreenCandidate}
              showCallHistoryLink={searchParams.get('history') === '1'}
            />
          );
        })()}
      </PageMain>
    </AppShell>
  );
}
