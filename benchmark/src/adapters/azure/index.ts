/**
 * Azure AI Speech benchmark adapters (STT + TTS), Central India region.
 *
 * ⚠ UNVERIFIED AGAINST A LIVE SERVICE. Checked field by field against the
 * current official reference on 2026-08-24; that check found four real
 * mismatches, corrected here.
 *
 * WHAT THE DOCUMENTATION CHECK CHANGED:
 *
 *  * SSML was missing the `xmlns` attribute, which the `<speak>` element's own
 *    attribute table marks REQUIRED.
 *  * The TTS `User-Agent` header was not sent, and is marked REQUIRED.
 *  * `DisplayText` was used as a fallback when `NBest[0].Lexical` was absent.
 *    Display is the inverse-text-normalised form, so that fallback would have
 *    silently scored Azure on a DIFFERENT text form than its peers — turning
 *    the WER gate into a comparison of request options. It now fails loudly.
 *  * Only `NoMatch` was handled. `InitialSilenceTimeout` and `BabbleTimeout`
 *    are equally documented provider outcomes, and on degraded telephony audio
 *    they will be common. Treating them as adapter errors would have filed real
 *    provider behaviour as our own defect and made the run INCOMPLETE.
 *
 * WHAT REMAINS UNVERIFIED:
 *  * Whether the regional `<region>.stt.speech.microsoft.com` host or the
 *    resource-scoped `<resource>.cognitiveservices.azure.com` host is correct
 *    for a Central India key. BOTH appear in official docs. Overridable by
 *    `AZURE_SPEECH_ENDPOINT` rather than guessed.
 *  * Whether the TTS REST body streams progressively. Not documented, so the
 *    time-to-first-byte figure for this adapter is provisional and recorded as
 *    such in run metadata.
 *  * Whether aborting the request stops billing. Not documented.
 *  * Whether the service-default `profanity` setting masks the Lexical field.
 *    Not documented — so the corpus must avoid profanity rather than rely on it.
 */

import type { AudioFormat } from '@platform/providers';
import type {
  BenchmarkSttAdapter, BenchmarkTtsAdapter, CorpusLanguageTag,
} from '../types.js';
import { requireEnv } from '../types.js';
import { collect, postBinary, streamBody, type FetchBody } from '../http.js';
import { ResponseShapeError } from '../../measure/failures.js';
import { encodeWav } from '../../audio/wav.js';
import { pcm16ToSamples } from '../../audio/codec.js';

const ADAPTER_VERSION = 'azure-0.2.0-docverified-unrun';
const PCM16_16K: AudioFormat = { encoding: 'pcm16', sampleRate: 16000, channels: 1 };
const PCM16_8K: AudioFormat = { encoding: 'pcm16', sampleRate: 8000, channels: 1 };
const USER_AGENT = 'phase5c-benchmark';

/**
 * The short-audio REST endpoint takes ONE language and documents no
 * auto-detection or code-switching parameter — language identification is
 * documented only through the SDK. So a code-mixed utterance is sent as Indian
 * English, which is the closest thing this endpoint offers, and the choice is
 * recorded in metadata rather than hidden in a runner.
 */
function azureLanguage(language: CorpusLanguageTag): string {
  return language === 'hi-IN' ? 'hi-IN' : 'en-IN';
}

function sttEndpoint(region: string): string {
  const override = process.env['AZURE_SPEECH_ENDPOINT'];
  if (override) return `${override.replace(/\/$/, '')}/speech/recognition/conversation/cognitiveservices/v1`;
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
}

/**
 * The override covers BOTH halves of the Azure surface.
 *
 * It used to apply to speech-to-text only, so the one control a founder has for
 * pinning where Azure processes audio silently covered half of it — and the
 * half it missed is the one that sends synthesised speech.
 */
function ttsEndpoint(region: string): string {
  const override = process.env['AZURE_SPEECH_ENDPOINT'];
  if (override) return `${override.replace(/\/$/, '')}/cognitiveservices/v1`;
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

/** Documented outcomes that mean "the provider heard nothing usable". */
const EMPTY_RESULT_STATUSES = new Set(['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']);

export function createAzureStt(): BenchmarkSttAdapter {
  return {
    identity: {
      id: 'azure',
      displayName: 'Azure AI Speech (Central India)',
      adapterVersion: ADAPTER_VERSION,
      model: 'stt-standard',
      unverified: true,
      // `Lexical`, never `Display`: the display form is inverse-text-normalised
      // and punctuated, which is a different request shape from the one the
      // other STT adapters make.
      textNormalisation: 'verbatim',
      parameters: {
        region: process.env['AZURE_SPEECH_REGION'] ?? '(unset)',
        endpointForm: process.env['AZURE_SPEECH_ENDPOINT'] ? 'override' : 'regional-host',
        languageEnIn: azureLanguage('en-IN'),
        languageHiIn: azureLanguage('hi-IN'),
        languageHinglish: azureLanguage('hinglish'),
        profanityDefault: 'service default, undocumented effect on Lexical',
      },
    },
    inputFormat: PCM16_16K,
    streaming: false,
    languageFor: azureLanguage,
    async *transcribe(request) {
      const [key, region] = requireEnv('azure', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION');
      const pcm = await collect(request.audio);
      const wav = encodeWav(pcm16ToSamples(pcm), request.format.sampleRate);

      const params = new URLSearchParams({
        language: azureLanguage(request.language),
        format: 'detailed',
      });
      const response = await postBinary(
        `${sttEndpoint(region as string)}?${params}`,
        wav as unknown as FetchBody,
        {
          'Ocp-Apim-Subscription-Key': key as string,
          'content-type': `audio/wav; codecs=audio/pcm; samplerate=${request.format.sampleRate}`,
          'user-agent': USER_AGENT,
        },
        request.signal,
      );

      const body = (await response.json()) as {
        RecognitionStatus?: string;
        DisplayText?: string;
        NBest?: { Lexical?: string; Display?: string }[];
      };

      const status = body.RecognitionStatus ?? 'unknown';
      if (EMPTY_RESULT_STATUSES.has(status)) {
        // Real, reportable provider outcomes — the service heard the audio and
        // matched nothing. Not adapter errors.
        yield { isFinal: true, text: '' };
        return;
      }
      if (status === 'Error') {
        throw new Error('Azure STT returned RecognitionStatus=Error (provider-side failure)');
      }

      const lexical = body.NBest?.[0]?.Lexical;
      if (typeof lexical !== 'string') {
        // Deliberately NOT falling back to Display. Display is the ITN'd form,
        // and quietly scoring one provider on normalised text while its peers
        // are scored on lexical text would make the WER gate meaningless.
        throw new ResponseShapeError(
          'Azure STT',
          'NBest[0].Lexical (refusing to fall back to the inverse-text-normalised Display form)',
          `RecognitionStatus=${status}`,
        );
      }
      yield { isFinal: true, text: lexical };
    },
  };
}

/**
 * Voice per language, not one voice for everything.
 *
 * The frozen line set is deliberately part Hindi. Synthesising a `hi-IN` line
 * with an `en-IN` voice measures a mismatch we chose, and the blind listening
 * gate would then reject the provider for our own setup.
 */
function azureVoiceFor(language: CorpusLanguageTag): string {
  if (language === 'hi-IN') return process.env['AZURE_TTS_VOICE_HI'] ?? 'hi-IN-SwaraNeural';
  return process.env['AZURE_TTS_VOICE'] ?? 'en-IN-NeerjaNeural';
}

export function createAzureTts(): BenchmarkTtsAdapter {
  return {
    identity: {
      id: 'azure',
      displayName: 'Azure Neural TTS (Central India)',
      adapterVersion: ADAPTER_VERSION,
      // BOTH voices, because both are used. Naming only the English voice made
      // every report claim the Hindi lines were synthesised by a voice that
      // never touched them — a run that misreports its own subject.
      model: `en:${process.env['AZURE_TTS_VOICE'] ?? 'en-IN-NeerjaNeural'}` +
        ` hi:${process.env['AZURE_TTS_VOICE_HI'] ?? 'hi-IN-SwaraNeural'}`,
      unverified: true,
      parameters: {
        region: process.env['AZURE_SPEECH_REGION'] ?? '(unset)',
        voiceEn: process.env['AZURE_TTS_VOICE'] ?? 'en-IN-NeerjaNeural',
        voiceHi: process.env['AZURE_TTS_VOICE_HI'] ?? 'hi-IN-SwaraNeural',
        endpointForm: process.env['AZURE_SPEECH_ENDPOINT'] ? 'override' : 'regional-host',
        outputFormat: 'raw-8khz-16bit-mono-pcm',
        // Documented as a service-side resample: the voice models synthesise at
        // 24 kHz or 48 kHz and 8 kHz is obtained by downsampling. That matches
        // what a candidate hears on a PSTN call, but it is not native 8 kHz
        // synthesis and the distinction belongs in the record.
        outputFormatNote: 'service-side downsample from the native 24 kHz model',
        // The docs do not state whether the REST body arrives progressively, so
        // the first-byte figure for this adapter is provisional until measured.
        responseStreamingVerified: 'no',
      },
    },
    outputFormat: PCM16_8K,
    streaming: true,
    languageFor: azureLanguage,
    async *synthesize(request) {
      const [key, region] = requireEnv('azure', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION');
      const voice = azureVoiceFor(request.language);
      const lang = azureLanguage(request.language);
      // `xmlns` is REQUIRED by the <speak> attribute table. Omitting it was a
      // real mismatch found by the documentation check.
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
        `<voice name="${voice}">${escapeXml(request.text)}</voice></speak>`;

      const response = await postBinary(
        ttsEndpoint(region as string),
        ssml,
        {
          'Ocp-Apim-Subscription-Key': key as string,
          'content-type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'raw-8khz-16bit-mono-pcm',
          // Documented as REQUIRED for this endpoint.
          'user-agent': USER_AGENT,
        },
        request.signal,
      );

      for await (const chunk of streamBody(response)) {
        yield { bytes: chunk };
      }
    },
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
