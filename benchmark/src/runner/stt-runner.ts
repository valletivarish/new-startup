/**
 * STT benchmark runner.
 *
 * Feeds one utterance at real time, records every mark, accumulates finals, and
 * scores the transcript. One utterance per call; the sweep composes them.
 *
 * ACCUMULATION MATTERS: real streaming STT emits one final per endpointed
 * segment, so a mid-answer pause produces several. Keeping only the last would
 * score the provider as having deleted most of the answer — and would penalise
 * exactly the streaming providers the benchmark exists to compare fairly.
 *
 * CONSUMPTION MATTERS TOO: the residual is measured from the moment the last
 * frame was handed over. An adapter that walks away after two frames would end
 * the audio early and post a flatteringly small residual, so partial
 * consumption is recorded as a failure rather than as a fast result.
 */

import { createHash } from 'node:crypto';
import type { AudioFormat, TranscriptAccuracy } from '@platform/providers';

import type { BenchmarkSttAdapter, CorpusLanguageTag } from '../adapters/types.js';
import { convertFrame, frameDurationMs } from '../audio/codec.js';
import type { EntityExpectationInput } from '../corpus/manifest.js';
import {
  createSttRecorder,
  measureStt,
  systemClock,
  type Clock,
  type SttMeasurements,
  type SttTimeline,
} from '../measure/latency.js';
import {
  scoreAgainstBestReference, type EntityResult, type NormalisationOptions,
} from '../measure/accuracy.js';
import {
  classify,
  withRetries,
  type FailureCategory,
} from '../measure/failures.js';
import { framePcm, paceFrames, realSleep, type Sleep } from './pacing.js';

/** No single utterance may hold the sweep open forever. */
export const DEFAULT_STT_TIMEOUT_MS = 120_000;

export interface SttCase {
  readonly utteranceId: string;
  readonly samples: Int16Array;
  readonly sampleRate: 8000 | 16000;
  readonly language: CorpusLanguageTag;
  readonly reference: string;
  /** The same utterance in the other alphabet, where the corpus supplies one. */
  readonly referenceAlt?: string;
  readonly entities: readonly EntityExpectationInput[];
  readonly codeMixed: boolean;
}

export interface SttCaseResult {
  readonly utteranceId: string;
  readonly transcript: string;
  readonly timeline: SttTimeline;
  readonly measurements: SttMeasurements;
  readonly accuracy?: TranscriptAccuracy & { entityResults?: readonly EntityResult[] };
  /**
   * Set when the transcript could not be compared with any supplied reference.
   *
   * A cross-alphabet comparison reports a flawless transcription as a total
   * failure, so such a sample is excluded from accuracy entirely and the run is
   * INCOMPLETE — it is a corpus gap, not a provider result.
   */
  readonly unscoreable?: string;
  /**
   * How many entities this utterance expected, recorded even when the case
   * failed.
   *
   * A hard-failed utterance used to contribute nothing to the entity
   * denominator, which made failing outright score strictly better than
   * transcribing badly. The count has to survive the failure to fix that.
   */
  readonly expectedEntityCount: number;
  readonly codeMixed: boolean;
  readonly attempts: number;
  readonly recovered: boolean;
  readonly failure?: { category: FailureCategory; message: string };
  /**
   * SHA-256 of the bytes this adapter was actually handed.
   *
   * The corpus checksum proves the CONDITIONED audio was identical; this proves
   * what survived the per-adapter format conversion. Two adapters requesting
   * different formats legitimately differ here, and that difference must be
   * visible rather than hidden behind one checksum that covers neither.
   */
  readonly deliveredChecksum: string;
}

export interface SttRunOptions {
  readonly adapter: BenchmarkSttAdapter;
  readonly maxRetries: number;
  readonly normalisation?: NormalisationOptions;
  readonly clock?: Clock;
  readonly sleep?: Sleep;
  /** Sleep used by the retry backoff. Separate so tests can zero it. */
  readonly retrySleep?: Sleep;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

class AudioNotConsumedError extends Error {
  constructor(delivered: number, total: number) {
    super(
      `Adapter consumed only ${delivered} of ${total} audio frames before returning. ` +
        'The endpoint mark, and therefore the post-endpoint residual, would be measured ' +
        'from a truncated utterance — so this sample is recorded as a failure rather than ' +
        'as a fast result.',
    );
    this.name = 'AudioNotConsumedError';
  }
}

export async function runSttCase(
  testCase: SttCase,
  options: SttRunOptions,
): Promise<SttCaseResult> {
  const {
    adapter, maxRetries,
    clock = systemClock, sleep = realSleep, retrySleep = realSleep,
    timeoutMs = DEFAULT_STT_TIMEOUT_MS,
  } = options;

  // Convert to the adapter's requested format ONCE, before timing starts, so
  // conversion cost is never attributed to the provider — and so every
  // provider demonstrably receives audio derived from the same source.
  const sourceFrames = framePcm(testCase.samples, testCase.sampleRate);
  const target: AudioFormat = adapter.inputFormat;
  const frames = sourceFrames.map((frame) => convertFrame(frame, target));

  const digest = createHash('sha256');
  for (const frame of frames) digest.update(frame.payload);
  const deliveredChecksum = digest.digest('hex');

  let recorder = createSttRecorder(clock);
  let transcript = '';
  // Retries are counted OUTSIDE the recorder: `attempt()` replaces the recorder
  // on entry, and withRetries calls onRetry before re-invoking it, so an
  // in-recorder counter always landed on the object about to be discarded and
  // every stored timeline reported zero retries.
  let retries = 0;

  const attempt = async (): Promise<string> => {
    recorder = createSttRecorder(clock);
    transcript = '';

    let delivered = 0;
    let expected = frames.length;
    const audio = paceFrames(
      frames,
      frameDurationMs,
      sleep,
      {
        onAudioStart: () => recorder.audioStarted(),
        onAudioEnd: (count, total) => {
          delivered = count;
          expected = total;
          recorder.audioEnded();
        },
      },
      clock,
    );

    // A per-attempt controller so a hung provider cannot hold the sweep open,
    // and so the `timeout` failure category is reachable at all.
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);

    try {
      const stream = adapter.transcribe({
        audio,
        format: target,
        language: testCase.language,
        signal: controller.signal,
      });

      for await (const result of stream) {
        if (result.isFinal) {
          transcript = transcript === '' ? result.text : `${transcript} ${result.text}`;
          recorder.final();
        } else {
          recorder.interim();
        }
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      controller.abort();
    }

    // A provider that never drained the audio still has an endpoint: at latest,
    // when its stream closed. First-write-wins makes this a no-op normally.
    recorder.audioEnded();
    recorder.completed();

    if (delivered < expected) throw new AudioNotConsumedError(delivered, expected);
    return transcript;
  };

  const outcome = await withRetries(attempt, {
    maxRetries,
    provider: adapter.identity.id,
    onRetry: () => { retries += 1; },
    sleep: retrySleep,
  });

  const timeline: SttTimeline = { ...recorder.timeline(), retries };

  if (outcome.failure) {
    return {
      utteranceId: testCase.utteranceId,
      transcript: '',
      timeline,
      measurements: measureStt(timeline),
      codeMixed: testCase.codeMixed,
      attempts: outcome.attempts,
      recovered: false,
      failure: outcome.failure,
      deliveredChecksum,
      expectedEntityCount: testCase.entities.length,
    };
  }

  const references = [testCase.reference, ...(testCase.referenceAlt ? [testCase.referenceAlt] : [])];
  const scored = scoreAgainstBestReference(
    references,
    outcome.value ?? '',
    options.normalisation ?? {},
    testCase.entities,
  );

  const base = {
    utteranceId: testCase.utteranceId,
    transcript: outcome.value ?? '',
    timeline,
    measurements: measureStt(timeline),
    codeMixed: testCase.codeMixed,
    attempts: outcome.attempts,
    recovered: outcome.recovered,
    deliveredChecksum,
    expectedEntityCount: testCase.entities.length,
  };

  if ('unscoreable' in scored) return { ...base, unscoreable: scored.reason };
  return { ...base, accuracy: scored };
}

export { classify };
