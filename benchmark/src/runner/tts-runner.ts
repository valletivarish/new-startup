/**
 * TTS benchmark runner.
 *
 * Measures time to first byte, time to first AUDIBLE byte, and — only when
 * explicitly asked — full synthesis.
 *
 * TWO DELIBERATE CHOICES:
 *
 *  * `drain: false` by default. The rule gates on time-to-first-byte, so
 *    reading the rest transfers audio nobody measures.
 *
 *    BE PRECISE ABOUT WHAT THIS SAVES. For the endpoints implemented here it
 *    saves TIME and BANDWIDTH, not quota: these are per-character-billed
 *    request/response APIs, so the synthesis is paid for the moment the request
 *    is accepted. It would save quota only against a genuinely cancellable
 *    streaming endpoint billed by what was delivered. An earlier version of
 *    this comment claimed a quota saving that does not exist.
 *  * First byte and first AUDIBLE byte are distinct marks. A provider that
 *    emits 200 ms of silence immediately would otherwise look instant.
 */

import type { AudioFormat } from '@platform/providers';
import type { BenchmarkTtsAdapter, CorpusLanguageTag } from '../adapters/types.js';
import { mulawToLinear } from '../audio/codec.js';
import {
  createTtsRecorder,
  measureTts,
  systemClock,
  type Clock,
  type TtsMeasurements,
  type TtsTimeline,
} from '../measure/latency.js';
import { withRetries, type FailureCategory } from '../measure/failures.js';
import { realSleep, type Sleep } from './pacing.js';

export interface TtsCase {
  readonly lineId: string;
  readonly text: string;
  readonly language: CorpusLanguageTag;
  readonly codeMixed: boolean;
}

export interface TtsCaseResult {
  readonly lineId: string;
  readonly timeline: TtsTimeline;
  readonly measurements: TtsMeasurements;
  readonly codeMixed: boolean;
  readonly attempts: number;
  readonly recovered: boolean;
  readonly failure?: { category: FailureCategory; message: string };
  /** Kept only when the caller asked to drain, for the listening gate. */
  readonly audio?: Uint8Array;
}

export interface TtsRunOptions {
  readonly adapter: BenchmarkTtsAdapter;
  readonly maxRetries: number;
  /**
   * Consume the whole stream.
   *
   * Required for the blind listening gate (you cannot listen to one byte) and
   * for real-time-factor. Off for latency-only runs, to save quota.
   */
  readonly drain?: boolean;
  /** Keep the bytes. Only meaningful with `drain`. */
  readonly keepAudio?: boolean;
  readonly clock?: Clock;
  readonly retrySleep?: Sleep;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** No single line may hold the sweep open forever. */
export const DEFAULT_TTS_TIMEOUT_MS = 60_000;

/**
 * How far to read looking for the first audible byte when not draining.
 *
 * 32 kB is 2 seconds of 8 kHz pcm16 — far longer than any plausible leading
 * silence, and a hard stop so a fully-silent synthesis cannot read the whole
 * stream while claiming not to drain.
 */
export const MAX_SILENCE_PROBE_BYTES = 32_000;

/**
 * Is this chunk anything other than digital silence?
 *
 * Measured HERE rather than taken from the adapter. An adapter that asserts
 * `audible: true` on every chunk makes first-audible equal first-byte by
 * construction, which silently deletes the leading-silence check that exists to
 * stop a provider looking instant while a candidate hears nothing.
 */
export function isAudible(
  bytes: Uint8Array,
  format: AudioFormat = { encoding: 'pcm16', sampleRate: 8000, channels: 1 },
  threshold = 128,
): boolean {
  if (format.encoding === 'mulaw') {
    // mu-law digital silence is 0xFF; anything meaningfully away from it is
    // sound. Decoding every byte would be wasteful on the hot path.
    const step = Math.max(1, Math.floor(bytes.length / 64));
    for (let i = 0; i < bytes.length; i += step) {
      if (Math.abs(mulawToLinear(bytes[i] as number)) > threshold) return true;
    }
    return false;
  }
  // pcm16 little-endian: check magnitude of a few samples rather than all,
  // since this runs per chunk on the hot path.
  const step = Math.max(2, Math.floor(bytes.length / 64) * 2);
  for (let i = 0; i + 1 < bytes.length; i += step) {
    const sample = (((bytes[i + 1] as number) << 8) | (bytes[i] as number)) << 16 >> 16;
    if (Math.abs(sample) > threshold) return true;
  }
  return false;
}

export async function runTtsCase(
  testCase: TtsCase,
  options: TtsRunOptions,
): Promise<TtsCaseResult> {
  const {
    adapter, maxRetries, drain = false, keepAudio = false,
    clock = systemClock, retrySleep = realSleep,
    timeoutMs = DEFAULT_TTS_TIMEOUT_MS,
  } = options;

  let recorder = createTtsRecorder(clock);
  let collected: Uint8Array[] = [];
  // Counted outside the recorder: `attempt()` replaces the recorder on entry
  // and withRetries increments before re-invoking it, so an in-recorder counter
  // always landed on the object about to be discarded.
  let retries = 0;

  const attempt = async (): Promise<void> => {
    recorder = createTtsRecorder(clock);
    collected = [];

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);

    let sawBytes = false;
    // Counted independently of `collected`, which is only populated when the
    // caller asked to KEEP the audio. Deriving duration from `collected` made
    // it silently zero — and real-time factor with it — on every run that did
    // not also request the bytes.
    let totalBytes = 0;

    try {
      const stream = adapter.synthesize({
        text: testCase.text,
        language: testCase.language,
        signal: controller.signal,
      });

      let audible = false;
      for await (const chunk of stream) {
        // A zero-length chunk is not a first byte. Marking one would report a
        // provider as instant for sending nothing.
        if (chunk.bytes.byteLength === 0) continue;
        sawBytes = true;
        recorder.firstByte();
        recorder.chunk(chunk.bytes.byteLength);
        totalBytes += chunk.bytes.byteLength;
        if (!audible && isAudible(chunk.bytes, adapter.outputFormat)) {
          recorder.firstAudible();
          audible = true;
        }
        if (keepAudio) collected.push(chunk.bytes);

        if (!drain) {
          // Read on until the first AUDIBLE byte, or until the leading-silence
          // budget is exhausted. Breaking at the very first byte made
          // `firstAudible` reachable only when chunk one happened to be
          // audible — which silently disabled the leading-silence check, the
          // one thing standing between the gate and a provider that emits
          // 200 ms of silence and looks instant.
          //
          // This costs no extra quota: for a streaming response the bytes are
          // already in flight, and synthesis was billed when the request was
          // accepted.
          if (audible || totalBytes >= MAX_SILENCE_PROBE_BYTES) break;
        }
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      controller.abort();
    }

    if (!sawBytes) throw new Error('TTS produced no audio at all (empty response)');

    if (drain) {
      // Bytes per sample depends on the encoding: pcm16 is 2, mu-law is 1.
      // Hard-coding 2 would have halved every mu-law duration and doubled its
      // real-time factor.
      const bytesPerSample = adapter.outputFormat.encoding === 'mulaw' ? 1 : 2;
      const durationMs = (totalBytes / bytesPerSample / adapter.outputFormat.sampleRate) * 1000;
      recorder.completed(durationMs);
    }
  };

  const outcome = await withRetries(attempt, {
    maxRetries,
    provider: adapter.identity.id,
    onRetry: () => { retries += 1; },
    sleep: retrySleep,
  });

  const timeline: TtsTimeline = { ...recorder.timeline(), retries };
  const base = {
    lineId: testCase.lineId,
    timeline,
    measurements: measureTts(timeline),
    codeMixed: testCase.codeMixed,
    attempts: outcome.attempts,
    recovered: outcome.recovered,
  };

  if (outcome.failure) return { ...base, recovered: false, failure: outcome.failure };

  if (keepAudio && collected.length > 0) {
    const total = collected.reduce((n, c) => n + c.byteLength, 0);
    const audio = new Uint8Array(total);
    let offset = 0;
    for (const chunk of collected) { audio.set(chunk, offset); offset += chunk.byteLength; }
    return { ...base, audio };
  }
  return base;
}
