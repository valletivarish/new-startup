/**
 * Adapter conformance tests.
 *
 * These are the regression tests for the documentation-verification round. Each
 * one names a mismatch that existed between what an adapter SENT and what the
 * provider's official reference documents — mismatches that would have produced
 * a run measuring our request shape rather than the provider.
 *
 * They deliberately assert on request SHAPE via a stubbed fetch, never by
 * contacting anything. No credential in this file is real, and no test here
 * reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSarvamStt, createSarvamTts } from '../src/adapters/sarvam/index.js';
import { createDeepgramStt } from '../src/adapters/deepgram/index.js';
import { createAzureStt, createAzureTts } from '../src/adapters/azure/index.js';
import { createCartesiaTts } from '../src/adapters/cartesia/index.js';
import { createElevenLabsStt, createElevenLabsTts } from '../src/adapters/elevenlabs/index.js';
import { STT_ADAPTERS, TTS_ADAPTERS } from '../src/adapters/registry.js';
import type { CorpusLanguageTag } from '../src/adapters/types.js';
import { encodeWav } from '../src/audio/wav.js';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: Captured[] = [];
const original = globalThis.fetch;

function stubFetch(response: () => Response): void {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    captured.push({ url: String(url), headers, body: init?.body });
    return response();
  }) as typeof fetch;
}

const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

async function drainStt(
  adapter: ReturnType<typeof createSarvamStt>, language: CorpusLanguageTag = 'en-IN',
): Promise<void> {
  const audio = (async function* () { yield new Uint8Array(320); })();
  for await (const _ of adapter.transcribe({
    audio, format: adapter.inputFormat, language,
  })) { /* drain */ }
}

beforeEach(() => {
  captured = [];
  process.env['SARVAM_API_KEY'] = 'test-key-not-real';
  process.env['DEEPGRAM_API_KEY'] = 'test-key-not-real';
  process.env['AZURE_SPEECH_KEY'] = 'test-key-not-real';
  process.env['AZURE_SPEECH_REGION'] = 'centralindia';
  process.env['CARTESIA_API_KEY'] = 'test-key-not-real';
  process.env['CARTESIA_VOICE_ID'] = 'test-voice';
  process.env['ELEVENLABS_API_KEY'] = 'test-key-not-real';
  process.env['ELEVENLABS_VOICE_ID'] = 'test-voice-11';
});

afterEach(() => {
  globalThis.fetch = original;
  vi.unstubAllEnvs();
  for (const key of [
    'SARVAM_API_KEY', 'DEEPGRAM_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION',
    'CARTESIA_API_KEY', 'CARTESIA_VOICE_ID', 'SARVAM_STT_MODEL', 'CARTESIA_MODEL',
    'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_STT_MODEL', 'ELEVENLABS_TTS_MODEL',
  ]) delete process.env[key];
});

describe('every STT adapter requests the same text form', () => {
  it('declares verbatim, and Sarvam now actually asks for it', async () => {
    // Sarvam's `mode` defaults to `transcribe`, which NORMALISES. The adapter
    // declared verbatim while requesting the normalising default — asserting
    // one thing and sending another, and the WER penalty would have been
    // invented entirely by our own request.
    stubFetch(() => jsonResponse({ transcript: 'hello' }));
    await drainStt(createSarvamStt());
    const body = captured[0]?.body as FormData;
    expect(body.get('mode')).toBe('verbatim');
  });

  it('sends a documented Sarvam model id', async () => {
    // `saaras:v2` appears in no current enum. The documented default is v3.
    stubFetch(() => jsonResponse({ transcript: 'hello' }));
    await drainStt(createSarvamStt());
    const body = captured[0]?.body as FormData;
    expect(body.get('model')).toBe('saaras:v3');
  });

  it('does not send Deepgram a formatting flag', async () => {
    stubFetch(() => jsonResponse({
      results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] },
    }));
    await drainStt(createDeepgramStt());
    expect(captured[0]?.url).not.toMatch(/smart_format/);
    expect(captured[0]?.url).not.toMatch(/punctuate/);
  });

  it('reads Azure Lexical and refuses to fall back to the normalised Display form', async () => {
    stubFetch(() => jsonResponse({ RecognitionStatus: 'Success', DisplayText: 'Ninety days.' }));
    await expect(drainStt(createAzureStt())).rejects.toThrow(/refusing to fall back/i);
  });
});

describe('language codes come from each provider\'s own documentation', () => {
  it('sends Deepgram `multi` for code-mixed audio, not an Indian English locale', async () => {
    // THE most consequential correction of this round. The sweep used to map
    // hinglish to en-IN for everybody; Deepgram documents `multi` for
    // code-switching, and the Hinglish subset carries its own sub-gate.
    stubFetch(() => jsonResponse({
      results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] },
    }));
    await drainStt(createDeepgramStt(), 'hinglish');
    expect(captured[0]?.url).toMatch(/language=multi/);
  });

  it('sends Deepgram bare `hi` for Hindi, not `hi-IN`', async () => {
    stubFetch(() => jsonResponse({
      results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] },
    }));
    await drainStt(createDeepgramStt(), 'hi-IN');
    expect(captured[0]?.url).toMatch(/language=hi(&|$)/);
  });

  it('sends Cartesia bare language tags', () => {
    const adapter = createCartesiaTts();
    expect(adapter.languageFor('en-IN')).toBe('en');
    expect(adapter.languageFor('hi-IN')).toBe('hi');
  });

  it('records each adapter\'s mapping in metadata so the choice is auditable', () => {
    for (const factory of Object.values(STT_ADAPTERS)) {
      const parameters = factory().identity.parameters ?? {};
      expect(Object.keys(parameters)).toContain('languageHinglish');
    }
  });

  it('every adapter can map every corpus language', () => {
    const languages: CorpusLanguageTag[] = ['en-IN', 'hi-IN', 'hinglish'];
    for (const factory of [...Object.values(STT_ADAPTERS), ...Object.values(TTS_ADAPTERS)]) {
      const adapter = factory();
      for (const language of languages) {
        expect(adapter.languageFor(language), adapter.identity.id).toBeTruthy();
      }
    }
  });
});

describe('request shapes match the current official reference', () => {
  it('sends Sarvam TTS a `text` string and `language_code`, not the legacy array form', async () => {
    // Legacy field names that are silently ignored are the worst case: the
    // request succeeds and synthesises something other than what was asked.
    stubFetch(() => jsonResponse({ audios: [Buffer.from(new Uint8Array(64)).toString('base64')] }));
    const adapter = createSarvamTts();
    try {
      for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    } catch { /* the stub returns an invalid WAV; the request shape is the assertion */ }
    const body = JSON.parse(captured[0]?.body as string) as Record<string, unknown>;
    expect(body['text']).toBe('hi');
    expect(body).not.toHaveProperty('inputs');
    expect(body['language_code']).toBe('en-IN');
    expect(body).not.toHaveProperty('target_language_code');
  });

  it('uses a documented Sarvam speaker', async () => {
    stubFetch(() => jsonResponse({ audios: [''] }));
    const adapter = createSarvamTts();
    try {
      for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    } catch { /* shape is the assertion */ }
    const body = JSON.parse(captured[0]?.body as string) as Record<string, unknown>;
    expect(body['speaker']).toBe('anushka');
  });

  it('authenticates Cartesia with Bearer, the scheme its endpoint declares', async () => {
    // X-API-Key is documented for the WEBSOCKET. The /tts/bytes spec declares
    // only bearer schemes — and a rejected header is a 401, which stops the
    // whole sweep and looks like a bad key rather than a wrong header.
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createCartesiaTts();
    for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    expect(captured[0]?.headers['authorization']).toMatch(/^Bearer /);
    expect(captured[0]?.headers).not.toHaveProperty('x-api-key');
  });

  it('pins the current Cartesia API version and a current model', async () => {
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createCartesiaTts();
    for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    expect(captured[0]?.headers['cartesia-version']).toBe('2026-08-14');
    const body = JSON.parse(captured[0]?.body as string) as { model_id: string; voice: object };
    expect(body.model_id).toBe('sonic-3.5');
    // `mode` is absent from the current voice schema.
    expect(body.voice).not.toHaveProperty('mode');
  });

  it('requests a DOCUMENTED Cartesia pairing, at the same rate as its peers', async () => {
    // The docs pair pcm_s16le with 16000 and reserve 8000 for the companded
    // encodings. Requesting an undocumented pcm_s16le@8000 would have made every
    // Cartesia duration and real-time factor wrong by a whole factor; requesting
    // the documented pcm_s16le@16000 would have forced the listening pack to
    // resample this provider down to meet its peers, penalising it for our
    // arithmetic. mu-law at 8 kHz is documented AND matches the others.
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createCartesiaTts();
    for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    const body = JSON.parse(captured[0]?.body as string) as {
      output_format: { encoding: string; sample_rate: number };
    };
    expect(body.output_format.encoding).toBe('pcm_mulaw');
    expect(body.output_format.sample_rate).toBe(8000);
    expect(adapter.outputFormat.encoding).toBe('mulaw');
    expect(adapter.outputFormat.sampleRate).toBe(8000);
  });

  it('asks every TTS adapter for the same sample rate, so nothing is resampled to be heard', () => {
    const rates = new Set(Object.values(TTS_ADAPTERS).map((f) => f().outputFormat.sampleRate));
    expect(rates.size).toBe(1);
  });

  it('sends the required Azure TTS User-Agent and a namespaced <speak>', async () => {
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createAzureTts();
    for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    expect(captured[0]?.headers['user-agent']).toBeTruthy();
    expect(captured[0]?.body as string).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
  });

  it('treats Azure silence and babble timeouts as provider outcomes, not adapter errors', async () => {
    // On degraded telephony audio these will be common. Throwing would file
    // real provider behaviour as OUR defect and make the run INCOMPLETE.
    for (const status of ['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']) {
      captured = [];
      stubFetch(() => jsonResponse({ RecognitionStatus: status }));
      const results: string[] = [];
      const audio = (async function* () { yield new Uint8Array(320); })();
      const adapter = createAzureStt();
      for await (const r of adapter.transcribe({
        audio, format: adapter.inputFormat, language: 'en-IN',
      })) results.push(r.text);
      expect(results, status).toEqual(['']);
    }
  });

  it('reports an Azure provider-side Error as a failure', async () => {
    stubFetch(() => jsonResponse({ RecognitionStatus: 'Error' }));
    await expect(drainStt(createAzureStt())).rejects.toThrow(/provider-side failure/);
  });
});

describe('an adapter never misreports its own subject', () => {
  it('names BOTH Azure voices, because both are used', () => {
    // Naming only the English voice made every report claim the Hindi lines
    // were synthesised by a voice that never touched them.
    const identity = createAzureTts().identity;
    expect(identity.model).toContain('en-IN-NeerjaNeural');
    expect(identity.model).toContain('hi-IN-SwaraNeural');
  });

  it('fails loudly if Sarvam returns a different sample rate than declared', async () => {
    // Every duration and real-time-factor figure divides the byte count by the
    // DECLARED rate. A silent mismatch would be wrong by a whole factor with no
    // symptom at all.
    const wrongRate = encodeWav(new Int16Array(160), 16000);
    stubFetch(() => jsonResponse({ audios: [Buffer.from(wrongRate).toString('base64')] }));
    const adapter = createSarvamTts();
    await expect((async () => {
      for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) break;
    })()).rejects.toThrow(/wrong by that ratio/);
  });
});

describe('adapter versions record that they were doc-checked but never run', () => {
  it('every real adapter is still flagged unverified', () => {
    for (const factory of [...Object.values(STT_ADAPTERS), ...Object.values(TTS_ADAPTERS)]) {
      const identity = factory().identity;
      expect(identity.unverified, identity.id).toBe(true);
      expect(identity.adapterVersion, identity.id).toMatch(/unrun/);
    }
  });
});

/**
 * ElevenLabs replaced Azure in both candidate sets on 2026-08-25. Each test
 * below names a way the swap could have quietly measured our request shape
 * instead of the provider.
 */
describe('ElevenLabs matches its documented contract', () => {
  it('authenticates with xi-api-key, not Authorization: Bearer', async () => {
    stubFetch(() => jsonResponse({ text: 'hello' }));
    await drainStt(createElevenLabsStt());
    expect(captured[0]?.headers['xi-api-key']).toBe('test-key-not-real');
    // A Bearer header here would 401 every call and be filed as a provider
    // outage rather than as our mistake.
    expect(captured[0]?.headers['authorization']).toBeUndefined();
  });

  it('never pins the deprecated scribe_v1', async () => {
    stubFetch(() => jsonResponse({ text: 'hello' }));
    const adapter = createElevenLabsStt();
    await drainStt(adapter);
    const form = captured[0]?.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(adapter.identity.model).not.toBe('scribe_v1');
  });

  it('sends multipart with the audio under `file`, not a raw binary post', async () => {
    stubFetch(() => jsonResponse({ text: 'hello' }));
    await drainStt(createElevenLabsStt());
    const form = captured[0]?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get('file')).toBeInstanceOf(Blob);
    // Setting content-type ourselves would strip the multipart boundary that
    // `fetch` generates, and every request would be unparseable.
    expect(captured[0]?.headers['content-type']).toBeUndefined();
  });

  it('sends ISO-639-1 `hi`, never the BCP-47 `hi-IN` Azure documents', async () => {
    stubFetch(() => jsonResponse({ text: 'नमस्ते' }));
    await drainStt(createElevenLabsStt(), 'hi-IN');
    expect((captured[0]?.body as FormData).get('language_code')).toBe('hi');
  });

  it('OMITS language_code for code-mixed audio so the provider auto-detects', async () => {
    stubFetch(() => jsonResponse({ text: 'mera naam' }));
    await drainStt(createElevenLabsStt(), 'hinglish');
    const form = captured[0]?.body as FormData;
    // Forcing `hi` or `en` on Hinglish would measure our configuration choice
    // on the one subset carrying its own sub-gate. Omission is this provider's
    // documented answer — it publishes no `multi` code.
    expect(form.get('language_code')).toBeNull();
    expect(form.get('no_verbatim')).toBe('false');
  });

  it('fails loudly rather than scoring an empty transcript on a shape change', async () => {
    stubFetch(() => jsonResponse({ transcript: 'wrong key' }));
    await expect(drainStt(createElevenLabsStt())).rejects.toThrow(/text/);
  });

  it('streams TTS as raw bytes from the documented /stream path at 8 kHz', async () => {
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createElevenLabsTts();
    for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) { /* drain */ }
    expect(captured[0]?.url).toContain('/v1/text-to-speech/test-voice-11/stream');
    // pcm_8000 is what keeps this candidate at the same rate as its peers, so
    // the blind listening pack never resamples one voice and not another.
    expect(captured[0]?.url).toContain('output_format=pcm_8000');
    expect(adapter.outputFormat.sampleRate).toBe(8000);
  });

  it('leaves TTS normalisation at the default its peers also run on', async () => {
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createElevenLabsTts();
    for await (const _ of adapter.synthesize({ text: '9876543210', language: 'en-IN' })) { /* drain */ }
    const body = JSON.parse(captured[0]?.body as string) as Record<string, unknown>;
    // Switching this off would make ElevenLabs the only candidate reading
    // digits one character at a time — a difference in our request, not in the
    // provider, and the listening panel would hear it as a defect.
    expect(body['apply_text_normalization']).toBe('auto');
    expect(body['model_id']).toBe('eleven_flash_v2_5');
  });

  it('refuses to synthesize without an explicit voice id', async () => {
    delete process.env['ELEVENLABS_VOICE_ID'];
    stubFetch(() => new Response(new Uint8Array(320), { status: 200 }));
    const adapter = createElevenLabsTts();
    await expect((async () => {
      for await (const _ of adapter.synthesize({ text: 'hi', language: 'en-IN' })) { /* drain */ }
    })()).rejects.toThrow(/ELEVENLABS_VOICE_ID/);
  });

  it('records that its verbatim claim is unconfirmed, so Stage 1 must check it', () => {
    const p = createElevenLabsStt().identity.parameters ?? {};
    expect(p['verbatimVerified']).toMatch(/^no/);
  });
});
