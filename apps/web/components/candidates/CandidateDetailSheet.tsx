'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetClose,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Field, Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/page';
import { PhoneField } from '@/components/PhoneField';
import {
  CallMonitor,
  resolveOutboundMonitorStatus,
} from '@/components/calls/CallMonitor';
import { VoiceTestPanel } from '@/src/integrations/elevenlabs/VoiceTestPanel';
import type {
  CandidateStageHistoryEvent,
  Job,
  JobCandidateAssignment,
} from '@/lib/api';
import {
  CALL_STATUS_LABEL,
  PIPELINE_STATUS_LABEL,
} from '@/lib/status-labels';
import { cn } from '@/lib/utils';
import { ReviewPanel } from './ReviewPanel';

const ASSIGNMENT_STATUSES = ['new', 'screening', 'reviewed'] as const;

export type CandidateSheetTab = 'overview' | 'screen' | 'results';

export type CandidateLiveOutbound = {
  voiceSessionId: string;
  agentId: string;
  status: string;
};

export type CandidateDetailSheetProps = {
  open: boolean;
  row: JobCandidateAssignment;
  job: Job;
  jobId: string;
  sheetTab: CandidateSheetTab;
  setSheetTab: (tab: CandidateSheetTab) => void;
  can: (permission: string) => boolean;
  canScreen: boolean;
  selectedVisibleIndex: number;
  visibleCount: number;
  goRelativeCandidate: (delta: number) => void;
  closeCandidate: () => void;
  sheetStageReason: string;
  setSheetStageReason: (value: string) => void;
  onAssignmentStatusChange: (
    candidateId: string,
    status: (typeof ASSIGNMENT_STATUSES)[number],
  ) => void | Promise<void>;
  stageHistory: CandidateStageHistoryEvent[];
  stageHistoryLoading: boolean;
  phoneDrafts: Record<string, string>;
  setPhoneDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  savingPhoneId: string | null;
  onSavePhone: (candidateId: string) => void | Promise<void>;
  openAskCandidateId: string | null;
  setOpenAskCandidateId: (id: string | null) => void;
  callNotice: { kind: 'ok' | 'err'; text: string } | undefined;
  callingCandidateId: string | null;
  liveOutbound: CandidateLiveOutbound | undefined;
  onOutbound: (candidateId: string) => void | Promise<void>;
  agentPublished: boolean;
  outboundPhone: boolean;
  screenCandidate: { id: string; fullName: string } | null;
  setScreenCandidate: (
    value: { id: string; fullName: string } | null,
  ) => void;
  showCallHistoryLink: boolean;
};

export function CandidateDetailSheet({
  open,
  row,
  job,
  jobId,
  sheetTab,
  setSheetTab,
  can,
  canScreen,
  selectedVisibleIndex,
  visibleCount,
  goRelativeCandidate,
  closeCandidate,
  sheetStageReason,
  setSheetStageReason,
  onAssignmentStatusChange,
  stageHistory,
  stageHistoryLoading,
  phoneDrafts,
  setPhoneDrafts,
  savingPhoneId,
  onSavePhone,
  openAskCandidateId,
  setOpenAskCandidateId,
  callNotice,
  callingCandidateId,
  liveOutbound,
  onOutbound,
  agentPublished,
  outboundPhone,
  screenCandidate,
  setScreenCandidate,
  showCallHistoryLink,
}: CandidateDetailSheetProps) {
  const [closeBlocked, setCloseBlocked] = useState(false);
  const sheetBusy =
    callingCandidateId === row.candidateId ||
    Boolean(liveOutbound) ||
    screenCandidate?.id === row.candidateId;

  useEffect(() => {
    if (!sheetBusy) setCloseBlocked(false);
  }, [sheetBusy]);

  const phoneDirty = Boolean(
    phoneDrafts[row.candidateId] !== undefined &&
      (phoneDrafts[row.candidateId] ?? '').trim() !==
        (row.candidate.phone ?? '').trim(),
  );

  const callDisabled =
    callingCandidateId === row.candidateId ||
    !agentPublished ||
    !outboundPhone ||
    !(row.candidate.phone?.trim()) ||
    phoneDirty;

  function blockCloseWhileBusy() {
    setCloseBlocked(true);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (sheetBusy) {
            blockCloseWhileBusy();
            return;
          }
          closeCandidate();
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-[min(32rem,calc(100vw-0.75rem))] sm:w-[min(40rem,calc(100vw-2rem))]"
        onPointerDownOutside={(e) => {
          if (sheetBusy) {
            e.preventDefault();
            blockCloseWhileBusy();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (sheetBusy) {
            e.preventDefault();
            blockCloseWhileBusy();
          }
        }}
      >
        <SheetHeader>
          <div className="flex items-start justify-between gap-2 pr-6">
            <div className="min-w-0">
              <SheetTitle>{row.candidate.fullName}</SheetTitle>
              <SheetDescription className="mt-1">
                {job.title}
                {row.candidate.source
                  ? ` · Added via ${row.candidate.source}`
                  : ''}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Previous candidate (K)"
                  disabled={selectedVisibleIndex <= 0}
                  onClick={() => goRelativeCandidate(-1)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Next candidate (J)"
                  disabled={
                    selectedVisibleIndex < 0 ||
                    selectedVisibleIndex >= visibleCount - 1
                  }
                  onClick={() => goRelativeCandidate(1)}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <p className="m-0 text-[11px] tabular-nums text-[var(--foreground-muted)]">
                <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                  J
                </kbd>
                <span className="mx-0.5">/</span>
                <kbd className="rounded border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-1 font-mono text-[10px]">
                  K
                </kbd>
                <span className="ml-1">next / prev</span>
              </p>
            </div>
          </div>
          <div
            className="mt-3 flex flex-wrap gap-1"
            role="tablist"
            aria-label="Person sections"
          >
            {(
              [
                ['overview', 'Person'],
                ['screen', 'Call'],
                ['results', 'Answers'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={sheetTab === key}
                onClick={() => setSheetTab(key)}
                className={cn(
                  'rounded-md border-0 px-2.5 py-1 text-[12px] font-medium transition-colors duration-fast',
                  sheetTab === key
                    ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                    : 'bg-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </SheetHeader>

        <SheetBody>
          {sheetTab === 'overview' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-3 py-2.5">
                  <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                    Next step
                  </p>
                  <p className="mt-1 mb-0 text-[12px] text-[var(--foreground-tertiary)]">
                    Put on hold for later or send back to the queue. Use Move
                    forward in the footer when ready.
                  </p>
                  {can('jobs.update') ? (
                    <div className="mt-2 space-y-2">
                      <Field label="Reason (optional)">
                        <Input
                          value={sheetStageReason}
                          onChange={(e) => setSheetStageReason(e.target.value)}
                          placeholder="Short note for the audit log"
                          maxLength={500}
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={row.status === 'screening'}
                          onClick={() =>
                            void onAssignmentStatusChange(
                              row.candidateId,
                              'screening',
                            )
                          }
                        >
                          Put on hold
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={row.status === 'new'}
                          onClick={() =>
                            void onAssignmentStatusChange(
                              row.candidateId,
                              'new',
                            )
                          }
                        >
                          Back to queue
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 mb-0 text-sm font-medium">
                      {PIPELINE_STATUS_LABEL[
                        row.status as (typeof ASSIGNMENT_STATUSES)[number]
                      ] ?? row.status}
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-[var(--surface-secondary)] px-3 py-2.5">
                  <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                    Phone screen
                  </p>
                  <p className="mt-1 mb-0 text-[12px] text-[var(--foreground-tertiary)]">
                    Whether a live call has been placed
                  </p>
                  <p className="mt-2 mb-0">
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
                  </p>
                </div>
              </div>

              <div>
                <p className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                  Stage history
                </p>
                {stageHistoryLoading ? (
                  <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                    Loading history…
                  </p>
                ) : stageHistory.length === 0 ? (
                  <p className="m-0 text-[13px] text-[var(--foreground-tertiary)]">
                    No stage moves recorded yet for this person.
                  </p>
                ) : (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {stageHistory.slice(0, 40).map((ev) => {
                      const fromLabel =
                        ev.previous &&
                        (ev.previous === 'new' ||
                          ev.previous === 'screening' ||
                          ev.previous === 'reviewed')
                          ? PIPELINE_STATUS_LABEL[ev.previous]
                          : ev.previous;
                      const toLabel =
                        ev.status &&
                        (ev.status === 'new' ||
                          ev.status === 'screening' ||
                          ev.status === 'reviewed')
                          ? PIPELINE_STATUS_LABEL[ev.status]
                          : ev.status;
                      return (
                        <li
                          key={ev.id}
                          className="px-0 py-1.5 text-[13px]"
                        >
                          <span className="font-medium text-[var(--foreground)]">
                            {fromLabel ?? '—'} → {toLabel ?? '—'}
                          </span>
                          {ev.reason?.trim() ? (
                            <span className="mt-0.5 block text-[12px] text-[var(--foreground-secondary)]">
                              {ev.reason.trim()}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-[12px] text-[var(--foreground-tertiary)]">
                            {ev.actorName ? `${ev.actorName} · ` : ''}
                            {new Date(ev.createdAt).toLocaleString()}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {can('candidates.read_pii') && can('candidates.update') ? (
                <div>
                  <p className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                    Mobile
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <PhoneField
                      value={
                        phoneDrafts[row.candidateId] ??
                        row.candidate.phone ??
                        ''
                      }
                      onChange={(e164) =>
                        setPhoneDrafts((prev) => ({
                          ...prev,
                          [row.candidateId]: e164,
                        }))
                      }
                      aria-label={`Mobile for ${row.candidate.fullName}`}
                      placeholder="Mobile number"
                      className="min-w-[15rem]"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingPhoneId === row.candidateId}
                      onClick={() => void onSavePhone(row.candidateId)}
                    >
                      {savingPhoneId === row.candidateId
                        ? 'Saving…'
                        : row.candidate.phone?.trim()
                          ? 'Update mobile'
                          : 'Save mobile'}
                    </Button>
                  </div>
                </div>
              ) : null}

              {canScreen && job.agentId ? (
                <div className="flex flex-wrap gap-2">
                  {can('calls.read_transcript') ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSheetTab('results');
                        setOpenAskCandidateId(row.candidateId);
                      }}
                    >
                      Ask about call
                    </Button>
                  ) : null}
                  {can('agents.sessions.read') ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/calls?candidateId=${encodeURIComponent(row.candidateId)}&jobId=${encodeURIComponent(jobId)}`}
                      >
                        Call history
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSheetTab('screen')}
                  >
                    Open Call
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {sheetTab === 'screen' ? (
            <div className="space-y-3">
              {callNotice ? (
                <Notice kind={callNotice.kind === 'err' ? 'err' : 'ok'}>
                  {callNotice.text}
                </Notice>
              ) : null}

              <div className="rounded-md border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-3 py-2.5">
                <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                  Call status
                </p>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground)]">
                  {callingCandidateId === row.candidateId
                    ? 'Dialing their mobile…'
                    : liveOutbound?.status === 'active' ||
                        liveOutbound?.status === 'pending'
                      ? 'Call in progress'
                      : liveOutbound?.status === 'failed'
                        ? 'Last call failed'
                        : liveOutbound?.status === 'ended' ||
                            liveOutbound?.status === 'completed'
                          ? 'Last call ended'
                          : row.candidate.phone?.trim()
                            ? 'Ready to call'
                            : 'Add a mobile number on Person before calling'}
                </p>
                {row.candidate.phone?.trim() ? (
                  <p className="mt-0.5 mb-0 text-xs text-[var(--foreground-tertiary)]">
                    Mobile on file
                  </p>
                ) : null}
              </div>

              {(callingCandidateId === row.candidateId ||
                callNotice ||
                liveOutbound) && (
                <CallMonitor
                  status={resolveOutboundMonitorStatus({
                    dialing: callingCandidateId === row.candidateId,
                    noticeKind: callNotice?.kind ?? null,
                    sessionApiStatus: liveOutbound?.status ?? null,
                  })}
                  candidateName={row.candidate.fullName}
                  jobTitle={job.title}
                  failureDetail={
                    callNotice?.kind === 'err' ? callNotice.text : null
                  }
                  busy={callingCandidateId === row.candidateId}
                  onRetry={
                    callNotice?.kind === 'err' ||
                    liveOutbound?.status === 'failed' ||
                    liveOutbound?.status === 'ended'
                      ? () => void onOutbound(row.candidateId)
                      : undefined
                  }
                />
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={callDisabled}
                  onClick={() => void onOutbound(row.candidateId)}
                >
                  {callingCandidateId === row.candidateId
                    ? 'Calling…'
                    : 'Call their mobile'}
                </Button>
                {!agentPublished ? (
                  <p className="m-0 w-full text-xs text-[var(--foreground-tertiary)]">
                    Publish the hiring voice before placing calls.
                  </p>
                ) : !outboundPhone ? (
                  <p className="m-0 w-full text-xs text-[var(--foreground-tertiary)]">
                    Outbound calling is not set up for this workspace.
                  </p>
                ) : !(row.candidate.phone?.trim()) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSheetTab('overview')}
                  >
                    Add mobile on Person
                  </Button>
                ) : null}
              </div>

              {screenCandidate?.id === row.candidateId && job.agentId ? (
                <div>
                  <VoiceTestPanel
                    agentId={job.agentId}
                    canTest={canScreen}
                    agentPublished={agentPublished}
                    jobId={jobId}
                    candidateId={row.candidateId}
                    candidateName={row.candidate.fullName}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setScreenCandidate(null)}
                  >
                    Close browser practice
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border border-[var(--separator-subtle)] px-3 py-2.5">
                  <p className="m-0 text-xs text-[var(--foreground-tertiary)]">
                    Practice in the browser speaks with you — it does not call
                    the candidate.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={!agentPublished}
                    onClick={() =>
                      setScreenCandidate({
                        id: row.candidateId,
                        fullName: row.candidate.fullName,
                      })
                    }
                  >
                    Test in browser
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {sheetTab === 'results' ? (
            <div className="space-y-3">
              <ReviewPanel
                jobId={jobId}
                candidateId={row.candidateId}
                agentId={job.agentId}
                screeningQuestions={job.screeningQuestions ?? []}
                canPlayRecording={can('calls.read_recording')}
                canReadTranscript={can('calls.read_transcript')}
                canCallAgain={Boolean(
                  can('calls.initiate') &&
                    agentPublished &&
                    outboundPhone &&
                    job.agentId &&
                    row.candidate.phone?.trim(),
                )}
                calling={callingCandidateId === row.candidateId}
                onCallAgain={() => void onOutbound(row.candidateId)}
                forceOpenAsk={openAskCandidateId === row.candidateId}
                onAskOpened={() => setOpenAskCandidateId(null)}
              />
              {showCallHistoryLink && can('agents.sessions.read') ? (
                <div className="border-t border-[var(--separator-subtle)] pt-3">
                  <Button asChild size="sm">
                    <Link
                      href={`/calls?candidateId=${encodeURIComponent(row.candidateId)}&jobId=${encodeURIComponent(jobId)}`}
                    >
                      Open call transcript
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetBody>

        <SheetFooter className="flex-wrap justify-between gap-3 sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  if (sheetBusy) {
                    e.preventDefault();
                    blockCloseWhileBusy();
                  }
                }}
              >
                Close
              </Button>
            </SheetClose>
            {closeBlocked ? (
              <p
                className="m-0 max-w-[14rem] text-[12px] leading-snug text-[var(--foreground-tertiary)]"
                role="status"
              >
                Finish or stop the call before closing.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {can('jobs.update') ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={row.status === 'reviewed'}
                onClick={() =>
                  void onAssignmentStatusChange(row.candidateId, 'reviewed')
                }
              >
                Move forward
              </Button>
            ) : null}
            {canScreen && job.agentId ? (
              <Button
                type="button"
                size="sm"
                disabled={callDisabled}
                onClick={() => {
                  setSheetTab('screen');
                  void onOutbound(row.candidateId);
                }}
              >
                {callingCandidateId === row.candidateId
                  ? 'Calling…'
                  : 'Call their mobile'}
              </Button>
            ) : null}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
