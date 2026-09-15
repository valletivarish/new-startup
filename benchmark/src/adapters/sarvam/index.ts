/**
 * Sarvam AI benchmark adapters (STT + TTS).
 *
 * ⚠ UNVERIFIED AGAINST A LIVE SERVICE. Request shapes were checked field by
 * field against the current official reference on 2026-08-24, and the checks
 * found four real mismatches, all corrected here. But no authenticated request
 * has ever been made from this repository, so `unverified` stays true until one
 * succeeds.
 *
 * WHAT THE DOCUMENTATION CHECK CHANGED, with the reason each mattered:
 *
 *  * `model` was `saaras:v2`, which appears in no current enum. The documented
 *    default and recommendation is `saaras:v3` (`saaras:v4` is newer but not
 *    the default). A model id the service does not recognise fails as a 4xx,
 *    which this harness correctly files as OUR defect — but only after paying
 *    for the round trip and producing a run that measured nothing.
 *  * `mode` was not sent at all, and its DEFAULT is `transcribe`, which applies
 *    normalisation. The adapter meanwhile declared `textNormalisation:
 *    'verbatim'`. It was asserting one thing and requesting another, and the
 *    resulting WER would have been scored against verbatim references — a
 *    penalty invented entirely by our own request shape.
 *  * TTS sent `inputs: [text]` and `target_language_code`. The current
 *    reference documents `text` (a string) and `language_code`. Legacy field
 *    names that are silently ignored are the worst case: the request succeeds
 *    and synthesises the wrong thing.
 *  * TTS `speaker` was `meera`, which is in no documented enum for this model.
 *    The documented default for `bulbul:v2` is `anushka`. A silently
 *    substituted speaker means the blind listening gate scores a voice the
 *    report does not name.
 *
 * WHAT REMAINS UNVERIFIED and must be settled on first authenticated contact:
 * whether aborting an in-flight synthesis stops billing (not documented), and
 * where audio submitted to these endpoints is processed (not documented for the
 * model APIs).
 */

import type { AudioFormat } from '@platform/providers';
import type {
  BenchmarkSttAdapter, BenchmarkTtsAdapter, CorpusLanguageTag,
} from '../types.js';
import { requireEnv } from '../types.js';
import { collect, postBinary, postJson, redact } from '../http.js';
import { ResponseShapeError } from '../../measure/failures.js';
import { decodeWav, encodeWav } from '../../audio/wav.js';
import { pcm16ToSamples, samplesToPcm16 } from '../../audio/codec.js';

const ADAPTER_VERSION = 'sarvam-0.2.0-docverified-unrun';
const BASE = 'https://api.sarvam.ai';

const PCM16_16K: AudioFormat = { encoding: 'pcm16', sampleRate: 16000, channels: 1 };
const PCM16_8K: AudioFormat = { encoding: 'pcm16', sampleRate: 8000, channels: 1 };

/** Documented default and recommendation for `/speech-to-text`. */
const DEFAULT_STT_MODEL = 'saaras:v3';
/** Documented default speaker for `bulbul:v2`. */
const DEFAULT_TTS_SPEAKER = 'anushka';

/**
 * The documented `language_code` enum uses full BCP-47 Indian tags.
 *
 * Code-mixed audio has no dedicated code here; `unknown` is the documented
 * auto-detection sentinel and is the closest thing the provider offers to
 * "decide for yourself what this is". That is a defensible reading of the docs
 * rather than a certainty, and it is recorded in run metadata so a reader can
 * disagree with it.
 */
function sarvamLanguage(language: CorpusLanguageTag): string {
  return language === 'hinglish' ? 'unknown' : language;
}

export function createSarvamStt(): BenchmarkSttAdapter {
  const model = process.env['SARVAM_STT_MODEL'] ?? DEFAULT_STT_MODEL;
  return {
    identity: {
      id: 'sarvam',
      displayName: 'Sarvam Saaras',
      adapterVersion: ADAPTER_VERSION,
      model,
      unverified: true,
      textNormalisation: 'verbatim',
      parameters: {
        mode: 'verbatim',
        languageEnIn: sarvamLanguage('en-IN'),
        languageHiIn: sarvamLanguage('hi-IN'),
        languageHinglish: sarvamLanguage('hinglish'),
      },
    },
    inputFormat: PCM16_16K,
    // Sarvam documents a realtime streaming API, and the TTS websocket is fully
    // specified — but the STT streaming protocol was NOT read end to end during
    // verification, so implementing it would mean guessing message framing.
    // Recorded as non-streaming so no report overstates what was tested.
    streaming: false,
    languageFor: sarvamLanguage,
    async *transcribe(request) {
      const [apiKey] = requireEnv('sarvam', 'SARVAM_API_KEY');
      const pcm = await collect(request.audio);
      const wav = encodeWav(pcm16ToSamples(pcm), request.format.sampleRate);

      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
      form.append('model', model);
      form.append('language_code', sarvamLanguage(request.language));
      // Explicit, because the default (`transcribe`) normalises. Every STT
      // adapter in this sweep must request the same text form or the WER gate
      // compares request options rather than providers.
      form.append('mode', 'verbatim');

      const response = await postBinary(
        `${BASE}/speech-to-text`,
        form,
        { 'api-subscription-key': apiKey as string },
        request.signal,
      );
      const body = (await response.json()) as { transcript?: string };
      if (typeof body.transcript !== 'string') {
        throw new ResponseShapeError(
          'Sarvam STT', 'a top-level `transcript` string',
          redact(JSON.stringify(body)).slice(0, 200),
        );
      }
      yield { isFinal: true, text: body.transcript };
    },
  };
}

export function createSarvamTts(): BenchmarkTtsAdapter {
  const model = process.env['SARVAM_TTS_MODEL'] ?? 'bulbul:v2';
  const speaker = process.env['SARVAM_TTS_SPEAKER'] ?? DEFAULT_TTS_SPEAKER;
  return {
    identity: {
      id: 'sarvam',
      displayName: 'Sarvam Bulbul',
      adapterVersion: ADAPTER_VERSION,
      model,
      unverified: true,
      parameters: { speaker, speechSampleRate: '8000' },
    },
    outputFormat: PCM16_8K,
    streaming: false,
    // A synthesis request names one language; there is no code-mixed value, so
    // a Hinglish line is synthesised as Hindi — which is what a Hindi-first
    // speaker reading a code-mixed sentence would be doing.
    languageFor: (language) => (language === 'en-IN' ? 'en-IN' : 'hi-IN'),
    async *synthesize(request) {
      const [apiKey] = requireEnv('sarvam', 'SARVAM_API_KEY');
      const body = (await postJson(
        `${BASE}/text-to-speech`,
        {
          // `text` (string), NOT `inputs` (array): the array form is absent
          // from the current reference.
          text: request.text,
          language_code: request.language === 'en-IN' ? 'en-IN' : 'hi-IN',
          model,
          speaker,
          speech_sample_rate: 8000,
        },
        { 'api-subscription-key': apiKey as string },
        request.signal,
      )) as { audios?: string[] };

      const first = body.audios?.[0];
      if (typeof first !== 'string') {
        throw new ResponseShapeError('Sarvam TTS', '`audios[0]` as a base64 string');
      }

      // The documented response is base64 WAV. Yielding it raw fed a 44-byte
      // RIFF header into the runner as if it were samples, which corrupted the
      // duration used for real-time factor and the audibility check.
      const raw = new Uint8Array(Buffer.from(first, 'base64'));
      const decoded = decodeWav(raw);

      // The docs do not state that the response honours `speech_sample_rate`,
      // and every duration and real-time-factor figure divides the byte count
      // by the rate this adapter DECLARES. A silent mismatch would make those
      // wrong by a whole factor with no symptom, so it fails loudly instead.
      if (decoded.sampleRate !== PCM16_8K.sampleRate) {
        throw new ResponseShapeError('Sarvam TTS', `${PCM16_8K.sampleRate} Hz audio`,
          `got ${decoded.sampleRate} Hz; every duration and real-time-factor figure would be ` +
            'wrong by that ratio',
        );
      }
      if (decoded.channels !== 1) {
        throw new ResponseShapeError(
          'Sarvam TTS', 'mono audio', `got ${decoded.channels} channels`,
        );
      }
      yield { bytes: samplesToPcm16(decoded.samples) };
    },
  };
}
