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
 *   6. Results are fetched via reconcile when the session ends
 *
 * COST WARNING: displayed before starting. The user must acknowledge they
 * understand the call uses real ElevenLabs credits. No auto-start.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import {
  ApiClientError,
  startVoiceSession,
  getVoiceSession,
  reconcileVoiceSession,
  type VoiceSession,
  type TranscriptTurn,
} from '../../../lib/api';

export interface VoiceTestPanelProps {
  agentId: string;
  /** Whether the caller has agents.test permission. */
  canTest: boolean;
  /** Whether the agent is published (pre-condition to voice testing). */
  agentPublished: boolean;
}

type PanelState = 'idle' | 'confirming' | 'connecting' | 'active' | 'ending' | 'ended' | 'error';

const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6dad2',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
};

export function VoiceTestPanel({ agentId, canTest, agentPublished }: VoiceTestPanelProps) {
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
      setNotice('Voice session active. Speak to the agent.');
    },
    onDisconnect: () => {
      setState('ending');
      setNotice('Call ended. Fetching results…');
      void handleSessionEnded();
    },
    onError: (msg: string) => {
      setState('error');
      setNotice(`Voice error: ${msg}`);
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
    // Poll for results up to 5 times with 2s intervals
    let lastResult: VoiceSession | null = null;
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const result = await reconcileVoiceSession(agentId, vsId);
        lastResult = result.voiceSession;
        setVoiceSession(result.voiceSession);
        if (result.voiceSession.status === 'ended' && result.voiceSession.transcript !== null) {
          break; // Got full results
        }
      } catch {
        break;
      }
    }
    setState('ended');
    if (!lastResult?.transcript) {
      setNotice('Call ended. Results may take a moment to appear — click Refresh Results.');
    } else {
      setNotice('Call ended. Results are below.');
    }
  }, [agentId]);

  const handleStart = useCallback(async () => {
    setState('connecting');
    setNotice(null);
    try {
      const result = await startVoiceSession(agentId);
      voiceSessionIdRef.current = result.voiceSessionId;
      setVoiceSession(result.voiceSession);
      // Connect via WebRTC using the server-issued token.
      await conversation.startSession({ conversationToken: result.conversationToken });
    } catch (e) {
      setState('error');
      setNotice(
        e instanceof ApiClientError
          ? e.message
          : 'Failed to start voice session. Check ELEVENLABS_ENABLED.',
      );
    }
  }, [agentId, conversation]);

  const handleEnd = useCallback(async () => {
    setState('ending');
    setNotice('Ending call…');
    try {
      await conversation.endSession();
    } catch {
      // Disconnect is fire-and-forget; the onDisconnect callback handles cleanup
    }
  }, [conversation]);

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
    setState('idle');
    setVoiceSession(null);
    voiceSessionIdRef.current = null;
    setNotice(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (state === 'active') {
        void conversation.endSession();
      }
    };
  }, [state, conversation]);

  if (!canTest) {
    return (
      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Voice Test</h2>
        <p style={{ fontSize: 13, color: '#545c56' }}>
          You need the <code>agents.test</code> permission to run voice tests.
        </p>
      </section>
    );
  }

  if (!agentPublished) {
    return (
      <section style={panel}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Voice Test</h2>
        <p style={{ fontSize: 13, color: '#545c56' }}>
          Publish the agent before running a voice test.
        </p>
      </section>
    );
  }

  return (
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 17 }}>Voice Test</h2>

      {state === 'idle' && (
        <>
          <p style={{ fontSize: 13, color: '#545c56', marginTop: 0 }}>
            Run a live browser-voice test using ElevenLabs WebRTC. Each session
            uses real ElevenLabs credits. A single session is limited to{' '}
            <strong>5 minutes</strong>; only one test session can run per
            organization at a time.
          </p>
          <button onClick={() => setState('confirming')}>Start Voice Test</button>
        </>
      )}

      {state === 'confirming' && (
        <>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: '#8a2020' }}>
            ⚠ This will consume ElevenLabs credits.
          </p>
          <p style={{ fontSize: 13, color: '#545c56', marginTop: 0 }}>
            A voice conversation will start in your browser. The agent will
            use the ElevenLabs API under your account. Are you sure?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void handleStart()}>Yes, start the call</button>
            <button onClick={() => setState('idle')}>Cancel</button>
          </div>
        </>
      )}

      {state === 'connecting' && (
        <p style={{ fontSize: 13.5, color: '#545c56' }}>Connecting…</p>
      )}

      {state === 'active' && (
        <>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: '#0d6e63' }}>
            🎙 Call active — speak now
          </p>
          <p style={{ fontSize: 12.5, color: '#545c56', marginTop: 0 }}>
            Status: {conversation.status ?? 'connected'}
          </p>
          <button onClick={() => void handleEnd()} style={{ marginTop: 8 }}>
            End Call
          </button>
        </>
      )}

      {state === 'ending' && (
        <p style={{ fontSize: 13.5, color: '#545c56' }}>Ending call and fetching results…</p>
      )}

      {notice && (
        <p role="status" style={{ fontSize: 13, color: '#0d6e63', marginTop: 8 }}>
          {notice}
        </p>
      )}

      {(state === 'ended' || state === 'error') && voiceSession && (
        <VoiceSessionResultView session={voiceSession} />
      )}

      {(state === 'ended' || state === 'error') && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {voiceSession?.externalConversationId && (
            <button onClick={() => void handleRefreshResults()}>Refresh Results</button>
          )}
          <button onClick={handleReset}>New Test</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Result display sub-component
// ---------------------------------------------------------------------------

function VoiceSessionResultView({ session }: { session: VoiceSession }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Session Result</h3>
      <p style={{ ...mono, fontSize: 12, marginBottom: 8, color: '#545c56' }}>
        Status: {session.status}
        {session.durationSeconds !== null && ` · ${session.durationSeconds}s`}
        {session.costCredits !== null && ` · ${session.costCredits} credits`}
      </p>

      {session.summary && (
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>Summary</strong>
          <p style={{ fontSize: 13, marginTop: 4, color: '#2d332e' }}>{session.summary}</p>
        </div>
      )}

      {session.transcript && session.transcript.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>Transcript</strong>
          <ol style={{ ...mono, paddingLeft: 18, marginTop: 6 }}>
            {session.transcript.map((turn: TranscriptTurn, i: number) => (
              <li
                key={i}
                style={{
                  marginBottom: 4,
                  color: turn.role === 'agent' ? '#0d6e63' : '#8a6108',
                }}
              >
                <strong>{turn.role}:</strong> {turn.message}
                {turn.timeInCallSecs !== undefined && (
                  <span style={{ color: '#545c56', fontSize: 11 }}> [{turn.timeInCallSecs}s]</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {session.structuredAnswers && Object.keys(session.structuredAnswers).length > 0 && (
        <div>
          <strong style={{ fontSize: 13 }}>Structured Answers</strong>
          <pre
            style={{
              ...mono,
              background: '#f5f7f4',
              padding: 10,
              borderRadius: 4,
              marginTop: 6,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            {JSON.stringify(session.structuredAnswers, null, 2)}
          </pre>
        </div>
      )}

      {!session.transcript && session.status !== 'ended' && (
        <p style={{ fontSize: 13, color: '#545c56' }}>
          Results not yet available. Click &quot;Refresh Results&quot; in a moment.
        </p>
      )}
    </div>
  );
}
