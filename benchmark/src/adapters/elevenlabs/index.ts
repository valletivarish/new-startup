/**
 * ElevenLabs benchmark adapters (STT + TTS).
 *
 * ⚠ UNVERIFIED AGAINST A LIVE SERVICE. Every field below was read off the
 * current official API reference on 2026-08-25 rather than inferred from
 * another provider's shape or from memory.
 *
 * WHY THIS ADAPTER EXISTS: it replaces Azure AI Speech in both the STT and the
 * TTS candidate set. Azure was dropped for a reason that has nothing to do with
 * its quality — an Azure subscription is disabled 30 days after signup unless
 * upgraded, so benchmarking on its free F0 tier burns a ₹17,000 trial credit on
 * 7.7 minutes of audio. ElevenLabs covers both roles from one key with no
 * expiring subscription. The trade is recorded in BENCHMARK_GATE_DECISIONS.md:
 * this set now has exactly one India-region candidate (Sarvam) instead of two.
 *
 * WHAT THE DOCUMENTATION CHECK ESTABLISHED:
 *
 *  * Authentication is the `xi-api-key` header, NOT `Authorization: Bearer`.
 *    The two are not interchangeable and the STT and TTS references agree.
 *  * `scribe_v1` is DEPRECATED with `scribe_v2` named as its replacement.
 *    Pinning the deprecated id would have measured a model on its way out.
 *  * Speech-to-text is `multipart/form-data` with the audio under `file` and a
 *    REQUIRED `model_id`. It is not a JSON body and not a raw binary post.
 *  * `language_code` is ISO-639-1/639-3 — bare `hi`, not the BCP-47 `hi-IN`
 *    that Azure documents. Sending `hi-IN` here would be a different request
 *    from the documented one.
 *  * Text-to-speech streams RAW AUDIO BYTES from
 *    `/v1/text-to-speech/{voice_id}/stream`, not SSE frames. Parsing it as
 *    events would have produced zero audio and read as a provider failure.
 *  * `output_format` is a QUERY parameter, and `pcm_8000` is a documented
 *    value — so this adapter can meet the 8 kHz every other TTS adapter is
 *    asked for, and the listening pack never resamples one candidate.
 *
 * WHAT REMAINS UNVERIFIED, and is flagged rather than assumed:
 *
 *  * Whether Scribe's default output is the verbatim form the reference
 *    transcripts are written in. The reference documents a `no_verbatim`
 *    boolean but does not define what it toggles. This adapter sends
 *    `no_verbatim=false` — the verbatim end of a field whose NAME says so —
 *    rather than relying on an undocumented default. **Stage 1 must read the
 *    returned text and confirm it is unpunctuated and un-normalised before any
 *    WER from this adapter is compared with a peer's.** This is the same trap
 *    Azure's `Display`/`Lexical` split set, and it is not settled by the docs.
 *  * Whether the response body streams progressively for TTS. The reference
 *    says "streaming audio data" but documents no chunking guarantee, so the
 *    time-to-first-byte figure is provisional and recorded as such.
 *  * Whether aborting a request stops billing. Not documented.
 *  * Whether one multilingual voice is as good in Hindi as a Hindi-specific
 *    voice would be. ElevenLabs sells its voices as multilingual and documents
 *    no per-language voice catalogue the way Azure does, so a single voice is
 *    the documented usage — but the blind listening gate is what decides it.
 */

import type { AudioFormat } from '@platform/providers';
import type {
  BenchmarkSttAdapter, BenchmarkTtsAdapter, CorpusLanguageTag,
} from '../types.js';
import { requireEnv } from '../types.js';
import { postBinary, streamBody, collect, type FetchBody } from '../http.js';
import { ResponseShapeError } from '../../measure/failures.js';
import { encodeWav } from '../../audio/wav.js';
import { pcm16ToSamples } from '../../audio/codec.js';

const ADAPTER_VERSION = 'elevenlabs-0.1.0-docverified-unrun';
const PCM16_16K: AudioFormat = { encoding: 'pcm16', sampleRate: 16000, channels: 1 };
const PCM16_8K: AudioFormat = { encoding: 'pcm16', sampleRate: 8000, channels: 1 };
const API_ROOT = 'https://api.elevenlabs.io/v1';

/** `scribe_v1` is deprecated; the reference names `scribe_v2` as replacement. */
const DEFAULT_STT_MODEL = 'scribe_v2';
/** Documented at ~75 ms model latency and listed as supporting Hindi. */
const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';

/**
 * Sentinel meaning "send no `language_code` at all".
 *
 * `language_code` is documented as OPTIONAL, with automatic detection and a
 * returned `language_probability` when it is omitted. For code-mixed audio that
 * omission IS this provider's documented answer — it publishes no `multi` code
 * the way Deepgram does, and no Indian-English locale the way Azure does.
 * Forcing `hi` or `en` on a Hinglish utterance would measure our configuration
 * choice on the very subset that carries its own sub-gate.
 */
const AUTO_DETECT = 'auto';

function elevenLabsSttLanguage(language: CorpusLanguageTag): string {
  if (language === 'hinglish') return AUTO_DETECT;
  return language === 'hi-IN' ? 'hi' : 'en';
}

/**
 * TTS has no auto-detect equivalent — something must be synthesised.
 *
 * The Hinglish reference text is written in Devanagari, so `hi` is the code
 * that matches the script actually being read aloud.
 */
function elevenLabsTtsLanguage(language: CorpusLanguageTag): string {
  return language === 'en-IN' ? 'en' : 'hi';
}

export function createElevenLabsStt(): BenchmarkSttAdapter {
  const model = process.env['ELEVENLABS_STT_MODEL'] ?? DEFAULT_STT_MODEL;
  return {
    identity: {
      id: 'elevenlabs',
      displayName: 'ElevenLabs Scribe',
      adapterVersion: ADAPTER_VERSION,
      model,
      unverified: true,
      // Declared verbatim because `no_verbatim=false` is sent explicitly. This
      // is the weakest claim in the adapter and Stage 1 must confirm it — see
      // the header. If Scribe returns punctuated, number-normalised text, its
      // WER is not comparable with Sarvam's or Deepgram's and the sweep must
      // stop rather than report the difference as accuracy.
      textNormalisation: 'verbatim',
      parameters: {
        model,
        languageEnIn: elevenLabsSttLanguage('en-IN'),
        languageHiIn: elevenLabsSttLanguage('hi-IN'),
        languageHinglish: `${AUTO_DETECT} (language_code omitted — provider auto-detects)`,
        verbatimRequest: 'no_verbatim=false',
        verbatimVerified: 'no — confirm the returned text form at Stage 1',
        responseStreamingVerified: 'no — batch endpoint, no streaming variant documented',
      },
    },
    inputFormat: PCM16_16K,
    // The documented speech-to-text endpoint is batch: one request, one body.
    // `scribe_v2_realtime` exists but is a different surface, and claiming
    // streaming here would credit this adapter with a first-interim mark it
    // never produces.
    streaming: false,
    languageFor: elevenLabsSttLanguage,
    async *transcribe(request) {
      const [key] = requireEnv('elevenlabs', 'ELEVENLABS_API_KEY');
      const pcm = await collect(request.audio);
      const wav = encodeWav(pcm16ToSamples(pcm), request.format.sampleRate);

      const form = new FormData();
      form.set('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      form.set('model_id', model);
      // Explicit rather than defaulted: see `verbatimVerified` above.
      form.set('no_verbatim', 'false');
      const languageCode = elevenLabsSttLanguage(request.language);
      if (languageCode !== AUTO_DETECT) form.set('language_code', languageCode);

      // No content-type header: `fetch` must set the multipart boundary itself.
      const response = await postBinary(
        `${API_ROOT}/speech-to-text`,
        form as unknown as FetchBody,
        { 'xi-api-key': key as string },
        request.signal,
      );

      const body = (await response.json()) as { text?: string };
      if (typeof body.text !== 'string') {
        throw new ResponseShapeError(
          'ElevenLabs Scribe',
          'a string `text` field',
          `keys: ${Object.keys(body ?? {}).join(', ') || '(none)'}`,
        );
      }
      yield { isFinal: true, text: body.text };
    },
  };
}

export function createElevenLabsTts(): BenchmarkTtsAdapter {
  const model = process.env['ELEVENLABS_TTS_MODEL'] ?? DEFAULT_TTS_MODEL;
  return {
    identity: {
      id: 'elevenlabs',
      displayName: 'ElevenLabs Flash TTS',
      adapterVersion: ADAPTER_VERSION,
      model: `${model} voice:${process.env['ELEVENLABS_VOICE_ID'] ?? '(unset)'}`,
      unverified: true,
      parameters: {
        model,
        voiceId: process.env['ELEVENLABS_VOICE_ID'] ?? '(unset)',
        languageEnIn: elevenLabsTtsLanguage('en-IN'),
        languageHiIn: elevenLabsTtsLanguage('hi-IN'),
        languageHinglish: elevenLabsTtsLanguage('hinglish'),
        outputFormat: 'pcm_8000',
        // A documented output value, not a client-side downsample. Whether the
        // model synthesises natively at 8 kHz or the service resamples is not
        // documented, so it is not claimed either way.
        outputFormatNote: 'requested at 8 kHz to match every peer; native rate undocumented',
        // Left at the documented default rather than disabled. Peers expose no
        // equivalent control and run on THEIR defaults, so switching this one
        // off would make ElevenLabs the only candidate reading digits
        // character by character — a difference in our request, not in the
        // provider.
        applyTextNormalization: 'auto',
        responseStreamingVerified: 'no — documented as "streaming audio data", chunking unspecified',
      },
    },
    outputFormat: PCM16_8K,
    streaming: true,
    languageFor: elevenLabsTtsLanguage,
    async *synthesize(request) {
      // The voice id is REQUIRED, exactly as for Cartesia: voice choice moves
      // the blind listening gate more than most provider differences, so it
      // must be a decision the pre-flight can show, never a hidden default.
      const [key, voiceId] = requireEnv(
        'elevenlabs', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID',
      );
      const params = new URLSearchParams({ output_format: 'pcm_8000' });
      const response = await postBinary(
        `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId as string)}/stream?${params}`,
        JSON.stringify({
          text: request.text,
          model_id: model,
          language_code: elevenLabsTtsLanguage(request.language),
          apply_text_normalization: 'auto',
        }),
        { 'xi-api-key': key as string, 'content-type': 'application/json' },
        request.signal,
      );

      for await (const chunk of streamBody(response)) {
        yield { bytes: chunk };
      }
    },
  };
}
