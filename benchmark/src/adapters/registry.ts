/**
 * Adapter registry.
 *
 * The ONLY place adapters are named. Everything downstream refers to them by
 * id, so no runner, report or CLI ever contains a vendor name.
 *
 * `unverified: true` on an adapter means its request shape has never been
 * exercised against the real API in this repository. That flag is propagated
 * into run metadata and printed in every report, because a number produced by
 * an unverified adapter deserves less trust than one produced by a proven one
 * — and the reader must be told which they are looking at.
 */

import type {
  BenchmarkLlmAdapter,
  BenchmarkSttAdapter,
  BenchmarkTtsAdapter,
} from './types.js';
import { createSarvamStt, createSarvamTts } from './sarvam/index.js';
import { createDeepgramStt } from './deepgram/index.js';
import { createAzureStt, createAzureTts } from './azure/index.js';
import { createCartesiaTts } from './cartesia/index.js';
import { createElevenLabsStt, createElevenLabsTts } from './elevenlabs/index.js';
import { createGeminiLlm } from './gemini/index.js';

export type SttFactory = () => BenchmarkSttAdapter;
export type TtsFactory = () => BenchmarkTtsAdapter;
export type LlmFactory = () => BenchmarkLlmAdapter;

/**
 * STT candidates approved for the sweep. Three, deliberately.
 *
 * AZURE WAS REPLACED BY ELEVENLABS on 2026-08-25, on cost-of-access grounds
 * rather than quality. An Azure subscription is disabled 30 days after signup
 * unless upgraded to pay-as-you-go, so running 7.7 minutes of benchmark audio
 * on its free F0 tier would consume a ₹17,000 trial credit window that has no
 * other use until production exists. ElevenLabs fills both of Azure's roles
 * from a single key with no expiring subscription.
 *
 * WHAT THE SWAP COSTS, recorded because it is a real loss: Azure was the second
 * India-region candidate. Sarvam is now the only one, so the residency question
 * rests entirely on it. `createAzureStt`/`createAzureTts` are deliberately kept
 * and still tested — restoring them is a one-line change if an Azure account
 * ever becomes free of the 30-day trap.
 */
export const STT_ADAPTERS: Readonly<Record<string, SttFactory>> = {
  sarvam: createSarvamStt,
  deepgram: createDeepgramStt,
  elevenlabs: createElevenLabsStt,
};

/** TTS candidates approved for the sweep. Three, deliberately. */
export const TTS_ADAPTERS: Readonly<Record<string, TtsFactory>> = {
  sarvam: createSarvamTts,
  elevenlabs: createElevenLabsTts,
  cartesia: createCartesiaTts,
};

/**
 * LLM candidates for the end-to-end run.
 *
 * ONE entry, held constant across every end-to-end run. The design holds the
 * LLM constant on purpose: a varying model would move `total_turn` for reasons
 * that have nothing to do with the layer being decided.
 *
 * `gemini-3.5-flash-lite` (updated 2026-09-15). `gemini-2.5-flash-lite` is
 * closed to new API keys; `gemini-3.1-flash-lite` is slightly cheaper but was
 * 503 under load in the live check. Chosen for three reasons that are NOT
 * price — LLM spend is a rounding error versus speech:
 *
 *   1. Adequate latency. `llm_first_token` sits inside the gated total, and the
 *      slowest candidate would eat the budget and fail every stack for a reason
 *      unrelated to speech.
 *   2. No confound. Google appears in neither the STT nor the TTS candidate
 *      set, so no leg of the measured chain shares a vendor with another.
 *   3. It is the model the approved benchmark design already proposed.
 *
 * **Choosing it here does not select it for production.** It is the constant in
 * one benchmark run, and the production LLM is a separate, later decision.
 */
export const LLM_ADAPTERS: Readonly<Record<string, LlmFactory>> = {
  gemini: createGeminiLlm,
};

/**
 * Adapters that are implemented and tested but NOT in the current sweep.
 *
 * Kept exported rather than deleted so the doc-verification work behind them
 * survives, `test/adapters.test.ts` keeps exercising them, and restoring one is
 * a move between two objects instead of an archaeology exercise. Nothing reads
 * this at run time — a retired adapter is not offered to `--adapter`, does not
 * appear in `requiredProcessorIds()`, and so cannot be swept by accident.
 */
export const RETIRED_ADAPTERS = {
  /** Replaced 2026-08-25 — see the note on STT_ADAPTERS. Not a quality verdict. */
  azure: { stt: createAzureStt, tts: createAzureTts },
} as const;

export function llmAdapter(id: string): BenchmarkLlmAdapter {
  const factory = LLM_ADAPTERS[id];
  if (!factory) {
    throw new Error(
      `Unknown LLM adapter "${id}". No LLM adapter is registered: the end-to-end run holds the ` +
        'LLM constant, and no model has been confirmed by the founder yet. Registering one is a ' +
        'provider decision, not an implementation detail.',
    );
  }
  return factory();
}

export function sttAdapter(id: string): BenchmarkSttAdapter {
  const factory = STT_ADAPTERS[id];
  if (!factory) {
    throw new Error(
      `Unknown STT adapter "${id}". Available: ${Object.keys(STT_ADAPTERS).join(', ')}`,
    );
  }
  return factory();
}

export function ttsAdapter(id: string): BenchmarkTtsAdapter {
  const factory = TTS_ADAPTERS[id];
  if (!factory) {
    throw new Error(
      `Unknown TTS adapter "${id}". Available: ${Object.keys(TTS_ADAPTERS).join(', ')}`,
    );
  }
  return factory();
}

/**
 * Which environment variables each adapter REQUIRES, for the pre-flight check.
 *
 * This list is what `doctor` and the `run` gate check before spending. A
 * variable an adapter hard-requires but that is missing here means the
 * pre-flight passes, the run starts, and every call fails — producing a run
 * directory full of failures for a provider that was never contacted, and (since
 * runs are never overwritten) a poisoned run id. `test/adapters.test.ts` asserts
 * that every variable read anywhere under `src/adapters/` appears in this table
 * or in OPTIONAL_ENV, so the two cannot drift apart again.
 */
export const REQUIRED_ENV: Readonly<Record<string, readonly string[]>> = {
  sarvam: ['SARVAM_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  azure: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'],
  // The voice id is required, not optional: voice choice materially changes the
  // blind listening gate, so it must be a deliberate decision rather than a
  // default — and the pre-flight must say so before any money is spent.
  cartesia: ['CARTESIA_API_KEY', 'CARTESIA_VOICE_ID'],
  // Same reasoning as Cartesia: the voice id moves the blind listening gate
  // more than most provider differences, so the pre-flight must show it.
  elevenlabs: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
  gemini: ['GEMINI_API_KEY'],
};

/**
 * Variables that change behaviour but have a documented default.
 *
 * Declared so the consistency test can tell "deliberately optional" from
 * "forgotten". Every one of these is recorded in run metadata via
 * `AdapterIdentity.parameters`, because a default that is invisible in the
 * result is a result that cannot be reproduced.
 */
export const OPTIONAL_ENV: readonly string[] = [
  'SARVAM_STT_MODEL',
  'SARVAM_TTS_MODEL',
  'SARVAM_TTS_SPEAKER',
  'DEEPGRAM_MODEL',
  'AZURE_TTS_VOICE',
  'AZURE_TTS_VOICE_HI',
  // Optional host override. BOTH the regional host and the resource-scoped host
  // appear in official Azure docs and it is not settled which one a Central
  // India key accepts, so the choice is exposed rather than guessed.
  'AZURE_SPEECH_ENDPOINT',
  'CARTESIA_MODEL',
  'CARTESIA_VERSION',
  'ELEVENLABS_STT_MODEL',
  'ELEVENLABS_TTS_MODEL',
  'GEMINI_MODEL',
];

/**
 * Every processor a full sweep will contact, including the LLM.
 *
 * Derived from the registries rather than written out, so adding an adapter
 * cannot silently escape the consent requirement. The LLM belongs here because
 * it receives the speech-to-text transcript — candidate speech content, and
 * therefore personal data under the DPDP Act.
 */
export function requiredProcessorIds(): readonly string[] {
  return [
    ...new Set([
      ...Object.keys(STT_ADAPTERS),
      ...Object.keys(TTS_ADAPTERS),
      ...Object.keys(LLM_ADAPTERS),
    ]),
  ].sort();
}

export function missingCredentials(ids: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of new Set(ids)) {
    const needed = REQUIRED_ENV[id] ?? [];
    const missing = needed.filter((name) => !process.env[name]);
    if (missing.length > 0) out[id] = missing;
  }
  return out;
}
