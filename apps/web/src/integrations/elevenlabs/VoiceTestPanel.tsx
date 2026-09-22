'use client';

/**
 * VoiceTestPanel — ElevenLabs browser-voice test interface (MVP-01).
 *
 * ISOLATION: this file is the ONLY place in apps/web that imports from
 * @elevenlabs/react. All other web code imports only from lib/api.ts.
 *
 * FLOW:
 *   1. User clicks "Start Voice Test"
 *   2. POST /agents/:id/voice-sessions → receives { voiceSessionId, conversationToken }
 *   3. ElevenLabs React SDK connects via WebRTC using conversationToken
 *   4. User speaks; agent responds via the ElevenLabs conversational-AI agent
 *   5. User clicks "End Call" (or session auto-ends after max minutes)
 *   6. End marks the session ended server-side, then results are reconciled
 *
 * COST WARNING: displayed before starting. The user must acknowledge they
 * understand the call uses real voice minutes. No auto-start.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import {
  ApiClientError,
  startVoiceSession,
  getVoiceSession,
  reconcileVoiceSession,
  endVoiceSession,
  type VoiceSession,
  type TranscriptTurn,
} from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Notice, Surface } from '@/components/ui/page';
import { Badge, statusTone } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { VoiceWaveform } from '@/components/calls/VoiceWaveform';
import { cn } from '@/lib/utils';
import {
  scorecardRows,
} from '@/components/candidates/screening-answers';

export interface VoiceTestPanelProps {
  agentId: string;
  /** Whether the caller has agents.test permission. */
  canTest: boolean;
  /** Whether the agent is published (pre-condition to voice testing). */
  agentPublished: boolean;
  /** Optional hiring link — labels this as a candidate screen demo. */
  jobId?: string;
  candidateId?: string;
  candidateName?: string;
  /** Override heading (defaults based on hiring link). */
  title?: string;
}

type PanelState = 'idle' | 'confirming' | 'connecting' | 'active' | 'ending' | 'ended' | 'error';

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
}: VoiceTestPanelProps) {
  const isHiringScreen = Boolean(jobId && candidateId);
  const heading =
    title ??
    (isHiringScreen
      ? `Browser screen${candidateName ? ` · ${candidateName}` : ''}`
      : 'Demo conversation (browser)');
  const [state, setState] = useState<PanelState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);

  // The ElevenLabs React SDK conversation hook.
  // It is instantiated here even in idle state — the SDK requires this to
  // call startSession before the WebRTC handshake occurs.
  const conversation = useConversation({
    onConnect: () => {
      setState('active');
      setNotice('Practice call active. Speak to the hiring voice.');
    },
    onDisconnect: () => {
      setState('ending');
      setNotice('Call ended. Fetching results…');
      void handleSessionEnded();
    },
    onError: (msg: string) => {
      setState('error');
      setNotice(`Voice error: ${micPermissionMessage(msg)}`);
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

    // Mark the session ended on the server so another screen can start.
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
    if (!lastResult?.transcript) {
      setNotice('Call ended. Results may take a moment to appear - click Refresh results.');
    } else {
      setNotice('Call ended. Results are below.');
    }
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
        const raw =
          e instanceof Error ? e.message : typeof e === 'string' ? e : '';
        setNotice(micPermissionMessage(raw) ||
          'Could not start the browser voice session. Check that voice is enabled and the microphone is allowed.');
      }
    }
  }, [agentId, candidateId, conversation, jobId]);

  const handleEnd = useCallback(async () => {
    setState('ending');
    setNotice('Ending call…');
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
      setNotice(e instanceof ApiClientError ? e.message : 'Could not refresh results.');
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
    };
    // Intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canTest) {
    return (
      <Surface className="space-y-2">
        <h2 className="m-0 font-display text-base font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
          You do not have permission to run voice demos for this company.
        </p>
      </Surface>
    );
  }

  if (!agentPublished) {
    return (
      <Surface className="space-y-2">
        <h2 className="m-0 font-display text-base font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
          Publish the hiring voice before starting a browser demo.
        </p>
      </Surface>
    );
  }

  return (
    <Surface elevated className="space-y-3">
      <div>
        <h2 className="m-0 font-display text-base font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="mt-1 mb-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--accent)]">
          Demo only · not a live phone call
        </p>
      </div>

      {state === 'idle' ? (
        <>
          <p className="m-0 text-sm leading-relaxed text-[var(--foreground-tertiary)]">
            {isHiringScreen
              ? 'Talk to the hiring voice in your browser as if you were the candidate. Allow microphone access when asked. This uses real voice minutes and is not an outbound phone call.'
              : 'Try the hiring voice in your browser before you screen real candidates. Allow microphone access when asked. This uses real voice minutes and is not an outbound phone call.'}
          </p>
          <Button type="button" onClick={() => setState('confirming')}>
            {isHiringScreen ? 'Start browser screen' : 'Start demo'}
          </Button>
        </>
      ) : null}

      {state === 'confirming' ? (
        <>
          <Notice kind="warn">
            This uses paid voice minutes on your account.
          </Notice>
          <p className="m-0 text-sm leading-relaxed text-[var(--foreground-tertiary)]">
            A conversation will start in this browser. Allow microphone access
            when the browser asks. Continue only if you mean to spend those
            minutes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void handleStart()}>
              Yes, start
            </Button>
            <Button type="button" variant="outline" onClick={() => setState('idle')}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}

      {state === 'connecting' ? (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-4 py-3">
          <StatusIndicator status="connecting" />
          <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
            Connecting the browser mic…
          </p>
        </div>
      ) : null}

      {state === 'active' ? (
        <div
          className={cn(
            'space-y-4 rounded-lg border border-[color-mix(in_srgb,var(--accent)_28%,var(--separator-subtle))] bg-[var(--surface-secondary)] p-4 shadow-sm',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusIndicator status="speaking" />
            <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
              Live in browser
            </span>
          </div>
          <VoiceWaveform active className="py-1" />
          <Button type="button" variant="danger" onClick={() => void handleEnd()}>
            End demo
          </Button>
        </div>
      ) : null}

      {state === 'ending' ? (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-4 py-3">
          <StatusIndicator status="processing" />
          <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
            Ending demo and fetching results…
          </p>
        </div>
      ) : null}

      {notice ? (
        <Notice kind={state === 'error' ? 'err' : 'ok'}>{notice}</Notice>
      ) : null}

      {(state === 'ended' || state === 'error') && voiceSession ? (
        <VoiceSessionResultView session={voiceSession} />
      ) : null}

      {state === 'ended' || state === 'error' ? (
        <div className="flex flex-wrap gap-2">
          {voiceSession?.externalConversationId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRefreshResults()}
            >
              Refresh results
            </Button>
          ) : null}
          <Button type="button" onClick={handleReset}>
            New demo
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}

function micPermissionMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('notallowed') ||
    lower.includes('permission') ||
    lower.includes('denied') ||
    lower.includes('microphone') ||
    lower.includes('getusermedia')
  ) {
    return 'Microphone access is blocked. Allow the mic for this site in the browser address bar, then try again.';
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Result display sub-component
// ---------------------------------------------------------------------------

function VoiceSessionResultView({ session }: { session: VoiceSession }) {
  const statusLabel =
    session.status === 'ended'
      ? 'Completed'
      : session.status === 'failed'
        ? 'Failed'
        : session.status === 'active' || session.status === 'pending'
          ? 'In progress'
          : session.status;
  const rows = scorecardRows(session.structuredAnswers, []);

  return (
    <div className="space-y-3 border-t border-[var(--separator-subtle)] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-display text-sm font-semibold tracking-tight">
          Screening results
        </h3>
        <Badge tone={statusTone(session.status)} className="normal-case">
          {statusLabel}
        </Badge>
      </div>
      {session.durationSeconds != null ? (
        <p className="m-0 text-xs text-[var(--foreground-tertiary)]">
          {Math.floor(session.durationSeconds / 60)}:
          {String(session.durationSeconds % 60).padStart(2, '0')} on the call
          {session.costCredits != null
            ? ` · provider usage ${session.costCredits}`
            : ''}
        </p>
      ) : session.costCredits != null ? (
        <p className="m-0 text-xs text-[var(--foreground-tertiary)]">
          Provider usage {session.costCredits}
        </p>
      ) : null}

      {session.summary ? (
        <div>
          <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Summary
          </p>
          <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--foreground-secondary)]">
            {session.summary}
          </p>
        </div>
      ) : null}

      {session.transcript && session.transcript.length > 0 ? (
        <div>
          <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Conversation
          </p>
          <ol className="mt-2 mb-0 list-none space-y-2.5 p-0">
            {session.transcript.map((turn: TranscriptTurn, i: number) => (
              <li
                key={i}
                className="rounded-md border border-[var(--separator-subtle)] bg-[var(--surface-secondary)] px-3 py-2.5"
              >
                <p
                  className={cn(
                    'm-0 text-[11px] font-semibold uppercase tracking-[0.04em]',
                    turn.role === 'agent'
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--foreground-muted)]',
                  )}
                >
                  {turn.role === 'agent'
                    ? 'Hiring voice'
                    : turn.role === 'user'
                      ? 'Candidate'
                      : turn.role}
                  {turn.timeInCallSecs !== undefined
                    ? ` · ${turn.timeInCallSecs}s`
                    : ''}
                </p>
                <p className="m-0 mt-1 text-sm leading-relaxed text-[var(--foreground-secondary)]">
                  {turn.message}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div>
          <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Scorecard
          </p>
          <div className="mt-2 overflow-hidden rounded-md border border-[var(--separator-subtle)]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--separator-subtle)] bg-[var(--surface)]">
                  <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                    Question
                  </th>
                  <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
                    Answer
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator-subtle)]">
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td className="align-top px-3 py-2.5 text-[13px] font-medium">
                      {row.label}
                    </td>
                    <td className="align-top px-3 py-2.5 text-[13px] text-[var(--foreground-secondary)]">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!session.transcript && session.status !== 'ended' ? (
        <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
          Results not yet available. Click “Refresh results” in a moment.
        </p>
      ) : null}
    </div>
  );
}
