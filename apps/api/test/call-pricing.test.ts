import { describe, it, expect } from 'vitest';
import { priceCall, type Rates } from '../src/costs/pricing.js';

const RATES: Rates = {
  exotel_minute: 0.6,
  deepgram_stt: 0.68,
  gemini_input: 8.8,
  gemini_output: 35.2,
  elevenlabs_tts: 4.4,
  sarvam_tts: 1.5,
  elevenlabs_agent: 0.0185,
};

describe('priceCall', () => {
  it('prices an own-loop Sarvam call per part, telephony billed per started minute', () => {
    const p = priceCall(
      {
        engine: 'own_loop_sarvam_voice',
        callSeconds: 125, // 3 started minutes
        sttSeconds: 120,
        llmInputTokens: 100_000,
        llmOutputTokens: 10_000,
        ttsCharacters: 2_000,
      },
      RATES,
    );
    expect(p.telephony).toBeCloseTo(1.8);
    expect(p.stt).toBeCloseTo(1.36);
    expect(p.llm).toBeCloseTo(0.88 + 0.352);
    expect(p.tts).toBeCloseTo(3.0);
    expect(p.agent).toBeNull();
    expect(p.total).toBeCloseTo(1.8 + 1.36 + 1.232 + 3.0);
  });

  it('uses the ElevenLabs voice rate for the ElevenLabs-voice arm', () => {
    const p = priceCall(
      { engine: 'own_loop_elevenlabs_voice', callSeconds: 60, ttsCharacters: 1_000 },
      RATES,
    );
    expect(p.tts).toBeCloseTo(4.4);
    expect(p.stt).toBe(0);
  });

  it('prices the baseline from ElevenLabs credits plus telephony', () => {
    const p = priceCall(
      { engine: 'elevenlabs_agent', callSeconds: 61, providerCredits: 1000 },
      RATES,
    );
    expect(p.telephony).toBeCloseTo(1.2);
    expect(p.agent).toBeCloseTo(18.5);
    expect(p.stt).toBeNull();
    expect(p.total).toBeCloseTo(19.7);
  });

  it("prefers Exotel's billed price over the per-minute estimate", () => {
    const p = priceCall(
      { engine: 'elevenlabs_agent', callSeconds: 61, telephonyBilledInr: 0.95, providerCredits: 0 },
      RATES,
    );
    expect(p.telephony).toBe(0.95);
    expect(p.telephonyBilled).toBe(true);
  });

  it('treats a missing rate as zero rather than throwing', () => {
    const p = priceCall({ engine: 'own_loop_sarvam_voice', callSeconds: 30, ttsCharacters: 500 }, {});
    expect(p.total).toBe(0);
  });
});
