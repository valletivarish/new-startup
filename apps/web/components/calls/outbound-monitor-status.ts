import type { VoiceStatus } from '../ui/status-indicator';

const HUMAN_FROM_API: Record<string, VoiceStatus> = {
  pending: 'connecting',
  active: 'connected',
  ended: 'completed',
  failed: 'failed',
};

export function mapSessionStatus(apiStatus: string): VoiceStatus {
  return HUMAN_FROM_API[apiStatus] ?? 'idle';
}

/** Map dial + live voice-session state for the candidate CallMonitor. */
export function resolveOutboundMonitorStatus(input: {
  dialing: boolean;
  noticeKind?: 'ok' | 'err' | null;
  sessionApiStatus?: string | null;
}): VoiceStatus {
  if (input.dialing) return 'connecting';
  if (input.noticeKind === 'err') return 'failed';
  if (input.sessionApiStatus) return mapSessionStatus(input.sessionApiStatus);
  // Dial accepted but session row not tracked yet — never fake "Connected".
  if (input.noticeKind === 'ok') return 'connecting';
  return 'idle';
}
