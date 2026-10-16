'use client';

import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, PhoneOutgoing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { IconTile } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Alert } from '@/components/ui/notice';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StageTag, StatusTag } from '@/components/ui/state-tag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { firstNameOf } from '@/components/home/copy';
import { LiveCallCard } from '@/components/shared/live-call-card';
import { UserInitials } from '@/components/shared/user-initials';
import { PhoneField } from '@/components/PhoneField';
import { VoiceTestPanel } from '@/src/integrations/elevenlabs/VoiceTestPanel';
import type { CandidateStage, CandidateStageHistoryEvent, Job, JobCandidateAssignment } from '@/lib/api';
import { formatPhone, formatPhoneMasked, formatWhen } from '@/lib/format';
import { toPublicId } from '@/lib/public-id';
import { useUseCase } from '@/lib/use-cases';
import { decisionLabel } from './decisions';
import { ReviewPanel } from './ReviewPanel';

export type CandidateSheetTab = 'overview' | 'screen' | 'results';

/** A phone call placed from this page, as the last poll saw it. */
export type CandidateLiveOutbound = {
  voiceSessionId: string;
  agentId: string;
  status: string;
  startedAt?: string | null;
  failureReason?: string | null;
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
  onAssignmentStatusChange: (candidateId: string, status: CandidateStage) => void | Promise<void>;
  stageHistory: CandidateStageHistoryEvent[];
  stageHistoryLoading: boolean;
  phoneDrafts: Record<string, string>;
  setPhoneDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  savingPhoneId: string | null;
  onSavePhone: (candidateId: string) => void | Promise<void>;
  callNotice: { kind: 'ok' | 'err'; text: string } | undefined;
  callingCandidateId: string | null;
  liveOutbound: CandidateLiveOutbound | undefined;
  onOutbound: (candidateId: string) => void | Promise<void>;
  agentPublished: boolean;
  outboundPhone: boolean;
  screenCandidate: { id: string; fullName: string } | null;
  setScreenCandidate: (value: { id: string; fullName: string } | null) => void;
  showCallHistoryLink: boolean;
  /** Runs as the sheet closes, before focus goes back: point focus at this candidate's row. */
  onCloseAutoFocus?: (event: Event) => void;
};

// A link-look button inside a sentence: as tall as the text around it.
const INLINE = 'h-auto p-0 align-baseline [@media(pointer:coarse)]:h-auto';

const SOURCE: Record<string, string> = { resume: 'From a resume', import: 'From a CSV', csv: 'From a CSV' };

/** How someone got onto the job, in words. */
export function sourceLabel(source: string | null | undefined): string {
  return (source && SOURCE[source]) || 'Added by hand';
}

/**
 * One candidate, opened from the board: their call results first (summary, answers,
 * transcript, recording), then calling, then their details and decision history. The
 * decision buttons stay in the footer on every tab.
 */
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
  callNotice,
  callingCandidateId,
  liveOutbound,
  onOutbound,
  agentPublished,
  outboundPhone,
  screenCandidate,
  setScreenCandidate,
  showCallHistoryLink,
  onCloseAutoFocus,
}: CandidateDetailSheetProps) {
  const { stages } = useUseCase();
  const [confirmCall, setConfirmCall] = useState(false);
  const callHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tabs = useRef<HTMLDivElement>(null);

  const name = row.candidate.fullName;
  const first = firstNameOf(name) || name;
  const phone = row.candidate.phone?.trim() ?? '';
  const masked = formatPhoneMasked(phone);
  const dialing = callingCandidateId === row.candidateId;
  const onCall = liveOutbound?.status === 'pending' || liveOutbound?.status === 'active';
  const testing = screenCandidate?.id === row.candidateId;
  // A test call lives in this sheet and a dial is in flight: neither survives a close.
  const busyReason = dialing ? 'Placing the call. One moment.' : testing ? 'End the test call before closing.' : undefined;
  const questions = job.screeningQuestions?.length ?? 0;

  const draft = phoneDrafts[row.candidateId];
  const phoneDirty = draft !== undefined && draft.trim() !== phone;

  // Why a phone call can't go out now; null when it can.
  const blocker: ReactNode = !job.agentId ? (
    <>
      This job has no AI hiring agent yet.{' '}
      <Link href={`/jobs/${toPublicId(job.id)}`} className="font-medium text-text underline underline-offset-4">
        Add one in Setup
      </Link>
    </>
  ) : !agentPublished ? (
    <>
      The AI hiring agent isn’t live yet.{' '}
      <Link href={`/agents/${toPublicId(job.agentId)}`} className="font-medium text-text underline underline-offset-4">
        Open the agent
      </Link>
    </>
  ) : !outboundPhone ? (
    'Your workspace’s calling number isn’t connected yet, so phone calls can’t go out. Try a test call in your browser below.'
  ) : !phone ? (
    <>
      {first} has no mobile number yet.{' '}
      <Button type="button" variant="link" className={INLINE} onClick={() => setSheetTab('overview')}>
        Add it in Details
      </Button>
    </>
  ) : phoneDirty ? (
    <>
      Save the new mobile number first.{' '}
      <Button type="button" variant="link" className={INLINE} onClick={() => setSheetTab('overview')}>
        Go to Details
      </Button>
    </>
  ) : null;
  const mayCall = can('calls.initiate') && !blocker;

  function askToCall() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmCall(true);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeCandidate();
      }}
    >
      <SheetContent
        side="right"
        closeBlockedReason={busyReason}
        onCloseAutoFocus={onCloseAutoFocus}
        // Start on the open tab, not on Previous (whose tooltip would take the first Escape).
        onOpenAutoFocus={(event) => {
          const tab = tabs.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
          if (!tab) return;
          event.preventDefault();
          tab.focus();
        }}
      >
        <Tabs
          value={sheetTab}
          onValueChange={(value) => setSheetTab(value as CandidateSheetTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader className="gap-0 pb-0 sm:pb-0">
            <div className="flex items-start gap-3">
              <UserInitials name={name} size="lg" />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate">{name}</SheetTitle>
                <SheetDescription className="truncate">{job.title}</SheetDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  label="Previous candidate (K)"
                  variant="quiet"
                  size="sm"
                  tooltipSide="bottom"
                  disabled={Boolean(busyReason) || selectedVisibleIndex <= 0}
                  onClick={() => goRelativeCandidate(-1)}
                >
                  <ChevronUp aria-hidden strokeWidth={1.5} />
                </IconButton>
                <IconButton
                  label="Next candidate (J)"
                  variant="quiet"
                  size="sm"
                  tooltipSide="bottom"
                  disabled={Boolean(busyReason) || selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleCount - 1}
                  onClick={() => goRelativeCandidate(1)}
                >
                  <ChevronDown aria-hidden strokeWidth={1.5} />
                </IconButton>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusTag
                domain="call"
                value={row.callStatus ?? 'not_called'}
                stage={row.status}
                failureReason={row.failureReason}
              />
              {row.status !== 'new' ? <StageTag value={row.status} /> : null}
            </div>
            <TabsList ref={tabs} aria-label={`${first}’s sections`} className="-mx-3 mt-2 shadow-none">
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="screen">Call</TabsTrigger>
              <TabsTrigger value="overview">Details</TabsTrigger>
            </TabsList>
          </SheetHeader>

          <SheetBody>
            <TabsContent value="results" className="pt-0">
              <ReviewPanel
                key={row.candidateId}
                jobId={jobId}
                candidateId={row.candidateId}
                candidateName={name}
                stage={row.status}
                agentId={job.agentId}
                screeningQuestions={job.screeningQuestions ?? []}
                canPlayRecording={can('calls.read_recording')}
                canReadTranscript={can('calls.read_transcript')}
                canCallAgain={mayCall && !onCall}
                calling={dialing}
                onCallAgain={askToCall}
                onGoToCall={() => setSheetTab('screen')}
              />
              {showCallHistoryLink && can('agents.sessions.read') ? (
                <div className="mt-5 border-t border-border pt-4">
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      href={`/calls?candidateId=${encodeURIComponent(row.candidateId)}&jobId=${encodeURIComponent(jobId)}`}
                    >
                      Open in Calls
                    </Link>
                  </Button>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="screen" className="grid gap-4 pt-0">
              {callNotice?.kind === 'err' ? (
                <Alert kind="error" title="The call didn’t start">
                  {callNotice.text}
                </Alert>
              ) : dialing || liveOutbound ? (
                <LiveCallCard
                  name={name}
                  workLabel={job.title}
                  state={dialing ? 'dialing' : liveOutbound?.status}
                  startedAt={liveOutbound?.startedAt}
                  failureReason={liveOutbound?.failureReason ?? row.failureReason}
                  stage={row.status}
                  phone={phone}
                  onRetry={mayCall ? () => void onOutbound(row.candidateId) : undefined}
                  retrying={dialing}
                />
              ) : null}

              {can('calls.initiate') ? (
                <section className="flex gap-4 rounded-card border border-border bg-canvas p-5">
                  <IconTile className="max-sm:hidden">
                    <PhoneOutgoing />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <h3 ref={callHeading} tabIndex={-1} className="m-0 text-title font-semibold text-text">
                      Phone call
                    </h3>
                    <p className="mb-0 mt-1 text-body text-text-2">
                      The AI hiring agent calls {first}
                      {masked ? ` on ${masked}` : ''} and asks{' '}
                      {questions > 0
                        ? `the ${questions === 1 ? 'question' : `${questions} questions`} you set for this job.`
                        : 'about this job.'}
                    </p>
                    {blocker ? <p className="mb-0 mt-3 text-body text-text">{blocker}</p> : null}
                    <Button
                      type="button"
                      className="mt-4"
                      disabled={!mayCall || onCall}
                      loading={dialing}
                      onClick={askToCall}
                    >
                      <PhoneOutgoing aria-hidden strokeWidth={1.5} />
                      Call {first} now
                    </Button>
                  </div>
                </section>
              ) : null}

              {/* One card: what a test call is, Start (which asks first), then the call and its results. */}
              {canScreen && job.agentId ? (
                <VoiceTestPanel
                  agentId={job.agentId}
                  canTest={canScreen}
                  agentPublished={agentPublished}
                  jobId={jobId}
                  candidateId={row.candidateId}
                  candidateName={name}
                  questions={job.screeningQuestions ?? []}
                  headingLevel={3}
                  // Holds the sheet on this candidate while the call runs.
                  onActiveChange={(on) => setScreenCandidate(on ? { id: row.candidateId, fullName: name } : null)}
                />
              ) : canScreen && !can('calls.initiate') ? (
                <p className="m-0 text-body text-text-2">
                  Test calls work once this job has an AI hiring agent.{' '}
                  <Link
                    href={`/jobs/${toPublicId(job.id)}`}
                    className="font-medium text-text underline underline-offset-4"
                  >
                    Add one in Setup
                  </Link>
                </p>
              ) : null}

              {!can('calls.initiate') && !canScreen ? (
                <p className="m-0 text-body text-text-2">
                  Calls are placed by the people allowed to call candidates. Ask a workspace admin if you need to.
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="overview" className="grid gap-7 pt-0">
              <section className="grid gap-2">
                <h3 className="m-0 text-label font-semibold text-text">Mobile number</h3>
                {can('candidates.read_pii') && can('candidates.update') ? (
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void onSavePhone(row.candidateId);
                    }}
                  >
                    <PhoneField
                      value={draft ?? phone}
                      onChange={(e164) => setPhoneDrafts((prev) => ({ ...prev, [row.candidateId]: e164 }))}
                      aria-label={`Mobile number for ${name}`}
                      placeholder="Mobile number"
                      // Its own flex-1 would squash it to nothing in the phone's column layout.
                      className="flex-none sm:flex-1"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      loading={savingPhoneId === row.candidateId}
                      disabled={!phoneDirty && savingPhoneId !== row.candidateId}
                    >
                      Save
                    </Button>
                  </form>
                ) : can('candidates.read_pii') ? (
                  <p className="m-0 text-body tabular-nums text-text">{phone ? formatPhone(phone) : 'Not added yet'}</p>
                ) : (
                  <p className="m-0 text-body text-text-2">Shown only to the people allowed to see contact details.</p>
                )}
              </section>

              <section className="grid gap-3">
                <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-label font-semibold text-text">Decision</h3>
                  {row.status !== 'new' && can('jobs.update') ? (
                    <Button
                      type="button"
                      variant="tertiary"
                      size="sm"
                      onClick={() => void onAssignmentStatusChange(row.candidateId, 'new')}
                    >
                      Clear decision
                    </Button>
                  ) : null}
                </div>
                <div>
                  {row.status === 'new' ? (
                    <p className="m-0 text-body text-text-2">No decision yet</p>
                  ) : (
                    <StageTag value={row.status} />
                  )}
                </div>
                {can('jobs.update') ? (
                  <Field
                    label="Reason for your next decision (optional)"
                    hint="Kept with the decision in the activity log."
                  >
                    <Input
                      value={sheetStageReason}
                      onChange={(e) => setSheetStageReason(e.target.value)}
                      placeholder="For example: strong on WMS, check salary"
                      maxLength={500}
                    />
                  </Field>
                ) : null}
                <div>
                  <h4 className="m-0 text-meta font-medium text-text-2">History</h4>
                  {stageHistoryLoading ? (
                    <div aria-busy="true" className="mt-3 grid gap-2">
                      <span className="sr-only">Loading the history</span>
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ) : stageHistory.length === 0 ? (
                    <p className="m-0 mt-1 text-body text-text-3">No decisions recorded yet.</p>
                  ) : (
                    <ul role="list" className="m-0 mt-1 list-none divide-y divide-border p-0">
                      {stageHistory.slice(0, 40).map((ev) => {
                        const when = formatWhen(ev.createdAt);
                        return (
                          <li key={ev.id} className="grid gap-0.5 py-3">
                            <p className="m-0 text-body text-text">
                              {ev.actorName ? `${ev.actorName} changed it` : 'Changed'} from{' '}
                              {decisionLabel(ev.previous, stages)} to{' '}
                              <span className="font-medium">{decisionLabel(ev.status, stages)}</span>
                            </p>
                            {ev.reason?.trim() ? (
                              <p className="m-0 text-body text-text-2 [overflow-wrap:anywhere]">{ev.reason.trim()}</p>
                            ) : null}
                            {when ? <p className="m-0 text-meta tabular-nums text-text-3">{when}</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              <section className="grid gap-1">
                <h3 className="m-0 text-label font-semibold text-text">Added</h3>
                <p className="m-0 text-body text-text-2">{sourceLabel(row.candidate.source)}</p>
              </section>

              {can('agents.sessions.read') ? (
                <div>
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      href={`/calls?candidateId=${encodeURIComponent(row.candidateId)}&jobId=${encodeURIComponent(jobId)}`}
                    >
                      See every call with {first}
                    </Link>
                  </Button>
                </div>
              ) : null}
            </TabsContent>
          </SheetBody>

          {can('jobs.update') ? (
            <SheetFooter className="justify-between">
              <p className="m-0 hidden items-center gap-1.5 text-meta text-text-3 lg:flex [@media(pointer:coarse)]:hidden">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd>
                next and previous
              </p>
              <div className="ml-auto grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={row.status === 'declined'}
                  onClick={() => void onAssignmentStatusChange(row.candidateId, 'declined')}
                >
                  Not moving forward
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={row.status === 'screening'}
                  onClick={() => void onAssignmentStatusChange(row.candidateId, 'screening')}
                >
                  Put on hold
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="col-span-2"
                  disabled={row.status === 'reviewed'}
                  onClick={() => void onAssignmentStatusChange(row.candidateId, 'reviewed')}
                >
                  Move forward
                </Button>
              </div>
            </SheetFooter>
          ) : null}
        </Tabs>

        <ConfirmDialog
          open={confirmCall}
          onOpenChange={setConfirmCall}
          title={`Call ${name} now?`}
          body={`This places a real phone call${masked ? ` to ${masked}` : ''}. The AI hiring agent asks ${
            questions > 0 ? `the ${questions === 1 ? 'question' : `${questions} questions`} you set` : 'about the job'
          } for ${job.title}.`}
          confirmLabel="Call now"
          tone="real-world"
          busy={dialing}
          onConfirm={() => {
            setSheetTab('screen');
            void Promise.resolve(onOutbound(row.candidateId)).finally(() => setConfirmCall(false));
          }}
          onCloseAutoFocus={(event) => {
            // Back to the button that asked, unless it went with the tab or is disabled by the call.
            const el = opener.current;
            if (el?.isConnected && !el.matches(':disabled')) return;
            event.preventDefault();
            callHeading.current?.focus();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
