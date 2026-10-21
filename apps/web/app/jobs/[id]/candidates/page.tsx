'use client';

/**
 * A job's candidates (D2): the job header with its readiness line and the Candidates and
 * Setup tabs, then everyone on the job as one list card. Filter by decision, search, and
 * select to decide in bulk. A row opens the candidate sheet: results, calling, details.
 * Keyboard: J and K move, Enter opens, X selects, Cmd/Ctrl A selects the page.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Lock, SearchX, Unplug, Upload, UserPlus, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { AddCandidateDialog, ImportCandidatesDialog } from '@/components/candidates/add-candidates';
import {
  CandidateDetailSheet,
  sourceLabel,
  type CandidateLiveOutbound,
  type CandidateSheetTab,
} from '@/components/candidates/CandidateDetailSheet';
import {
  decisionDone,
  decisionLabel,
  isStage,
  moveTotals,
  STAGES,
  type StageTotals,
} from '@/components/candidates/decisions';
import { PersonStateTag } from '@/components/candidates/person-state';
import { JobHeader } from '@/components/shared/job-header';
import { UserInitials } from '@/components/shared/user-initials';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/components/ui/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Alert } from '@/components/ui/notice';
import { PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import { SkeletonRecord, useHeldLoading } from '@/components/ui/skeleton';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import { SHEET_TOASTER, toastUndo } from '@/components/ui/toaster';
import {
  ApiClientError,
  bulkUpdateJobCandidateStatus,
  formatApiError,
  getAgent,
  getJob,
  getTelephonyStatus,
  listCandidateStageHistory,
  listJobCandidates,
  listJobKnowledge,
  me,
  reconcileVoiceSession,
  startOutboundCall,
  updateCandidate,
  type CandidateStage,
  type CandidateStageHistoryEvent,
  type Job,
  type JobCandidateAssignment,
  type Me,
} from '@/lib/api';
import { loginPathForReturn } from '@/lib/auth-redirect';
import { toUserMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/format';
import { hiringPeopleQueryKey, homeQueryKey } from '@/lib/hiring-people';
import { fromPublicId, toPublicId } from '@/lib/public-id';
import { useOnline } from '@/lib/use-online';
import { useUseCase } from '@/lib/use-cases';

const PEOPLE_PAGE_SIZE = 40;
// From this many people at once, a bulk decision asks to be typed out first.
const BULK_CONFIRM_AT = 24;

type StageFilter = 'all' | CandidateStage;
type CallFilter = 'all' | 'not_called' | 'calling' | 'completed' | 'failed';
type Decision = { candidateId: string; status: CandidateStage; previous: CandidateStage; name: string };

const CALL_FILTERS: { value: CallFilter; label: string }[] = [
  { value: 'all', label: 'Any call status' },
  { value: 'not_called', label: 'Not called yet' },
  { value: 'calling', label: 'Calling now' },
  { value: 'completed', label: 'Call ended' },
  { value: 'failed', label: 'Call didn’t connect' },
];

// The words a bulk decision of 24 or more is typed out with.
const CONFIRM_PHRASE: Record<CandidateStage, string> = {
  reviewed: 'move forward',
  screening: 'put on hold',
  declined: 'not moving forward',
  new: 'clear decision',
};

// "No one is on hold": a stage filter with nobody in it.
const NOBODY: Record<CandidateStage, string> = {
  new: 'Everyone here has a decision',
  screening: 'No one is on hold',
  reviewed: 'No one has moved forward yet',
  declined: 'No one is marked as not moving forward',
};

const noSubscribe = () => () => {};
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export default function JobCandidatesPage() {
  return (
    <Suspense
      fallback={
        <AppShell profile={null}>
          <PageMain>
            <SkeletonRecord rows={6} />
          </PageMain>
        </AppShell>
      }
    >
      <JobCandidatesPageInner />
    </Suspense>
  );
}

/** One line under the job's title: an icon in the state's colour and the words. */
function Readiness({ icon: Icon, tone, children }: { icon: LucideIcon; tone: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-2">
      <Icon aria-hidden strokeWidth={1.75} className={cn('mt-0.5 size-4 shrink-0', tone)} />
      <span>{children}</span>
    </span>
  );
}

const INLINE_LINK = 'font-medium text-text underline underline-offset-4 hover:decoration-2';

function JobCandidatesPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const online = useOnline();
  const apple = useSyncExternalStore(noSubscribe, isApple, () => true);
  const { labels, stages } = useUseCase();
  const jobId = fromPublicId(params.id) ?? params.id;
  const jobPublicId = toPublicId(jobId);
  const selectedCandidateId = fromPublicId(searchParams.get('c'));
  const contactOne = labels.contact.one.toLowerCase();
  const contactMany = labels.contact.many.toLowerCase();
  const people = (n: number) => `${n} ${n === 1 ? contactOne : contactMany}`;

  const [profile, setProfile] = useState<Me | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [assignments, setAssignments] = useState<JobCandidateAssignment[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState<unknown>(null);
  const [listBusy, setListBusy] = useState(false);
  // null until the agent's status is in, 'unknown' when it couldn't be read: never a guessed state.
  const [agentPublished, setAgentPublished] = useState<boolean | 'unknown' | null>(null);
  const [docsPreparing, setDocsPreparing] = useState(false);
  const [outboundPhone, setOutboundPhone] = useState(false);
  const [openOutbound, setOpenOutbound] = useState(false);
  const [telephonyFailed, setTelephonyFailed] = useState(false);
  const [callNoticeByCandidate, setCallNoticeByCandidate] = useState<
    Record<string, { kind: 'ok' | 'err'; text: string }>
  >({});
  const [screenCandidate, setScreenCandidate] = useState<{ id: string; fullName: string } | null>(null);
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [savingPhoneId, setSavingPhoneId] = useState<string | null>(null);
  const [callingCandidateId, setCallingCandidateId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [listCursor, setListCursor] = useState(0);
  const [peoplePage, setPeoplePage] = useState(0);
  const [peoplePageCursors, setPeoplePageCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextPeopleCursor, setNextPeopleCursor] = useState<string | null>(null);
  const [pipelineTotals, setPipelineTotals] = useState<StageTotals>({ all: 0, new: 0, screening: 0, reviewed: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBulkStatus, setPendingBulkStatus] = useState<CandidateStage | null>(null);
  const [bulkConfirmText, setBulkConfirmText] = useState('');
  const [sheetStageReason, setSheetStageReason] = useState('');
  const [bulkStageReason, setBulkStageReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stageHistory, setStageHistory] = useState<CandidateStageHistoryEvent[]>([]);
  const [stageHistoryLoading, setStageHistoryLoading] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleQueryDraft, setPeopleQueryDraft] = useState('');
  const [callFilter, setCallFilter] = useState<CallFilter>('all');
  const stageParam = searchParams.get('stage');
  const pipelineFilter: StageFilter = isStage(stageParam) ? stageParam : 'all';
  const tabParam = searchParams.get('tab');
  // null: the tab follows the candidate (results once called, else calling).
  const [sheetTab, setSheetTab] = useState<CandidateSheetTab | null>(
    tabParam === 'results' || tabParam === 'screen' || tabParam === 'overview' ? tabParam : null,
  );
  const [liveOutboundByCandidate, setLiveOutboundByCandidate] = useState<Record<string, CandidateLiveOutbound>>({});
  const outboundInFlight = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const listSeq = useRef(0);

  const can = (p: string) => profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canScreen = can('calls.initiate') || can('agents.test');
  const canReadCandidates = can('candidates.read');

  // Changes made here also change Home's queues and the candidates list.
  const touchElsewhere = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: homeQueryKey });
    void queryClient.invalidateQueries({ queryKey: hiringPeopleQueryKey });
  }, [queryClient]);

  function setPipelineFilter(key: StageFilter) {
    setPeoplePage(0);
    setPeoplePageCursors([undefined]);
    setNextPeopleCursor(null);
    setListCursor(0);
    setSelectedIds(new Set());
    const q = new URLSearchParams(searchParams.toString());
    if (key === 'all') q.delete('stage');
    else q.set('stage', key);
    const qs = q.toString();
    router.replace(`/jobs/${jobPublicId}/candidates${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  function defaultTab(row: JobCandidateAssignment | undefined): CandidateSheetTab {
    const called = row?.callStatus === 'completed' || row?.callStatus === 'failed' || row?.callStatus === 'calling';
    return called ? 'results' : canScreen ? 'screen' : 'overview';
  }

  function openCandidate(candidateId: string, opts?: { tab?: CandidateSheetTab }) {
    setSheetTab(opts?.tab ?? defaultTab(assignments.find((a) => a.candidateId === candidateId)));
    const q = new URLSearchParams(searchParams.toString());
    q.set('c', toPublicId(candidateId));
    // The tab is state from here on; a stale ?tab= would override the next candidate's.
    q.delete('tab');
    router.replace(`/jobs/${jobPublicId}/candidates?${q.toString()}`, { scroll: false });
  }

  function closeCandidate() {
    const q = new URLSearchParams(searchParams.toString());
    q.delete('c');
    q.delete('tab');
    const qs = q.toString();
    router.replace(`/jobs/${jobPublicId}/candidates${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  const pagedAssignments = useMemo(() => {
    if (callFilter === 'all') return assignments;
    return assignments.filter((row) => (row.callStatus ?? 'not_called') === callFilter);
  }, [assignments, callFilter]);

  useEffect(() => {
    setListCursor((c) => Math.min(c, Math.max(0, pagedAssignments.length - 1)));
  }, [pagedAssignments.length]);

  const selectedVisibleIndex = useMemo(() => {
    if (!selectedCandidateId) return -1;
    return pagedAssignments.findIndex((a) => a.candidateId === selectedCandidateId);
  }, [pagedAssignments, selectedCandidateId]);

  // A test call or a dial in flight holds the sheet on this candidate.
  const sheetBusy =
    Boolean(selectedCandidateId) &&
    (callingCandidateId === selectedCandidateId || screenCandidate?.id === selectedCandidateId);

  function goRelativeCandidate(delta: number) {
    if (pagedAssignments.length === 0 || sheetBusy) return;
    const from = selectedVisibleIndex >= 0 ? selectedVisibleIndex : listCursor;
    const nextIdx = Math.min(Math.max(from + delta, 0), pagedAssignments.length - 1);
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

  const rowTitles = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-strip-open]') ?? []);

  function focusRow(index: number) {
    const el = rowTitles()[index];
    if (!el) return;
    el.focus();
    setListCursor(index);
  }

  // No dependency list: the handler always reads this render's rows, selection and sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (selectedCandidateId) {
        // The sheet is open: J and K walk the list, unless a confirmation is up.
        if (document.querySelector('[role="alertdialog"]')) return;
        if (key === 'j' || key === 'k') {
          e.preventDefault();
          goRelativeCandidate(key === 'j' ? 1 : -1);
        }
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (pagedAssignments.length === 0) return;
      const inList = Boolean(target && listRef.current?.contains(target));
      if ((e.metaKey || e.ctrlKey) && key === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(pagedAssignments.map((a) => a.candidateId)));
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (key === 'x' && inList) {
        const row = pagedAssignments[listCursor];
        if (row) {
          e.preventDefault();
          toggleSelected(row.candidateId);
        }
        return;
      }
      if (key === 'escape' && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
        return;
      }
      const down = key === 'j' || (inList && key === 'arrowdown');
      const up = key === 'k' || (inList && key === 'arrowup');
      if (!down && !up) return;
      e.preventDefault();
      const titles = rowTitles();
      const at = titles.findIndex((el) => el === document.activeElement);
      if (at < 0) {
        focusRow(Math.min(listCursor, titles.length - 1));
        return;
      }
      focusRow(Math.min(Math.max(at + (down ? 1 : -1), 0), titles.length - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  useEffect(() => {
    // A reason typed for one candidate never rides along to the next.
    setSheetStageReason('');
    if (!selectedCandidateId) {
      setStageHistory([]);
      return;
    }
    void refreshStageHistory(selectedCandidateId);
    // Runs per candidate only; refreshStageHistory reads nothing else that changes.
  }, [selectedCandidateId, jobId]);

  const reloadJobKnowledge = useCallback(async () => {
    try {
      const { sources } = await listJobKnowledge(jobId);
      setDocsPreparing(sources.reduce((n, s) => n + s.pendingDocs, 0) > 0);
    } catch {
      setDocsPreparing(false);
    }
  }, [jobId]);

  const loadJob = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const p = await me();
      setProfile(p);
      const j = await getJob(jobId);
      // The line first, so the job's status pill never flashes the wrong state.
      const perms = new Set(p.activeOrganization?.permissions ?? []);
      if (perms.has('agents.test') || perms.has('calls.initiate')) {
        try {
          const tel = await getTelephonyStatus();
          setOutboundPhone(tel.outboundPhone);
          setOpenOutbound(Boolean(tel.openOutbound));
          setTelephonyFailed(false);
        } catch {
          setTelephonyFailed(true);
        }
      }
      setJob(j);
      void reloadJobKnowledge();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn());
        return;
      }
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, [jobId, router, reloadJobKnowledge]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  const fetchPeoplePage = useCallback(
    async (cursor?: string) => {
      // Only the latest request lands, so a slow answer for an old filter never wins.
      const seq = ++listSeq.current;
      const res = await listJobCandidates(jobId, {
        limit: PEOPLE_PAGE_SIZE,
        cursor,
        status: pipelineFilter === 'all' ? undefined : pipelineFilter,
        q: peopleQuery.trim() || undefined,
      });
      if (seq !== listSeq.current) return;
      setAssignments(res.candidates);
      setPipelineTotals(res.totals);
      setNextPeopleCursor(res.nextCursor);
    },
    [jobId, pipelineFilter, peopleQuery],
  );

  const loadList = useCallback(
    async (cursor?: string) => {
      setListBusy(true);
      try {
        await fetchPeoplePage(cursor);
        setListError(null);
      } catch (e) {
        setListError(e);
      } finally {
        setListBusy(false);
        setListLoaded(true);
      }
    },
    [fetchPeoplePage],
  );

  const jobReady = job !== null;
  // The first page, and again whenever the decision filter or the search changes.
  useEffect(() => {
    if (!canReadCandidates || !jobReady) return;
    void loadList(undefined);
  }, [canReadCandidates, jobReady, loadList]);

  const refreshList = () => loadList(peoplePageCursors[peoplePage]);

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
    const tab = searchParams.get('tab');
    if (tab === 'results' || tab === 'screen' || tab === 'overview') setSheetTab(tab);
  }, [searchParams, selectedCandidateId]);

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
        if (!cancelled) setAgentPublished('unknown');
      }
    }
    void loadAgent();
    return () => {
      cancelled = true;
    };
  }, [job?.agentId]);

  useEffect(() => {
    if (!docsPreparing) return;
    const id = window.setInterval(() => void reloadJobKnowledge(), 3000);
    return () => window.clearInterval(id);
  }, [docsPreparing, reloadJobKnowledge]);

  const hasLiveOutbound = Object.values(liveOutboundByCandidate).some(
    (s) => s.status === 'pending' || s.status === 'active',
  );
  const liveOutboundRef = useRef(liveOutboundByCandidate);
  liveOutboundRef.current = liveOutboundByCandidate;
  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;

  // Calls placed from here: poll each until it ends, then refresh the rows' tags.
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
          const { voiceSession } = await reconcileVoiceSession(live.agentId, live.voiceSessionId);
          if (cancelled) return;
          setLiveOutboundByCandidate((prev) => {
            const cur = prev[candidateId];
            if (!cur || cur.voiceSessionId !== live.voiceSessionId) return prev;
            return {
              ...prev,
              [candidateId]: {
                ...cur,
                status: voiceSession.status,
                startedAt: voiceSession.startedAt ?? cur.startedAt,
                failureReason: voiceSession.failureReason ?? null,
              },
            };
          });
          if (voiceSession.status === 'ended' || voiceSession.status === 'failed') anyTerminal = true;
        } catch {
          // Keep the last known status; the next tick retries.
        }
      }
      if (!cancelled && anyTerminal) {
        touchElsewhere();
        await refreshListRef.current();
      }
    }

    void pollLive();
    const id = window.setInterval(() => void pollLive(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hasLiveOutbound, jobId, touchElsewhere]);

  async function onOutbound(candidateId: string) {
    if (outboundInFlight.current.has(candidateId)) return;
    if (!job?.agentId) {
      setCallNoticeByCandidate((prev) => ({
        ...prev,
        [candidateId]: { kind: 'err', text: 'This job has no AI hiring agent yet. Add one in Setup, then call.' },
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
          // Until the first poll brings the call's own start time.
          startedAt: new Date().toISOString(),
        },
      }));
      touchElsewhere();
      await refreshList();
    } catch (e) {
      setCallNoticeByCandidate((prev) => ({
        ...prev,
        [candidateId]: { kind: 'err', text: formatApiError(e, 'Couldn’t start the call. Try again in a moment.') },
      }));
    } finally {
      outboundInFlight.current.delete(candidateId);
      setCallingCandidateId(null);
    }
  }

  async function onSavePhone(candidateId: string) {
    const phone = (phoneDrafts[candidateId] ?? '').trim() || null;
    setSavingPhoneId(candidateId);
    try {
      await updateCandidate(candidateId, { phone });
      await refreshList();
      setPhoneDrafts((prev) => {
        const next = { ...prev };
        delete next[candidateId];
        return next;
      });
      toast.success(phone ? 'Mobile number saved' : 'Mobile number removed', { toasterId: SHEET_TOASTER });
    } catch (e) {
      const m = toUserMessage(e, 'save the mobile number');
      toast.error(m.title, { description: m.detail, toasterId: SHEET_TOASTER });
    } finally {
      setSavingPhoneId(null);
    }
  }

  /** Saves decisions with an Undo toast. False when they didn't save (the rows go back). */
  async function applyCandidateStatuses(
    updates: Decision[],
    message: string,
    reason?: string,
    toasterId?: string,
  ): Promise<boolean> {
    if (updates.length === 0) return true;
    const moves = updates.map((u) => ({ from: u.previous, to: u.status }));
    const back = updates.map((u) => ({ from: u.status, to: u.previous }));
    const setStatuses = (statuses: { candidateId: string; status: CandidateStage }[]) =>
      setAssignments((prev) =>
        prev.map((row) => {
          const hit = statuses.find((u) => u.candidateId === row.candidateId);
          return hit ? { ...row, status: hit.status } : row;
        }),
      );
    setStatuses(updates);
    setPipelineTotals((t) => moveTotals(t, moves));
    const touchesOpen = Boolean(selectedCandidateId && updates.some((u) => u.candidateId === selectedCandidateId));
    try {
      await bulkUpdateJobCandidateStatus(
        jobId,
        updates.map((u) => ({ candidateId: u.candidateId, status: u.status })),
        reason,
      );
    } catch (e) {
      setStatuses(updates.map((u) => ({ candidateId: u.candidateId, status: u.previous })));
      setPipelineTotals((t) => moveTotals(t, back));
      const m = toUserMessage(e, 'save that decision');
      toast.error(m.title, { description: m.detail, toasterId });
      return false;
    }
    touchElsewhere();
    if (touchesOpen && selectedCandidateId) void refreshStageHistory(selectedCandidateId);
    toastUndo(
      message,
      () => {
        void (async () => {
          setStatuses(updates.map((u) => ({ candidateId: u.candidateId, status: u.previous })));
          setPipelineTotals((t) => moveTotals(t, back));
          try {
            await bulkUpdateJobCandidateStatus(
              jobId,
              updates.map((u) => ({ candidateId: u.candidateId, status: u.previous })),
              'Undone',
            );
            toast.success('Change undone', { toasterId });
            touchElsewhere();
            if (touchesOpen && selectedCandidateId) void refreshStageHistory(selectedCandidateId);
          } catch {
            // The decision still stands on the server: show it again.
            void refreshList();
            toast.error('Couldn’t undo that', { description: 'Refresh the page, then try again.', toasterId });
          }
        })();
      },
      { toasterId },
    );
    return true;
  }

  async function onAssignmentStatusChange(candidateId: string, status: CandidateStage) {
    const row = assignments.find((a) => a.candidateId === candidateId);
    if (!row || !isStage(row.status) || row.status === status) return;
    const name = row.candidate.fullName;
    const saved = await applyCandidateStatuses(
      [{ candidateId, status, previous: row.status, name }],
      decisionDone(status, name),
      sheetStageReason,
      SHEET_TOASTER,
    );
    if (saved) setSheetStageReason('');
  }

  async function bulkStatus(status: CandidateStage) {
    if (!can('jobs.update') || bulkBusy) return;
    const updates = [...selectedIds].flatMap((candidateId): Decision[] => {
      const row = assignments.find((a) => a.candidateId === candidateId);
      if (!row || !isStage(row.status) || row.status === status) return [];
      return [{ candidateId, status, previous: row.status, name: row.candidate.fullName }];
    });
    if (updates.length === 0) {
      setSelectedIds(new Set());
      setPendingBulkStatus(null);
      return;
    }
    setBulkBusy(true);
    try {
      const who = updates.length === 1 ? (updates[0]?.name ?? people(1)) : people(updates.length);
      if (await applyCandidateStatuses(updates, decisionDone(status, who), bulkStageReason)) {
        setSelectedIds(new Set());
        setPendingBulkStatus(null);
        setBulkConfirmText('');
        setBulkStageReason('');
      }
    } finally {
      setBulkBusy(false);
    }
  }

  function requestBulkStatus(status: CandidateStage) {
    if (selectedIds.size >= BULK_CONFIRM_AT) {
      setPendingBulkStatus(status);
      setBulkConfirmText('');
      return;
    }
    void bulkStatus(status);
  }

  // The open row, and the last one while the sheet slides away.
  const openRow = selectedCandidateId ? (assignments.find((a) => a.candidateId === selectedCandidateId) ?? null) : null;
  const [sheetRow, setSheetRow] = useState<JobCandidateAssignment | null>(null);
  useEffect(() => {
    if (openRow) setSheetRow(openRow);
  }, [openRow]);
  const shownRow = openRow ?? sheetRow;

  const ready = Boolean(profile && job && (listLoaded || !canReadCandidates));
  const showSkeleton = useHeldLoading(!ready && !loadError);

  if (showSkeleton || !profile || !job) {
    if (loadError && !showSkeleton) {
      const status = loadError instanceof ApiClientError ? loadError.status : 0;
      const m = toUserMessage(loadError, `load this ${labels.workItem.one.toLowerCase()}`);
      const retry = status === 403 || status === 404 ? undefined : () => void loadJob();
      // The whole page: the error names it (h1). Retry when it may help; the way out is the list.
      const back = (
        <Button asChild variant={retry ? 'tertiary' : 'secondary'}>
          <Link href="/jobs">Back to {labels.workItem.many.toLowerCase()}</Link>
        </Button>
      );
      return (
        <AppShell profile={profile}>
          <PageMain>
            {!online ? (
              <ErrorState
                variant="offline"
                headingLevel={1}
                onRetry={() => void loadJob()}
                retrying={loading}
                action={back}
              />
            ) : (
              <ErrorState
                headingLevel={1}
                title={m.title}
                cause={m.detail}
                supportRef={m.supportRef}
                onRetry={retry}
                retrying={loading}
                action={back}
              />
            )}
          </PageMain>
        </AppShell>
      );
    }
    return (
      <AppShell profile={profile}>
        <PageMain>
          <SkeletonRecord rows={6} />
        </PageMain>
      </AppShell>
    );
  }

  const questions = job.screeningQuestions?.length ?? 0;
  const asks =
    questions > 0
      ? `The agent asks your ${questions} must-ask ${questions === 1 ? 'question' : 'questions'}.`
      : 'Add must-ask questions in Setup, so every call covers them.';

  let readiness: ReactNode;
  if (job.agentId && agentPublished === null) {
    readiness = (
      <span aria-hidden className="inline-block h-3 w-72 max-w-full rounded-pill bg-muted align-middle motion-safe:animate-pulse" />
    );
  } else if (!job.agentId) {
    readiness = (
      <Readiness icon={CircleAlert} tone="text-status-warning-text">
        No AI hiring agent on this job yet.{' '}
        <Link href={`/jobs/${jobPublicId}`} className={INLINE_LINK}>
          Add one in Setup
        </Link>{' '}
        before calling anyone.
      </Readiness>
    );
  } else if (agentPublished === 'unknown') {
    readiness = (
      <Readiness icon={CircleAlert} tone="text-status-warning-text">
        Couldn’t check whether the AI hiring agent is live. Reload the page to check again.
      </Readiness>
    );
  } else if (!agentPublished) {
    readiness = (
      <Readiness icon={CircleAlert} tone="text-status-warning-text">
        The AI hiring agent isn’t live yet.{' '}
        <Link href={`/agents/${toPublicId(job.agentId)}`} className={INLINE_LINK}>
          Publish it
        </Link>{' '}
        before calling anyone.
      </Readiness>
    );
  } else if (!canScreen) {
    readiness = (
      <Readiness icon={CircleCheck} tone="text-status-success-text">
        The AI hiring agent is live for this job.
      </Readiness>
    );
  } else if (telephonyFailed) {
    readiness = (
      <Readiness icon={CircleAlert} tone="text-status-warning-text">
        Couldn’t check whether phone calls are connected. Reload the page to check again.
      </Readiness>
    );
  } else if (!outboundPhone) {
    readiness = (
      <Readiness icon={Unplug} tone="text-text-3">
        Your workspace’s calling number isn’t connected yet. Until it is, try the agent with a test call in your
        browser.
      </Readiness>
    );
  } else {
    readiness = (
      <Readiness icon={CircleCheck} tone="text-status-success-text">
        Ready to call. {asks}
        {openOutbound ? '' : ' Until business verification is done, some calls may be refused.'}
      </Readiness>
    );
  }

  const canCreate = can('candidates.create');
  const pii = can('candidates.read_pii');
  const filtered = Boolean(peopleQuery.trim()) || callFilter !== 'all' || pipelineFilter !== 'all';
  const nobodyYet = pipelineTotals.all === 0 && !filtered;
  const stageTotal = pipelineFilter === 'all' ? pipelineTotals.all : (pipelineTotals[pipelineFilter] ?? 0);
  const checkedHere = pagedAssignments.filter((a) => selectedIds.has(a.candidateId)).length;

  const addActions = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setShowImportForm(true);
          setShowAddForm(false);
        }}
      >
        <Upload aria-hidden strokeWidth={1.5} />
        Upload CSV
      </Button>
      <Button
        type="button"
        onClick={() => {
          setShowAddForm(true);
          setShowImportForm(false);
        }}
      >
        <UserPlus aria-hidden strokeWidth={1.5} />
        Add {contactOne}
      </Button>
    </>
  );

  function clearFilters() {
    setPeopleQueryDraft('');
    setPeopleQuery('');
    setCallFilter('all');
    if (pipelineFilter !== 'all') setPipelineFilter('all');
  }

  return (
    <AppShell profile={profile} breadcrumb={[{ label: labels.workItem.many, href: '/jobs' }, { label: job.title }]}>
      <PageMain className="pb-10">
        <JobHeader
          jobId={jobPublicId}
          title={job.title}
          status={job.status}
          testCallsOnly={canScreen && !telephonyFailed && !outboundPhone}
          current="candidates"
          readiness={readiness}
          // An empty job carries these in its empty state: one main action on screen.
          actions={canCreate && !(nobodyYet && canReadCandidates && !listError) ? addActions : undefined}
          workItemLabel={labels.workItem.many}
          contactLabel={labels.contact.many}
        />

        {docsPreparing ? (
          <Alert kind="info" title="Job description files are still being prepared">
            Calls placed before they’re ready may miss details from them.
          </Alert>
        ) : null}

        {!canReadCandidates ? (
          <div className="rounded-card border border-border bg-canvas">
            <EmptyState
              icon={<Lock />}
              title={`You don’t have access to ${contactMany}`}
              description="Ask a workspace admin to give you access."
            />
          </div>
        ) : nobodyYet && !listError ? (
          <div className="rounded-card border border-border bg-canvas">
            <EmptyState
              agent="idle"
              title={`No ${contactMany} on this job yet`}
              description={`Add them one at a time, from a resume, or upload a CSV. The AI hiring agent then calls each one and asks your questions.`}
              action={canCreate ? addActions : null}
              className="py-16"
            />
          </div>
        ) : (
          <section aria-labelledby="board-heading" className="space-y-4">
            <h2 id="board-heading" className="sr-only">
              {labels.contact.many} on this job
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Filter by decision"
                value={pipelineFilter}
                onValueChange={setPipelineFilter}
                // Five options with counts won't fit below lg: a native select there.
                collapseBelow="lg"
                // Counts only while they are the server's: a failed load shows none, never zeros.
                options={[
                  { value: 'all', label: 'All', count: listError ? null : pipelineTotals.all },
                  ...STAGES.map((stage) => ({
                    value: stage,
                    label: decisionLabel(stage, stages),
                    count: listError ? null : pipelineTotals[stage],
                  })),
                ]}
              />
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <SearchInput
                  value={peopleQueryDraft}
                  onChange={(e) => setPeopleQueryDraft(e.target.value)}
                  placeholder="Name or mobile"
                  aria-label={`Find ${contactMany} by name or mobile`}
                  className="sm:w-56"
                />
                <Select
                  value={callFilter}
                  onChange={(e) => setCallFilter(e.target.value as CallFilter)}
                  aria-label="Filter by call"
                  className="sm:w-44"
                >
                  {CALL_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {listError ? (
              <div className="rounded-card border border-border bg-canvas">
                {!online ? (
                  <ErrorState variant="offline" headingLevel={3} onRetry={() => void refreshList()} retrying={listBusy} />
                ) : (
                  (() => {
                    const m = toUserMessage(listError, `load the ${contactMany}`);
                    return (
                      <ErrorState
                        headingLevel={3}
                        title={m.title}
                        cause={m.detail}
                        supportRef={m.supportRef}
                        onRetry={() => void refreshList()}
                        retrying={listBusy}
                      />
                    );
                  })()
                )}
              </div>
            ) : pagedAssignments.length === 0 ? (
              <div className="rounded-card border border-border bg-canvas">
                <EmptyState
                  headingLevel={3}
                  icon={<SearchX />}
                  title={
                    peopleQuery.trim()
                      ? `No one matches “${peopleQuery.trim()}”`
                      : callFilter !== 'all'
                        ? 'No one matches this call status'
                        : pipelineFilter !== 'all'
                          ? NOBODY[pipelineFilter]
                          : `No ${contactMany} here`
                  }
                  description={
                    peopleQuery.trim()
                      ? 'Search looks at names and mobile numbers.'
                      : 'Try another filter, or show everyone.'
                  }
                  action={
                    <Button type="button" variant="secondary" onClick={clearFilters}>
                      Show everyone
                    </Button>
                  }
                />
              </div>
            ) : (
              <div
                ref={listRef}
                onFocus={(e) => {
                  const i = rowTitles().indexOf(e.target as HTMLElement);
                  if (i >= 0) setListCursor(i);
                }}
              >
                <ListRows
                  aria-label={`${labels.contact.many} on ${job.title}`}
                  aria-busy={listBusy || undefined}
                  columns={pii ? 'auto minmax(0,1fr) auto auto' : 'auto minmax(0,1fr) auto'}
                  header={
                    <>
                      <span className="flex items-center">
                        <Checkbox
                          aria-label="Select everyone on this page"
                          checked={checkedHere > 0 && checkedHere === pagedAssignments.length}
                          indeterminate={checkedHere > 0 && checkedHere < pagedAssignments.length}
                          onChange={(e) =>
                            setSelectedIds(
                              e.target.checked ? new Set(pagedAssignments.map((a) => a.candidateId)) : new Set(),
                            )
                          }
                        />
                      </span>
                      <span>Name</span>
                      {pii ? <span>Mobile</span> : null}
                      <span>Status</span>
                    </>
                  }
                >
                  {pagedAssignments.map((row) => (
                    <ListRow
                      key={row.id}
                      selected={row.candidateId === selectedCandidateId}
                      checkbox={
                        <Checkbox
                          aria-label={`Select ${row.candidate.fullName}`}
                          checked={selectedIds.has(row.candidateId)}
                          onChange={() => toggleSelected(row.candidateId)}
                        />
                      }
                    >
                      <ListRowPrimary
                        avatar={<UserInitials name={row.candidate.fullName} />}
                        title={row.candidate.fullName}
                        meta={sourceLabel(row.candidate.source)}
                        onOpen={() => openCandidate(row.candidateId)}
                      />
                      {pii ? (
                        <ListCell className="tabular-nums max-md:hidden">
                          {row.candidate.phone?.trim() ? (
                            formatPhone(row.candidate.phone)
                          ) : (
                            <span className="text-text-3">Not added</span>
                          )}
                        </ListCell>
                      ) : null}
                      <ListCell kind="tag">
                        <PersonStateTag stage={row.status} callStatus={row.callStatus} failureReason={row.failureReason} />
                      </ListCell>
                    </ListRow>
                  ))}
                </ListRows>
              </div>
            )}

            {!listError && pagedAssignments.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="m-0 hidden flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-3 md:flex [@media(pointer:coarse)]:hidden">
                  <span className="inline-flex items-center gap-1">
                    <Kbd>J</Kbd>
                    <Kbd>K</Kbd> move
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>Enter</Kbd> open
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>X</Kbd> select
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>{apple ? '⌘A' : 'Ctrl A'}</Kbd> select the page
                  </span>
                </p>
                {peoplePage > 0 || nextPeopleCursor ? (
                  <div className="ml-auto flex items-center gap-3">
                    <p className="m-0 text-meta tabular-nums text-text-3">
                      Page {peoplePage + 1} · {people(stageTotal)}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={peoplePage <= 0 || listBusy}
                      onClick={() => {
                        const prevPage = peoplePage - 1;
                        setPeoplePage(prevPage);
                        setListCursor(0);
                        void loadList(peoplePageCursors[prevPage]);
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!nextPeopleCursor || listBusy}
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
                        void loadList(nextPeopleCursor);
                      }}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedIds.size > 0 && can('jobs.update') ? (
              <div
                role="region"
                aria-label={`${labels.contact.many} you selected`}
                className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-card border border-border bg-canvas p-3 shadow-float lg:flex-row lg:items-center"
              >
                <div className="flex items-center justify-between gap-2 pl-1 lg:justify-start">
                  <p className="m-0 text-label font-medium tabular-nums text-text" aria-live="polite">
                    {selectedIds.size} selected
                  </p>
                  <Button type="button" variant="tertiary" size="sm" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </Button>
                </div>
                <Input
                  value={bulkStageReason}
                  onChange={(e) => setBulkStageReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Reason for this change (optional)"
                  maxLength={500}
                  className="h-9 lg:w-auto lg:min-w-0 lg:flex-1 [@media(pointer:coarse)]:h-11"
                />
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => requestBulkStatus('new')}
                  >
                    Clear decision
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => requestBulkStatus('declined')}
                  >
                    Not moving forward
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => requestBulkStatus('screening')}
                  >
                    Put on hold
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    loading={bulkBusy}
                    onClick={() => requestBulkStatus('reviewed')}
                  >
                    Move forward
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {canCreate ? (
          <>
            <AddCandidateDialog
              open={showAddForm}
              onOpenChange={setShowAddForm}
              jobId={jobId}
              jobTitle={job.title}
              onAdded={() => {
                touchElsewhere();
                void refreshList();
              }}
            />
            <ImportCandidatesDialog
              open={showImportForm}
              onOpenChange={setShowImportForm}
              jobId={jobId}
              jobTitle={job.title}
              onImported={() => {
                touchElsewhere();
                void refreshList();
              }}
            />
          </>
        ) : null}

        <Dialog
          open={pendingBulkStatus != null}
          onOpenChange={(open) => {
            if (!open && !bulkBusy) {
              setPendingBulkStatus(null);
              setBulkConfirmText('');
            }
          }}
        >
          <DialogContent hideClose={bulkBusy} className="w-[min(28rem,calc(100vw-2rem))]">
            {pendingBulkStatus ? (
              <>
                <DialogHeader>
                  <DialogTitle>Update {people(selectedIds.size)} at once?</DialogTitle>
                  <DialogDescription>
                    Each one shows as {decisionLabel(pendingBulkStatus, stages)}. You can undo it right after.
                  </DialogDescription>
                </DialogHeader>
                <Field label={`Type “${CONFIRM_PHRASE[pendingBulkStatus]}” to confirm`}>
                  <Input value={bulkConfirmText} onChange={(e) => setBulkConfirmText(e.target.value)} autoFocus />
                </Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => {
                      setPendingBulkStatus(null);
                      setBulkConfirmText('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    loading={bulkBusy}
                    disabled={bulkConfirmText.trim().toLowerCase() !== CONFIRM_PHRASE[pendingBulkStatus]}
                    onClick={() => void bulkStatus(pendingBulkStatus)}
                  >
                    Update {people(selectedIds.size)}
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </DialogContent>
        </Dialog>

        {shownRow ? (
          <CandidateDetailSheet
            open={Boolean(openRow)}
            row={shownRow}
            job={job}
            jobId={jobId}
            sheetTab={sheetTab ?? defaultTab(shownRow)}
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
            callNotice={callNoticeByCandidate[shownRow.candidateId]}
            callingCandidateId={callingCandidateId}
            liveOutbound={liveOutboundByCandidate[shownRow.candidateId]}
            onOutbound={onOutbound}
            agentPublished={agentPublished === true}
            outboundPhone={outboundPhone}
            screenCandidate={screenCandidate}
            setScreenCandidate={setScreenCandidate}
            showCallHistoryLink={searchParams.get('history') === '1'}
            onCloseAutoFocus={(event) => {
              // Back to this candidate's row, wherever J and K left the sheet.
              const i = pagedAssignments.findIndex((a) => a.candidateId === shownRow.candidateId);
              const el = rowTitles()[i];
              if (!el) return;
              event.preventDefault();
              el.focus();
              setListCursor(i);
            }}
          />
        ) : null}
      </PageMain>
    </AppShell>
  );
}
