/**
 * Cartesia benchmark TTS adapter.
 *
 * ⚠ UNVERIFIED AGAINST A LIVE SERVICE. Checked against the current official
 * reference on 2026-08-24, and this adapter needed more correction than any
 * other — five mismatches, of which two would have made the run measure nothing.
 *
 * WHAT THE DOCUMENTATION CHECK CHANGED:
 *
 *  * Auth was `X-API-Key`. That header is documented for the WEBSOCKET; the
 *    `/tts/bytes` OpenAPI declares only bearer schemes, and API Conventions
 *    says `Authorization: Bearer <api_key>`. A rejected header is a 401, which
 *    `classify()` treats as a setup failure and which STOPS THE SWEEP — so the
 *    wrong header would have aborted the run and looked like a bad key.
 *  * `Cartesia-Version` was `2024-06-10`. The current schema pins the header to
 *    `2026-08-14`. An old version also returns legacy plain-text error bodies
 *    with no `error_code`, which would have made every Cartesia failure the
 *    least diagnosable in the sweep.
 *  * `model_id` was `sonic-2`, which is not in the current enum at all, and
 *    whose Hindi support was removed in June 2026 — so every Hindi line would
 *    have failed for a reason that says nothing about the provider.
 *  * `voice: { mode: 'id', id }` — `mode` is absent from the current schema.
 *
 * WHAT REMAINS UNVERIFIED and is deliberately NOT guessed:
 *
 *  * **8 kHz output.** The docs pair `pcm_s16le` with 16000 and reserve 8000
 *    for the COMPANDED encodings — and name mu-law/a-law as the standard for
 *    Indian telephony. So this adapter requests `pcm_mulaw` @ 8 kHz: a
 *    documented pairing, at the rate a candidate actually hears, matching what
 *    the other two TTS adapters return.
 *
 *    The alternative — `pcm_s16le` @ 16 kHz — was tried and rejected. It would
 *    have forced the blind listening pack to resample Cartesia down to meet its
 *    peers, and OUR linear resampler adds artefacts that a natively-8 kHz
 *    provider never suffers. That does not remove the bias, it reverses it:
 *    the higher-fidelity provider gets penalised for our arithmetic.
 *  * **Whether aborting mid-synthesis stops billing.** Not documented.
 *  * **Which voice suits Indian English or Hindi.** No voice is documented as
 *    an Indian voice, so `CARTESIA_VOICE_ID` is required rather than defaulted.
 *  * **Price.** No per-character or per-credit rate is published anywhere, so
 *    Cartesia will come out NOT PRICED in the cost estimate. It can be ranked
 *    on latency and quality; it cannot yet be ranked on cost.
 */

import type { AudioFormat } from '@platform/providers';
import type { BenchmarkTtsAdapter, CorpusLanguageTag } from '../types.js';
import { requireEnv } from '../types.js';
import { postBinary, streamBody } from '../http.js';

const ADAPTER_VERSION = 'cartesia-0.2.0-docverified-unrun';
/** A DOCUMENTED pairing, at telephony rate, matching the other TTS adapters. */
const MULAW_8K: AudioFormat = { encoding: 'mulaw', sampleRate: 8000, channels: 1 };
const API_VERSION = '2026-08-14';
const DEFAULT_MODEL = 'sonic-3.5';

/** Documented `language` values are bare tags, not regional ones. */
function cartesiaLanguage(language: CorpusLanguageTag): string {
  return language === 'en-IN' ? 'en' : 'hi';
}

export function createCartesiaTts(): BenchmarkTtsAdapter {
  const model = process.env['CARTESIA_MODEL'] ?? DEFAULT_MODEL;
  const apiVersion = process.env['CARTESIA_VERSION'] ?? API_VERSION;
  return {
    identity: {
      id: 'cartesia',
      displayName: 'Cartesia Sonic',
      adapterVersion: ADAPTER_VERSION,
      model,
      unverified: true,
      parameters: {
        voiceId: process.env['CARTESIA_VOICE_ID'] ?? '(unset)',
        apiVersion,
        outputFormat: 'raw pcm_mulaw 8000',
        outputFormatNote:
          'pcm_s16le is documented only at 16 kHz; mu-law at 8 kHz is the documented telephony ' +
          'pairing and avoids resampling this provider to meet its peers in the listening gate',
        languageEnIn: cartesiaLanguage('en-IN'),
        languageHiIn: cartesiaLanguage('hi-IN'),
        languageHinglish: cartesiaLanguage('hinglish'),
      },
    },
    outputFormat: MULAW_8K,
    streaming: true,
    // No code-mixed value is documented; a Hinglish line is synthesised as
    // Hindi, which is the closest documented setting for that content.
    languageFor: cartesiaLanguage,
    async *synthesize(request) {
      // Both variables go through requireEnv, so an absent voice id raises
      // MissingCredentialsError — which classify() files as a setup problem
      // that stops the sweep, rather than as N unexplained provider failures.
      const [apiKey, voiceId] = requireEnv('cartesia', 'CARTESIA_API_KEY', 'CARTESIA_VOICE_ID');

      const response = await postBinary(
        'https://api.cartesia.ai/tts/bytes',
        JSON.stringify({
          model_id: model,
          transcript: request.text,
          // `mode` is absent from the current schema; only `id` is documented.
          voice: { id: voiceId },
          language: cartesiaLanguage(request.language),
          output_format: {
            container: 'raw',
            encoding: 'pcm_mulaw',
            sample_rate: 8000,
          },
        }),
        {
          authorization: `Bearer ${apiKey as string}`,
          'Cartesia-Version': apiVersion,
          'content-type': 'application/json',
        },
        request.signal,
      );

      for await (const chunk of streamBody(response)) {
        yield { bytes: chunk };
      }
    },
  };
}
