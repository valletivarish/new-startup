'use client';

/**
 * VoiceTestPanel: a test call in the browser (MVP-01). The person plays the candidate and
 * nobody's phone rings.
 *
 * ISOLATION: this file is the ONLY place in apps/web that imports from
 * @elevenlabs/react. All other web code imports only from lib/api.ts.
 *
 * FLOW:
 *   1. "Start test call" asks first: the call uses paid minutes and the microphone. No auto-start.
 *   2. POST /agents/:id/voice-sessions → receives { voiceSessionId, conversationToken }
 *   3. The voice SDK connects with conversationToken; the agent's face and the Listening bar
 *      follow who is talking.
 *   4. "End test call" (or the agent hanging up) marks the session ended server-side, then
 *      results are reconciled until the summary and answers land.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Mic, PhoneOff, RotateCw } from 'lucide-react';
import {
  ApiClientError,
  startVoiceSession,
  getVoiceSession,
  reconcileVoiceSession,
  endVoiceSession,
  type VoiceSession,
} from '../../../lib/api';
import { Agent } from '@/components/brand/agent';
import type { AgentState } from '@/components/brand/agent-draw';
import { answerItems } from '@/components/candidates/answers';
import { AnswersList } from '@/components/shared/answers-list';
import { ListeningBar } from '@/components/shared/listening-bar';
import { Transcript, toTranscriptTurns } from '@/components/shared/transcript';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Alert } from '@/components/ui/notice';
import { StatusTag } from '@/components/ui/state-tag';

export interface VoiceTestPanelProps {
  agentId: string;
  /** Whether the caller has agents.test permission. */
  canTest: boolean;
  /** Whether the agent is published (pre-condition to voice testing). */
  agentPublished: boolean;
  /** Optional hiring link: the test call plays a candidate on this job. */
  jobId?: string;
  candidateId?: string;
  candidateName?: string;
  /** Override heading (defaults to "Test call in your browser"). */
  title?: string;
  /** The job's questions, so the results read as question and answer. */
  questions?: readonly { id: string; label: string }[];
  /** True while a test call starts, runs or ends; false once it is over or the panel goes. */
  onActiveChange?: (active: boolean) => void;
  /** 3 inside a section that has its own h2. */
  headingLevel?: 2 | 3;
}

type PanelState = 'idle' | 'confirming' | 'connecting' | 'active' | 'ending' | 'ended' | 'error';

// What the agent's face acts out in each panel state ('active' turns 'speaking' while it talks).
const PANEL_FACE: Record<PanelState, AgentState> = {
  idle: 'idle',
  confirming: 'idle',
  connecting: 'ringing',
  active: 'listening',
  ending: 'thinking',
  ended: 'done',
  error: 'missed',
};

// The panel's state in the state map's words: the test call's own while it runs, the call's after.
function stateTag(state: PanelState, speaking: boolean) {
  switch (state) {
    case 'connecting':
      return { domain: 'voice', value: 'connecting' } as const;
    case 'active':
      return { domain: 'voice', value: speaking ? 'speaking' : 'listening' } as const;
    case 'ending':
      return { domain: 'call', value: 'results_pending' } as const;
    case 'ended':
      return { domain: 'call', value: 'ended' } as const;
    case 'error':
      return { domain: 'call', value: 'failed' } as const;
    default:
      return null;
  }
}

/**
 * A test call in the browser as one card: the agent's face, what it is, Start (which asks
 * first), the Listening bar while it runs, then the summary, answers and transcript. Mount it
 * where the test call belongs, with no card or Start button of your own around it; pass
 * onActiveChange to hold a sheet open while a call runs.
 */
export function VoiceTestPanel(props: VoiceTestPanelProps) {
  return (
    <ConversationProvider>
      <VoiceTestPanelInner {...props} />
    </ConversationProvider>
  );
}

function VoiceTestPanelInner({
  agentId,
  canTest,
  agentPublished,
  jobId,
  candidateId,
  candidateName,
  title,
  questions = [],
  onActiveChange,
  headingLevel = 2,
}: VoiceTestPanelProps) {
  const isHiringScreen = Boolean(jobId && candidateId);
  const heading = title ?? 'Test call in your browser';
  const who = isHiringScreen && candidateName ? candidateName : 'the candidate';
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const headingId = useId();
  const [state, setState] = useState<PanelState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Keeps keyboard focus in the panel when the button that had it goes with the state.
  const panel = useRef<HTMLElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const holdFocus = () => {
    refocus.current = Boolean(panel.current?.contains(document.activeElement));
  };

  // The ElevenLabs React SDK conversation hook.
  // It is instantiated here even in idle state — the SDK requires this to
  // call startSession before the WebRTC handshake occurs.
  const conversation = useConversation({
    onConnect: () => {
      setConnectedAt(Date.now());
      setNow(Date.now());
      setState('active');
      setNotice(null);
    },
    onDisconnect: () => {
      setState('ending');
      setNotice(null);
      void handleSessionEnded();
    },
    onError: (msg: string) => {
      setState('error');
      // The SDK's own words can name the provider: show ours unless it is about the microphone.
      setNotice(micPermissionMessage(msg) ?? 'The connection dropped. Check your internet and microphone, then try again.');
      const vsId = voiceSessionIdRef.current;
      if (vsId) {
        void endVoiceSession(agentId, vsId).catch(() => undefined);
      }
    },
    onMessage: (_msg: { source: string; message: string }) => {
      // Re-fetch session state to update the transcript display
      if (voiceSessionIdRef.current) {
        void refreshSession(voiceSessionIdRef.current);
      }
    },
  });

  const refreshSession = useCallback(async (vsId: string) => {
    try {
      const result = await getVoiceSession(agentId, vsId);
      setVoiceSession(result.voiceSession);
    } catch {
      // Non-fatal: display may be stale but session continues
    }
  }, [agentId]);

  const handleSessionEnded = useCallback(async () => {
    const vsId = voiceSessionIdRef.current;
    if (!vsId) return;

    // Mark the session ended on the server so another test call can start.
    try {
      const ended = await endVoiceSession(agentId, vsId);
      setVoiceSession(ended.voiceSession);
    } catch {
      // Fall through to reconcile polling.
    }

    // Poll for transcript + answers (data collection can lag the hangup).
    let lastResult: VoiceSession | null = null;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const result = await reconcileVoiceSession(agentId, vsId);
        lastResult = result.voiceSession;
        setVoiceSession(result.voiceSession);
        const hasAnswers =
          result.voiceSession.structuredAnswers != null &&
          Object.keys(result.voiceSession.structuredAnswers).length > 0;
        if (
          result.voiceSession.status === 'ended' &&
          result.voiceSession.transcript !== null &&
          (hasAnswers || result.voiceSession.summary !== null)
        ) {
          // Prefer stopping once answers land; otherwise accept summary alone
          // after a few attempts so the UI does not spin forever.
          if (hasAnswers || i >= 3) break;
        }
      } catch {
        break;
      }
    }
    setState('ended');
    setNotice(
      lastResult?.transcript
        ? null
        : 'The summary and transcript can take a minute after the call. Refresh the results to check again.',
    );
  }, [agentId]);

  const handleStart = useCallback(async () => {
    setState('connecting');
    setNotice(null);
    try {
      const result = await startVoiceSession(
        agentId,
        jobId && candidateId ? { jobId, candidateId } : undefined,
      );
      voiceSessionIdRef.current = result.voiceSessionId;
      setVoiceSession(result.voiceSession);
      // Connect via WebRTC using the server-issued token.
      await conversation.startSession({ conversationToken: result.conversationToken });
    } catch (e) {
      const vsId = voiceSessionIdRef.current;
      if (vsId) {
        void endVoiceSession(agentId, vsId).catch(() => undefined);
        voiceSessionIdRef.current = null;
      }
      setState('error');
      if (e instanceof ApiClientError) {
        setNotice(e.message);
      } else {
        const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
        setNotice(
          micPermissionMessage(raw) ??
            'The test call couldn’t start. Check that the microphone is allowed for this site, then try again.',
        );
      }
    }
  }, [agentId, candidateId, conversation, jobId]);

  const handleEnd = useCallback(async () => {
    holdFocus();
    setState('ending');
    try {
      await conversation.endSession();
    } catch {
      // Disconnect is fire-and-forget; the onDisconnect callback handles cleanup
      const vsId = voiceSessionIdRef.current;
      if (vsId) void handleSessionEnded();
    }
  }, [conversation, handleSessionEnded]);

  const handleRefreshResults = useCallback(async () => {
    const vsId = voiceSessionIdRef.current;
    if (!vsId) return;
    try {
      const result = await reconcileVoiceSession(agentId, vsId);
      setVoiceSession(result.voiceSession);
      setNotice('Results refreshed.');
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Couldn’t refresh the results. Try again in a moment.');
    }
  }, [agentId]);

  const handleReset = useCallback(() => {
    const vsId = voiceSessionIdRef.current;
    if (vsId) {
      void endVoiceSession(agentId, vsId).catch(() => undefined);
    }
    try {
      void conversation.endSession();
    } catch {
      /* already disconnected */
    }
    setState('idle');
    setVoiceSession(null);
    voiceSessionIdRef.current = null;
    setNotice(null);
  }, [agentId, conversation]);

  // The call clock for the Listening bar, while connected.
  useEffect(() => {
    if (state !== 'active') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    status.current?.focus();
  }, [state]);

  // Tell the page while a call is under way (it may hold the sheet open meanwhile). Only on a
  // change: callers often pass a new function each render.
  const active = state === 'connecting' || state === 'active' || state === 'ending';
  const onActive = useRef(onActiveChange);
  onActive.current = onActiveChange;
  useEffect(() => {
    onActive.current?.(active);
  }, [active]);

  // Cleanup on unmount — free the concurrent browser slot.
  useEffect(() => {
    return () => {
      const vsId = voiceSessionIdRef.current;
      try {
        void conversation.endSession();
      } catch {
        /* SDK may already be disconnected */
      }
      if (vsId) {
        void endVoiceSession(agentId, vsId).catch(() => undefined);
      }
      onActive.current?.(false);
    };
    // Intentionally only on unmount
  }, []);

  const frame = (body: ReactNode, face: AgentState, tag: ReturnType<typeof stateTag> = null) => (
    <section
      ref={panel}
      aria-labelledby={headingId}
      className="rounded-card border border-border bg-canvas p-5 text-text sm:p-6"
    >
      <div className="flex items-start gap-3">
        <Agent size={48} state={face} colour="ink" onLight />
        <div className="min-w-0 flex-1 pt-0.5">
          <Heading id={headingId} className="m-0 text-title font-semibold text-text">
            {heading}
          </Heading>
          <p className="mb-0 mt-0.5 text-meta text-text-3">
            You play {who}. Nobody’s phone rings.
          </p>
        </div>
        {/* Focus lands here when the button that had it goes with the state. */}
        <span ref={status} tabIndex={-1} role="status" className="inline-flex shrink-0 rounded-xs">
          {tag ? <StatusTag domain={tag.domain} value={tag.value} stamped={`${tag.domain}:${tag.value}`} /> : null}
        </span>
      </div>
      <div className="mt-4 grid gap-4">{body}</div>
    </section>
  );

  if (!canTest) {
    return frame(
      <p className="m-0 text-body text-text-2">
        Test calls aren’t open to you in this workspace. Ask a workspace admin to add you to the people who can run
        them.
      </p>,
      'idle',
    );
  }

  if (!agentPublished) {
    return frame(
      <p className="m-0 text-body text-text-2">Publish the agent first: test calls use its published version.</p>,
      'idle',
    );
  }

  const speaking = conversation.isSpeaking;
  const face = state === 'active' && speaking ? 'speaking' : PANEL_FACE[state];
  const seconds = state === 'active' && connectedAt ? (now - connectedAt) / 1000 : null;

  return frame(
    <>
      {state === 'idle' || state === 'confirming' ? (
        <>
          <p className="m-0 max-w-[60ch] text-body text-text-2">
            {isHiringScreen
              ? `The agent asks you this job’s questions, the way it would ask ${who}. Allow the microphone when your browser asks.`
              : 'Talk to the agent the way a candidate would. Allow the microphone when your browser asks.'}{' '}
            Test calls use paid call minutes.
          </p>
          <div>
            <Button ref={start} type="button" onClick={() => setState('confirming')}>
              <Mic aria-hidden strokeWidth={1.5} />
              Start test call
            </Button>
          </div>
        </>
      ) : null}

      {state === 'connecting' ? (
        <p className="m-0 text-body text-text-2">Connecting. Allow the microphone if your browser asks.</p>
      ) : null}

      {state === 'active' ? (
        <>
          {/* The tag beside the heading reads the change out; the bar only shows it. */}
          <ListeningBar state={speaking ? 'speaking' : 'listening'} seconds={seconds} announce={false} />
          <div>
            <Button type="button" variant="destructive-secondary" onClick={() => void handleEnd()}>
              <PhoneOff aria-hidden strokeWidth={1.5} />
              End test call
            </Button>
          </div>
        </>
      ) : null}

      {state === 'ending' ? (
        <p className="m-0 text-body text-text-2">The call ended. Writing up what was said…</p>
      ) : null}

      {state === 'error' && notice ? (
        <Alert kind="error" title="The test call stopped">
          {notice}
        </Alert>
      ) : null}

      {(state === 'ended' || state === 'error') && voiceSession ? (
        <Results session={voiceSession} questions={questions} headingLevel={headingLevel} />
      ) : null}

      {state === 'ended' && notice ? <p className="m-0 text-meta text-text-3">{notice}</p> : null}

      {state === 'ended' || state === 'error' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              handleReset();
              setState('confirming');
            }}
          >
            <Mic aria-hidden strokeWidth={1.5} />
            New test call
          </Button>
          {state === 'ended' && voiceSession?.externalConversationId ? (
            <Button type="button" variant="secondary" onClick={() => void handleRefreshResults()}>
              <RotateCw aria-hidden strokeWidth={1.5} />
              Refresh results
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={state === 'confirming'}
        onOpenChange={(open) => {
          if (!open) setState('idle');
        }}
        title="Start a test call?"
        body="It runs here in your browser and uses paid call minutes. Allow the microphone when your browser asks."
        confirmLabel="Start test call"
        tone="real-world"
        onCloseAutoFocus={(event) => {
          // Cancelled: back to Start (New test call, which opened it, is gone). Confirmed: Start
          // is gone too, so focus goes to the call's state.
          event.preventDefault();
          (state === 'idle' ? start : status).current?.focus();
        }}
        onConfirm={() => void handleStart()}
      />
    </>,
    face,
    stateTag(state, speaking),
  );
}

/** Microphone trouble in plain words, or null when the error is about something else. */
function micPermissionMessage(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (
    lower.includes('notallowed') ||
    lower.includes('permission') ||
    lower.includes('denied') ||
    lower.includes('microphone') ||
    lower.includes('getusermedia')
  ) {
    return 'The microphone is blocked. Allow it for this site in your browser’s address bar, then try again.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the test call left behind: summary, answers, transcript (no nested card).
// ---------------------------------------------------------------------------

function Results({
  session,
  questions,
  headingLevel,
}: {
  session: VoiceSession;
  questions: readonly { id: string; label: string }[];
  headingLevel: 2 | 3;
}) {
  const Sub = headingLevel === 3 ? 'h4' : 'h3';
  const turns = toTranscriptTurns(
    session.transcript?.filter((turn) => turn.message?.trim()),
    'You',
  );
  const answers = answerItems(session.structuredAnswers, questions);
  const summary = session.summary?.trim();
  if (!summary && answers.length === 0 && turns.length === 0) return null;

  return (
    <div className="grid gap-5 border-t border-border pt-4">
      {summary ? (
        <section aria-label="Summary" className="rounded-card-sm bg-subtle p-4">
          <Sub className="m-0 text-label font-semibold text-text">Summary</Sub>
          <p className="mb-0 mt-1.5 text-body leading-relaxed text-text [overflow-wrap:anywhere]">{summary}</p>
        </section>
      ) : null}
      {answers.length > 0 ? (
        <section aria-label="Answers" className="grid gap-3">
          <Sub className="m-0 text-label font-semibold text-text">Answers</Sub>
          <AnswersList items={answers} />
        </section>
      ) : null}
      {turns.length > 0 ? (
        <section aria-label="Transcript" className="grid gap-3">
          <Sub className="m-0 text-label font-semibold text-text">Transcript</Sub>
          <Transcript turns={turns} label="Transcript of the test call" />
        </section>
      ) : null}
    </div>
  );
}
