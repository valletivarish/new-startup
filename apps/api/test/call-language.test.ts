import { describe, it, expect } from 'vitest';
import { localizeGreeting, sttProviderFor } from '../src/providers/own-loop/call-language.js';
import { priceCall } from '../src/costs/pricing.js';

function fakeFetch(text: string, status = 200) {
  const calls: { url: string; body: { contents: { parts: { text: string }[] }[] } }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const deps = (fn: typeof fetch) => ({ apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'm', fetchFn: fn });
const EN = 'Hi, this is the hiring agent from Voice Test Co calling about a role.';

describe('localizeGreeting', () => {
  it('asks Gemini for the call language, keeping names in English letters', async () => {
    const { fn, calls } = fakeFetch('"नमस्ते, मैं Voice Test Co से hiring agent बोल रही हूँ।"');
    expect(await localizeGreeting(EN, 'hi', deps(fn), 'woman')).toBe('नमस्ते, मैं Voice Test Co से hiring agent बोल रही हूँ।');
    expect(calls[0]!.url).toBe('https://example.test/v1/models/m:generateContent');
    const prompt = calls[0]!.body.contents[0]!.parts[0]!.text;
    expect(prompt).toContain('spoken Hindi');
    expect(prompt).toContain('English letters');
    expect(prompt).toContain(EN);
    expect(prompt).toContain('The speaker is a woman');
  });

  it('is null (speak the English line) for English, errors, or an untranslated reply', async () => {
    expect(await localizeGreeting(EN, 'en', deps(fakeFetch('x').fn))).toBeNull();
    expect(await localizeGreeting(EN, 'ta', deps(fakeFetch('', 500).fn))).toBeNull();
    expect(await localizeGreeting(EN, 'ta', deps(fakeFetch(EN).fn))).toBeNull();
    const boom = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await localizeGreeting(EN, 'ml', deps(boom))).toBeNull();
    expect(await localizeGreeting(EN, 'ml', { apiKey: '' })).toBeNull();
  });
});

describe('STT routing and price', () => {
  it('only Malayalam (no Nova-3 model) listens with Google', () => {
    const google = ['en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'ml', 'pa'].filter((l) => sttProviderFor(l) === 'google');
    expect(google).toEqual(['ml']);
  });

  it('prices Google STT minutes on google_stt', () => {
    const rates = { deepgram_stt: 0.68, google_stt: 1.41 };
    const base = { engine: 'own_loop_google_voice' as const, callSeconds: 60, sttSeconds: 120 };
    expect(priceCall({ ...base, sttProvider: 'google' }, rates).stt).toBeCloseTo(2.82);
    expect(priceCall(base, rates).stt).toBeCloseTo(1.36);
  });
});
