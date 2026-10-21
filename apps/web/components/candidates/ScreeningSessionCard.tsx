'use client';

import { useRef, useState } from 'react';
import { PhoneOutgoing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentStateFor } from '@/components/shared/agent-state';
import { AnswersList } from '@/components/shared/answers-list';
import { RecordingPlayer, type RecordingPlayerHandle } from '@/components/shared/recording-player';
import { TranscriptCard, toTranscriptTurns } from '@/components/shared/transcript';
import { voiceSessionRecordingUrl, type CandidateScreeningResults } from '@/lib/api';
import { callStateKey } from '@/lib/status-labels';
import { answerItems } from './answers';

export function sessionHasResults(session: CandidateScreeningResults): boolean {
  return Boolean(session.summary?.trim() || session.transcript?.length || session.structuredAnswers);
}

/**
 * One call's evidence, in reading order: the summary, the answers to the job's questions,
 * then the transcript card with the recording at its foot. The agent's face acts out what
 * really happened (done, missed, writing up); the tag says it in words.
 */
export function ScreeningSessionCard({
  session,
  agentId,
  candidateName,
  stage,
  screeningQuestions,
  canPlayRecording,
  canCallAgain,
  calling,
  onCallAgain,
}: {
  session: CandidateScreeningResults;
  agentId: string | null;
  candidateName: string;
  /** The candidate's stage: a finished call reads "Ready for review" while it is undecided. */
  stage: string;
  screeningQuestions: readonly { id: string; label: string }[];
  canPlayRecording: boolean;
  canCallAgain: boolean;
  calling: boolean;
  /** Asks to place another real call (the caller confirms first). */
  onCallAgain?: () => void;
}) {
  const player = useRef<RecordingPlayerHandle>(null);
  const [time, setTime] = useState<number | null>(null);
  // The server said this call kept no recording: stop promising one in the header.
  const [noRecording, setNoRecording] = useState(false);
  const turns = toTranscriptTurns(session.transcript, candidateName);
  const answers = answerItems(session.structuredAnswers, screeningQuestions);
  const hasResults = sessionHasResults(session);
  const live = session.status === 'pending' || session.status === 'active';
  const failed = session.status === 'failed';
  const shown = callStateKey({ callStatus: session.status, stage, hasResults, failureReason: session.failureReason });
  // Live: who spoke last. After the call: what became of it.
  const face = live ? (turns.at(-1)?.speaker === 'agent' ? 'speaking' : 'listening') : agentStateFor(shown);
  const recording =
    canPlayRecording && session.recordingAvailable && session.voiceSessionId && agentId
      ? voiceSessionRecordingUrl(agentId, session.voiceSessionId)
      : null;

  const callAgain =
    canCallAgain && onCallAgain ? (
      <Button type="button" variant="secondary" size="sm" loading={calling} onClick={onCallAgain}>
        <PhoneOutgoing aria-hidden strokeWidth={1.5} />
        Call again
      </Button>
    ) : null;

  // Nothing came back yet, or the call never connected: one line says why, in the card's foot.
  const note = failed
    ? 'The call didn’t connect, so there is nothing to review.'
    : !hasResults && !live
      ? 'The summary and answers appear here once the call is written up.'
      : null;

  return (
    <div className="grid gap-5">
      {session.summary?.trim() ? (
        <section className="rounded-card-sm bg-subtle p-4">
          <h3 className="m-0 text-label font-semibold text-text">Summary</h3>
          <p className="mb-0 mt-1.5 text-body leading-relaxed text-text [overflow-wrap:anywhere]">
            {session.summary.trim()}
          </p>
        </section>
      ) : null}

      {session.structuredAnswers && answers.length > 0 ? (
        <section className="grid gap-3">
          <h3 className="m-0 text-label font-semibold text-text">Answers</h3>
          <AnswersList items={answers} />
        </section>
      ) : null}

      <TranscriptCard
        title="AI hiring agent"
        subtitle={recording && !noRecording ? 'Transcript and recording' : turns.length > 0 ? 'Transcript' : undefined}
        agentState={face}
        turns={turns}
        currentTime={time}
        onPlayFrom={recording && !noRecording ? (at) => player.current?.seek(at) : undefined}
        label={`Transcript of the call with ${candidateName}`}
        contactLabel={candidateName}
        className={turns.length > 0 ? 'max-h-[34rem]' : undefined}
        footer={
          recording || note ? (
            <div className="grid gap-3">
              {recording ? (
                <RecordingPlayer
                  ref={player}
                  src={recording}
                  onTimeChange={setTime}
                  onMissing={() => setNoRecording(true)}
                  label={`Recording of the call with ${candidateName}`}
                />
              ) : null}
              {note ? (
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <p className="m-0 text-meta text-text-2">{note}</p>
                  {failed ? callAgain : null}
                </div>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {!failed && !live && callAgain ? <div className="flex">{callAgain}</div> : null}
    </div>
  );
}
