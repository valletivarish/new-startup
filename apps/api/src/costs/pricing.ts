/**
 * Per-call pricing — pure. Usage counts × the INR rates in `cost_services`.
 *
 * Telephony is billed per started minute (Exotel's pulse), unless Exotel's
 * own billed price for the call is known, which always wins.
 */

export type VoiceEngine =
  | 'elevenlabs_agent'
  | 'own_loop_elevenlabs_voice'
  | 'own_loop_sarvam_voice';

export const VOICE_ENGINES: readonly VoiceEngine[] = [
  'elevenlabs_agent',
  'own_loop_elevenlabs_voice',
  'own_loop_sarvam_voice',
];

/** cost_services.key → rate_inr */
export type Rates = Readonly<Record<string, number>>;

export interface CallUsage {
  engine: VoiceEngine;
  callSeconds: number;
  /** Exotel's billed price for this call, when fetched. */
  telephonyBilledInr?: number | null;
  sttSeconds?: number | null;
  llmInputTokens?: number | null;
  llmOutputTokens?: number | null;
  ttsCharacters?: number | null;
  /** ElevenLabs credits for the conversation (baseline arm). */
  providerCredits?: number | null;
}

export interface CallPrice {
  telephony: number;
  telephonyBilled: boolean;
  stt: number | null;
  llm: number | null;
  tts: number | null;
  agent: number | null;
  total: number;
}

const r = (rates: Rates, key: string) => rates[key] ?? 0;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function priceCall(u: CallUsage, rates: Rates): CallPrice {
  const billed = typeof u.telephonyBilledInr === 'number';
  const telephony = billed
    ? u.telephonyBilledInr!
    : Math.ceil(Math.max(0, u.callSeconds) / 60) * r(rates, 'exotel_minute');

  if (u.engine === 'elevenlabs_agent') {
    const agent = (u.providerCredits ?? 0) * r(rates, 'elevenlabs_agent');
    return {
      telephony: round4(telephony),
      telephonyBilled: billed,
      stt: null,
      llm: null,
      tts: null,
      agent: round4(agent),
      total: round4(telephony + agent),
    };
  }

  const stt = ((u.sttSeconds ?? 0) / 60) * r(rates, 'deepgram_stt');
  const llm =
    ((u.llmInputTokens ?? 0) / 1_000_000) * r(rates, 'gemini_input') +
    ((u.llmOutputTokens ?? 0) / 1_000_000) * r(rates, 'gemini_output');
  const ttsKey = u.engine === 'own_loop_sarvam_voice' ? 'sarvam_tts' : 'elevenlabs_tts';
  const tts = ((u.ttsCharacters ?? 0) / 1_000) * r(rates, ttsKey);
  return {
    telephony: round4(telephony),
    telephonyBilled: billed,
    stt: round4(stt),
    llm: round4(llm),
    tts: round4(tts),
    agent: null,
    total: round4(telephony + stt + llm + tts),
  };
}
