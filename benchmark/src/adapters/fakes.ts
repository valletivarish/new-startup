/**
 * Fake providers — deliberately hostile.
 *
 * The previous validation suite missed five critical defects because its fakes
 * were POLITE: they never consumed their audio, emitted exactly one final, and
 * returned instantly. A measuring instrument validated only against
 * well-behaved fakes is not validated against anything it will meet.
 *
 * These fakes therefore misbehave on purpose — consuming audio progressively,
 * pausing mid-utterance, emitting several finals, delaying first byte, and
 * requiring their streams to be drained.
 */

import type { AudioFormat } from '@platform/providers';
import type {
  AdapterIdentity,
  BenchmarkLlmAdapter,
  BenchmarkSttAdapter,
  BenchmarkTtsAdapter,
  SttResult,
  TtsChunk,
} from './types.js';

const PCM16_8K: AudioFormat = { encoding: 'pcm16', sampleRate: 8000, channels: 1 };

/** Fakes pass the corpus label straight through, so tests can assert on it. */
const passThrough = (language: string): string => language;

function identity(over: Partial<AdapterIdentity> & { id: string }): AdapterIdentity {
  return {
    displayName: over.id,
    adapterVersion: 'fake-1',
    model: 'fake',
    unverified: false,
    ...over,
  };
}

export interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

/** A clock tests drive by hand, so measured durations are exact. */
export function createFakeClock(start = 0): FakeClock {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

export interface StreamingSttOptions {
  readonly id?: string;
  /** Segments emitted as separate finals, in order. */
  readonly segments: readonly string[];
  /** Residual processing after the last audio frame, per segment. */
  readonly residualMs?: number;
  /** Delay before the first interim hypothesis appears. */
  readonly interimAfterMs?: number;
  /** Pause inserted between segments — models a mid-utterance silence. */
  readonly interSegmentMs?: number;
  readonly clock: FakeClock;
}

/**
 * A realistic STREAMING STT.
 *
 * Consumes audio progressively (so it cannot be fooled by an unpaced feed),
 * emits an interim, then one final PER SEGMENT with a pause between them.
 */
export function streamingSttFake(options: StreamingSttOptions): BenchmarkSttAdapter {
  const {
    segments, clock,
    residualMs = 120, interimAfterMs = 40, interSegmentMs = 0,
    id = 'fake-streaming-stt',
  } = options;

  return {
    identity: identity({ id, displayName: 'Fake streaming STT', model: 'streaming' }),
    inputFormat: PCM16_8K,
    languageFor: passThrough,
    streaming: true,
    async *transcribe(request) {
      let consumed = 0;
      for await (const frame of request.audio) {
        consumed += frame.byteLength;
        // Streaming work happens DURING speech, which is precisely the
        // advantage a badly-measured benchmark erases.
      }
      if (consumed === 0) throw new Error('No audio was delivered to the STT adapter');

      clock.advance(interimAfterMs);
      yield { isFinal: false, text: segments[0]?.split(' ').slice(0, 2).join(' ') ?? '' } as SttResult;

      for (const [index, segment] of segments.entries()) {
        if (index > 0) clock.advance(interSegmentMs);
        clock.advance(residualMs);
        yield { isFinal: true, text: segment };
      }
    },
  };
}

/**
 * A realistic BATCH STT.
 *
 * Buffers everything, then processes in time proportional to audio duration —
 * which is what a file-upload API really does. Emits a single final.
 *
 * Its presence in the suite is the control that proves the benchmark does not
 * secretly favour one architecture: residual latency must be attributed
 * correctly for both.
 */
export function batchSttFake(options: {
  readonly id?: string;
  readonly text: string;
  /** Processing time as a multiple of audio duration. */
  readonly realTimeFactor?: number;
  readonly bytesPerMs: number;
  readonly clock: FakeClock;
}): BenchmarkSttAdapter {
  const { text, clock, realTimeFactor = 0.25, bytesPerMs, id = 'fake-batch-stt' } = options;
  return {
    identity: identity({ id, displayName: 'Fake batch STT', model: 'batch' }),
    inputFormat: PCM16_8K,
    languageFor: passThrough,
    streaming: false,
    async *transcribe(request) {
      let bytes = 0;
      for await (const frame of request.audio) bytes += frame.byteLength;
      if (bytes === 0) throw new Error('No audio was delivered to the STT adapter');
      const audioMs = bytes / bytesPerMs;
      clock.advance(audioMs * realTimeFactor);
      yield { isFinal: true, text };
    },
  };
}

/** An STT that fails, for exercising retry and failure accounting. */
export function failingSttFake(options: {
  readonly id?: string;
  /** Fail this many times before succeeding. `Infinity` never succeeds. */
  readonly failures: number;
  readonly error: () => Error;
  readonly text?: string;
  readonly clock: FakeClock;
}): BenchmarkSttAdapter {
  const { failures, error, text = 'recovered', clock, id = 'fake-failing-stt' } = options;
  let seen = 0;
  return {
    identity: identity({ id, displayName: 'Fake failing STT', model: 'failing' }),
    inputFormat: PCM16_8K,
    languageFor: passThrough,
    streaming: true,
    async *transcribe(request) {
      for await (const _f of request.audio) { /* drain */ }
      seen += 1;
      if (seen <= failures) throw error();
      clock.advance(50);
      yield { isFinal: true, text };
    },
  };
}

/**
 * A realistic streaming TTS.
 *
 * Delays first byte, then streams chunks. Leading chunks are silent, so
 * "first byte" and "first audible" are genuinely different marks — a provider
 * that emits 200 ms of silence immediately would otherwise look instant.
 */
export function streamingTtsFake(options: {
  readonly id?: string;
  readonly firstByteMs: number;
  readonly chunkMs?: number;
  readonly chunks?: number;
  readonly silentLeadingChunks?: number;
  readonly clock: FakeClock;
}): BenchmarkTtsAdapter {
  const {
    firstByteMs, clock, chunkMs = 20, chunks = 10,
    silentLeadingChunks = 2, id = 'fake-streaming-tts',
  } = options;

  return {
    identity: identity({ id, displayName: 'Fake streaming TTS', model: 'streaming' }),
    outputFormat: PCM16_8K,
    languageFor: passThrough,
    streaming: true,
    async *synthesize() {
      clock.advance(firstByteMs);
      for (let i = 0; i < chunks; i += 1) {
        if (i > 0) clock.advance(chunkMs);
        // 20 ms of pcm16 at 8 kHz = 160 samples = 320 bytes.
        const bytes = new Uint8Array(320);
        // Silent leading chunks are ACTUALLY silent bytes, not a flag. The
        // runner measures audibility from the samples, so a fake that merely
        // claimed silence would not exercise the check at all.
        if (i >= silentLeadingChunks) bytes.fill(64);
        yield { bytes } as TtsChunk;
      }
    },
  };
}

/** A TTS that fails, for retry and failure accounting. */
export function failingTtsFake(options: {
  readonly id?: string;
  readonly failures: number;
  readonly error: () => Error;
  readonly clock: FakeClock;
}): BenchmarkTtsAdapter {
  const { failures, error, clock, id = 'fake-failing-tts' } = options;
  let seen = 0;
  return {
    identity: identity({ id, displayName: 'Fake failing TTS', model: 'failing' }),
    outputFormat: PCM16_8K,
    languageFor: passThrough,
    streaming: true,
    async *synthesize() {
      seen += 1;
      if (seen <= failures) throw error();
      clock.advance(30);
      const bytes = new Uint8Array(320);
      bytes.fill(64);
      yield { bytes };
    },
  };
}

/** A TTS that returns nothing — the empty-response failure mode. */
export function emptyTtsFake(id = 'fake-empty-tts'): BenchmarkTtsAdapter {
  return {
    identity: identity({ id, displayName: 'Fake empty TTS', model: 'empty' }),
    outputFormat: PCM16_8K,
    languageFor: passThrough,
    streaming: true,
    async *synthesize() {
      // Deliberately yields nothing — the empty-response failure mode.
      if (false as boolean) yield { bytes: new Uint8Array(0) };
    },
  };
}

/**
 * A realistic streaming LLM.
 *
 * Delays the first token, then emits the rest word by word — so time to first
 * token and time to completion are genuinely different marks, which is what the
 * stage attribution depends on. It also opens with an EMPTY chunk, because real
 * streaming APIs commonly send a role/metadata frame first and a harness that
 * counted that as the first token would flatter every provider equally and
 * silently.
 */
export function streamingLlmFake(options: {
  readonly id?: string;
  readonly firstTokenMs: number;
  readonly perTokenMs?: number;
  readonly reply: string;
  readonly clock: FakeClock;
}): BenchmarkLlmAdapter {
  const { firstTokenMs, perTokenMs = 10, reply, clock, id = 'fake-streaming-llm' } = options;
  return {
    identity: identity({ id, displayName: 'Fake streaming LLM', model: 'streaming' }),
    streaming: true,
    async *complete() {
      yield { text: '' };
      clock.advance(firstTokenMs);
      const words = reply.split(' ');
      for (const [index, word] of words.entries()) {
        if (index > 0) clock.advance(perTokenMs);
        yield { text: index === 0 ? word : ` ${word}` };
      }
    },
  };
}

/** An LLM that fails, for turn-level failure accounting. */
export function failingLlmFake(options: {
  readonly id?: string;
  readonly failures: number;
  readonly error: () => Error;
  readonly clock: FakeClock;
}): BenchmarkLlmAdapter {
  const { failures, error, clock, id = 'fake-failing-llm' } = options;
  let seen = 0;
  return {
    identity: identity({ id, displayName: 'Fake failing LLM', model: 'failing' }),
    streaming: true,
    async *complete() {
      seen += 1;
      if (seen <= failures) throw error();
      clock.advance(20);
      yield { text: 'ok' };
    },
  };
}
