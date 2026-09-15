/**
 * Benchmark-only provider interfaces.
 *
 * DELIBERATELY NOT the production `SpeechToTextProvider` / `TextToSpeechProvider`
 * contracts. The benchmark needs marks production does not care about — first
 * interim, per-final timestamps, byte counts, retry counts — and production
 * must never grow those just because a measuring instrument wanted them.
 *
 * Nothing in this directory may be imported by `apps/` or `packages/`. A
 * boundary test enforces it.
 */

import type { AudioFormat } from '@platform/providers';

/**
 * The corpus's own language label — NOT a provider language code.
 *
 * These three are what the manifest records. Each provider then maps them to
 * whatever it documents, which is emphatically not the same string: for
 * code-mixed audio one provider documents `multi`, another documents an Indian
 * English locale, and a third documents a bare `hi`.
 */
export type CorpusLanguageTag = 'en-IN' | 'hi-IN' | 'hinglish';

/** Every adapter reports its own version so a result can be traced to code. */
export interface AdapterIdentity {
  /** Stable key used in run metadata and file names. */
  readonly id: string;
  /** Human name for reports. */
  readonly displayName: string;
  /** Bumped whenever request shape or parsing changes. */
  readonly adapterVersion: string;
  /** Provider model/voice actually invoked, recorded verbatim. */
  readonly model: string;
  /** True when this adapter has never been exercised against the real API. */
  readonly unverified: boolean;
  /**
   * What text form this adapter ASKS the provider for.
   *
   * `verbatim` is what the reference transcripts are written in.
   * `provider_formatted` means inverse text normalisation and punctuation are
   * on, which changes WER against a verbatim reference by more than most real
   * provider differences. Recorded so a comparison across adapters that made
   * different requests is visible rather than silent — and a test asserts every
   * STT adapter in a sweep declares the same value.
   */
  readonly textNormalisation?: 'verbatim' | 'provider_formatted';
  /**
   * Behaviour-changing configuration that is NOT a secret.
   *
   * Region, voice, speaker, API version. These change the result and were
   * previously invisible in run metadata, so a run could not be reproduced or
   * even correctly interpreted. Never put a credential here.
   */
  readonly parameters?: Readonly<Record<string, string>>;
}

export interface SttResult {
  /** `true` for an endpointed segment, `false` for an interim hypothesis. */
  readonly isFinal: boolean;
  readonly text: string;
}

export interface SttRequest {
  /** Paced audio. The adapter MUST consume this as it arrives. */
  readonly audio: AsyncIterable<Uint8Array>;
  readonly format: AudioFormat;
  /** The CORPUS label. The adapter translates it to its own documented code. */
  readonly language: CorpusLanguageTag;
  readonly signal?: AbortSignal;
}

export interface BenchmarkSttAdapter {
  readonly identity: AdapterIdentity;
  /** Format this provider wants. The runner converts before calling. */
  readonly inputFormat: AudioFormat;
  /**
   * Whether the provider streams.
   *
   * Recorded rather than inferred, because a batch provider that receives audio
   * progressively and a streaming one that does are measured the same way and
   * the difference must remain visible in the report.
   */
  readonly streaming: boolean;
  /**
   * This provider's DOCUMENTED code for a corpus language.
   *
   * THE BIAS THIS EXISTS TO REMOVE: the sweep used to map code-mixed audio to
   * `en-IN` for everybody. That is one provider's documented answer and another
   * provider's wrong answer — one documents `multi` for code-switching, and
   * sending it an Indian English locale instead measures our configuration
   * mistake as if it were the provider's accuracy, on the very subset that
   * carries its own sub-gate.
   *
   * Each adapter therefore declares its own mapping, from its own docs, and the
   * mapping is recorded in run metadata so the choice is auditable rather than
   * buried in a runner.
   */
  languageFor(language: CorpusLanguageTag): string;
  transcribe(request: SttRequest): AsyncIterable<SttResult>;
}

/**
 * One chunk of synthesised audio.
 *
 * Deliberately carries NO audibility flag. Audibility is measured by the runner
 * from the bytes themselves: an adapter that asserted `audible: true` on every
 * chunk collapsed first-audible onto first-byte and silently disabled the
 * leading-silence check.
 */
export interface TtsChunk {
  readonly bytes: Uint8Array;
}

export interface TtsRequest {
  readonly text: string;
  /** The CORPUS label. The adapter translates it to its own documented code. */
  readonly language: CorpusLanguageTag;
  readonly signal?: AbortSignal;
}

export interface BenchmarkTtsAdapter {
  readonly identity: AdapterIdentity;
  /**
   * What this adapter ASKS the provider for.
   *
   * Providers do not document the same format matrix, so these legitimately
   * differ — and the blind listening pack normalises every sample to one rate
   * before a human hears it, so a provider is never preferred for having been
   * asked for higher-fidelity audio than its peers.
   */
  readonly outputFormat: AudioFormat;
  readonly streaming: boolean;
  languageFor(language: CorpusLanguageTag): string;
  synthesize(request: TtsRequest): AsyncIterable<TtsChunk>;
}

/**
 * One streamed piece of an LLM response.
 *
 * Only the FIRST chunk carrying non-empty text marks `llm_first_token`. A
 * provider that opens the stream with an empty frame must not be credited with
 * a token it has not produced.
 */
export interface LlmChunk {
  readonly text: string;
}

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly signal?: AbortSignal;
}

/**
 * The LLM under test in an end-to-end run.
 *
 * HELD CONSTANT by design: the sweep compares STT and TTS, and a varying LLM
 * would move `total_turn` for reasons that have nothing to do with the layer
 * being decided. One model, named in run metadata, for every end-to-end run.
 */
export interface BenchmarkLlmAdapter {
  readonly identity: AdapterIdentity;
  readonly streaming: boolean;
  complete(request: LlmRequest): AsyncIterable<LlmChunk>;
}

/** Thrown when an adapter is selected but its credentials are absent. */
export class MissingCredentialsError extends Error {
  constructor(providerId: string, variables: readonly string[]) {
    super(
      `Adapter "${providerId}" needs ${variables.join(', ')} in the environment. ` +
        'Set them in your shell or a local .env that is NOT committed. ' +
        'The benchmark will not run this provider without them, and will not ' +
        'fabricate a result in their absence.',
    );
    this.name = 'MissingCredentialsError';
  }
}

/** Read a required environment variable, failing with a useful message. */
export function requireEnv(providerId: string, ...names: string[]): string[] {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) throw new MissingCredentialsError(providerId, missing);
  return names.map((n) => process.env[n] as string);
}
