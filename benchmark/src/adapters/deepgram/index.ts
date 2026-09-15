/**
 * Deepgram benchmark STT adapter.
 *
 * ⚠ UNVERIFIED. Written from published API documentation; never exercised
 * against the live service in this repository.
 *
 * ⚠ BATCH, NOT STREAMING — and this is a deliberate, load-bearing choice.
 *
 * Deepgram's relevance to this benchmark is streaming residual latency, so the
 * obviously "better" adapter would speak their websocket API. I started writing
 * one and deleted it: an unverified websocket client with guessed
 * authentication and guessed message framing would fail in ways that look
 * exactly like provider unreliability, and the benchmark would attribute my
 * bugs to Deepgram.
 *
 * So this adapter uses the documented pre-recorded endpoint, reports
 * `streaming: false` honestly, and the limitation is recorded in the completion
 * report: **streaming residual latency cannot be compared across providers
 * until verified streaming adapters exist.** The harness itself is
 * streaming-shaped and the fakes prove it measures streaming correctly — what
 * is missing is verified vendor code, which needs credentials.
 */

import type { AudioFormat } from '@platform/providers';
import type { BenchmarkSttAdapter, CorpusLanguageTag } from '../types.js';
import { requireEnv } from '../types.js';
import { collect, postBinary, redact, type FetchBody } from '../http.js';
import { ResponseShapeError } from '../../measure/failures.js';
import { encodeWav } from '../../audio/wav.js';
import { pcm16ToSamples } from '../../audio/codec.js';

const ADAPTER_VERSION = 'deepgram-0.2.0-docverified-unrun-batch';

/**
 * Deepgram's documented language codes — and the most consequential correction
 * this verification round produced.
 *
 * The sweep used to send `en-IN` for code-mixed audio to EVERY provider.
 * Deepgram documents `multi` as the configuration for code-switching, so the
 * old behaviour measured our configuration mistake as if it were Deepgram's
 * accuracy — on precisely the Hinglish subset that carries its own sub-gate and
 * that is the single strongest reason this benchmark exists.
 *
 * Hindi is documented as `hi`, not `hi-IN`. An undocumented code may hard-fail,
 * or may silently fall back to a different language, which is worse.
 *
 * NOTE FOR THE COST ESTIMATE: `multi` is billed at Deepgram's multilingual
 * rate, which is higher than the monolingual rate. The rate card must carry
 * both if the Hinglish subset is a meaningful share of the corpus.
 */
function deepgramLanguage(language: CorpusLanguageTag): string {
  if (language === 'hinglish') return 'multi';
  if (language === 'hi-IN') return 'hi';
  return 'en-IN';
}
const PCM16_16K: AudioFormat = { encoding: 'pcm16', sampleRate: 16000, channels: 1 };

export function createDeepgramStt(): BenchmarkSttAdapter {
  return {
    identity: {
      id: 'deepgram',
      displayName: 'Deepgram Nova-3 (batch)',
      adapterVersion: ADAPTER_VERSION,
      model: process.env['DEEPGRAM_MODEL'] ?? 'nova-3',
      unverified: true,
      // `smart_format` used to be on here, which turns on inverse text
      // normalisation and punctuation. Against a verbatim reference that alone
      // shifted WER by more than most real provider differences — so this
      // adapter would have been scored on a request shape its peers never made.
      textNormalisation: 'verbatim',
      parameters: {
        languageEnIn: deepgramLanguage('en-IN'),
        languageHiIn: deepgramLanguage('hi-IN'),
        languageHinglish: deepgramLanguage('hinglish'),
      },
    },
    inputFormat: PCM16_16K,
    // The live websocket API is documented, but its BINARY FRAMING is not
    // stated explicitly, so a client would have to guess it — and a guessed
    // framing fails in ways indistinguishable from provider unreliability.
    streaming: false,
    languageFor: deepgramLanguage,
    async *transcribe(request) {
      const [apiKey] = requireEnv('deepgram', 'DEEPGRAM_API_KEY');
      const pcm = await collect(request.audio);
      const wav = encodeWav(pcm16ToSamples(pcm), request.format.sampleRate);

      const params = new URLSearchParams({
        model: process.env['DEEPGRAM_MODEL'] ?? 'nova-3',
        language: deepgramLanguage(request.language),
      });

      const response = await postBinary(
        `https://api.deepgram.com/v1/listen?${params}`,
        wav as unknown as FetchBody,
        {
          authorization: `Token ${apiKey as string}`,
          'content-type': 'audio/wav',
        },
        request.signal,
      );

      const body = (await response.json()) as {
        results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
      };
      const transcript = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      if (typeof transcript !== 'string') {
        throw new ResponseShapeError(
          'Deepgram', 'results.channels[0].alternatives[0].transcript',
          redact(JSON.stringify(body)).slice(0, 200),
        );
      }
      yield { isFinal: true, text: transcript };
    },
  };
}
