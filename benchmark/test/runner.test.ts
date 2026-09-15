/**
 * Runner tests — the measuring instrument itself.
 *
 * These are the tests that decide whether the benchmark can be trusted with a
 * provider decision. Every latency figure is produced by a fake whose delay is
 * known EXACTLY and asserted against that known value, and the fakes are
 * deliberately hostile: they consume audio progressively, pause mid-utterance,
 * emit several finals, delay first byte, and require draining.
 *
 * The previous harness missed five critical defects because its fakes were
 * polite. That is the failure mode these tests exist to prevent recurring.
 */

import { describe, expect, it } from 'vitest';
import {
  batchSttFake, createFakeClock, emptyTtsFake, failingSttFake, failingTtsFake,
  streamingSttFake, streamingTtsFake,
} from '../src/adapters/fakes.js';
import { runSttCase } from '../src/runner/stt-runner.js';
import { runTtsCase } from '../src/runner/tts-runner.js';
import { framePcm, paceFrames } from '../src/runner/pacing.js';
import { frameDurationMs } from '../src/audio/codec.js';
import { aggregateStt, correlation } from '../src/results/aggregate.js';
import { HttpError } from '../src/adapters/http.js';

/** Speech of a given length, loud enough to be real audio. */
function speech(ms: number, sampleRate: 8000 | 16000 = 8000): Int16Array {
  const count = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) out[i] = Math.round(4000 * Math.sin(i / 8));
  return out;
}

const noSleep = async () => {};

describe('real-time pacing', () => {
  it('advances the clock by the audio duration, not instantly', async () => {
    const clock = createFakeClock();
    const frames = framePcm(speech(400), 8000);
    const consumed: number[] = [];
    for await (const _frame of paceFrames(
      frames, frameDurationMs, async (ms) => clock.advance(ms),
      { onAudioEnd: () => consumed.push(clock.now()) },
      // The same clock the fake sleep advances. Pacing is scheduled against a
      // clock, not accumulated from sleep durations, so the two must agree.
      clock.now,
    )) { /* drain */ }
    // 400 ms of audio in 20 ms frames.
    expect(frames).toHaveLength(20);
    expect(consumed[0]).toBeCloseTo(400, 0);
  });

  it('fires the endpoint hook AFTER the last frame, not before the first', async () => {
    const clock = createFakeClock();
    const marks: string[] = [];
    for await (const _f of paceFrames(
      framePcm(speech(100), 8000), frameDurationMs, async (ms) => clock.advance(ms),
      { onAudioStart: () => marks.push('start'), onAudioEnd: () => marks.push('end') },
    )) { /* drain */ }
    expect(marks).toEqual(['start', 'end']);
  });
});

describe('REGRESSION: STT residual latency is independent of utterance length', () => {
  // The defect: marking the endpoint before any audio was consumed, so the
  // stage measured cold whole-utterance processing. That figure scales with
  // utterance length and erases streaming's entire production advantage.
  async function residualFor(ms: number) {
    const clock = createFakeClock();
    const result = await runSttCase(
      {
        utteranceId: `u-${ms}`, samples: speech(ms), sampleRate: 8000,
        language: 'en-IN', reference: 'hello', entities: [], codeMixed: false,
      },
      {
        adapter: streamingSttFake({ segments: ['hello'], residualMs: 150, clock }),
        maxRetries: 0, clock: clock.now,
        sleep: async (delay) => clock.advance(delay), retrySleep: noSleep,
      },
    );
    return result;
  }

  it('measures the same residual for a short and a long utterance', async () => {
    const short = await residualFor(300);
    const long = await residualFor(3000);
    // interim(40) + residual(150) — both independent of how long the person spoke.
    expect(short.measurements.residualMs).toBe(190);
    expect(long.measurements.residualMs).toBe(190);
  });

  it('still records the audio duration separately, so the two are never confused', async () => {
    const result = await residualFor(1000);
    expect(result.measurements.audioDurationMs).toBeCloseTo(1000, 0);
    expect(result.measurements.residualMs).toBe(190);
  });

  it('reports wall-clock request time separately from the gated residual', async () => {
    const result = await residualFor(1000);
    // Wall clock includes the whole utterance; residual does not. Reporting
    // only the first would rank a streaming provider by upload speed.
    expect(result.measurements.totalMs).toBeGreaterThan(result.measurements.residualMs as number);
  });
});

describe('REGRESSION: the benchmark does not favour batch or streaming', () => {
  it('attributes residual correctly for a BATCH provider too', async () => {
    const clock = createFakeClock();
    // 8 kHz pcm16 = 16 bytes per ms.
    const result = await runSttCase(
      {
        utteranceId: 'b1', samples: speech(1000), sampleRate: 8000,
        language: 'en-IN', reference: 'hello', entities: [], codeMixed: false,
      },
      {
        adapter: batchSttFake({ text: 'hello', realTimeFactor: 0.25, bytesPerMs: 16, clock }),
        maxRetries: 0, clock: clock.now,
        sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
      },
    );
    // A batch provider genuinely does its work after the audio ends, so its
    // residual IS proportional to duration — 1000 ms × 0.25. That is a real
    // property of batch APIs, correctly attributed rather than hidden.
    expect(result.measurements.residualMs).toBeCloseTo(250, 0);
  });

  it('surfaces duration-correlation so a biased measurement is visible', async () => {
    const clock = createFakeClock();
    const results = [];
    for (const ms of [200, 400, 800, 1600, 3200]) {
      results.push(
        await runSttCase(
          {
            utteranceId: `c-${ms}`, samples: speech(ms), sampleRate: 8000,
            language: 'en-IN', reference: 'hello', entities: [], codeMixed: false,
          },
          {
            adapter: batchSttFake({ text: 'hello', realTimeFactor: 0.25, bytesPerMs: 16, clock }),
            maxRetries: 0, clock: clock.now,
            sleep: async (ms2) => clock.advance(ms2), retrySleep: noSleep,
          },
        ),
      );
    }
    const aggregate = aggregateStt(results);
    // Near 1.0 for a batch provider — the report warns on exactly this, so a
    // reader can tell whether they are looking at processing or at upload.
    expect(aggregate.residualVsDurationCorrelation).toBeGreaterThan(0.9);
  });

  it('computes correlation only with enough points', () => {
    expect(correlation([1, 2], [1, 2])).toBeUndefined();
    expect(correlation([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
});

describe('REGRESSION: multiple STT finals accumulate', () => {
  it('concatenates segments and times the LAST one', async () => {
    const clock = createFakeClock();
    const result = await runSttCase(
      {
        utteranceId: 'seg', samples: speech(600), sampleRate: 8000, language: 'en-IN',
        reference: 'i have 9 years of experience and my notice period is 90 days',
        entities: [
          { name: 'experience', kind: 'number', accept: ['9 years'], unit: 'years' },
          { name: 'notice', kind: 'duration', accept: ['90 days'], unit: 'days' },
        ],
        codeMixed: false,
      },
      {
        adapter: streamingSttFake({
          segments: ['i have 9 years of experience', 'and my notice period is 90 days'],
          residualMs: 100, interimAfterMs: 40, interSegmentMs: 150, clock,
        }),
        maxRetries: 0, clock: clock.now,
        sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
      },
    );

    // Both segments kept. Overwriting would drop the first half and score ~50%
    // deletions, penalising the streaming providers under comparison.
    expect(result.transcript).toBe(
      'i have 9 years of experience and my notice period is 90 days',
    );
    expect(result.accuracy?.wer).toBe(0);
    expect(result.accuracy?.entitiesFound).toBe(2);
    expect(result.measurements.finalCount).toBe(2);
    // Timing tracks the LAST final: 40 + 100 + 150 + 100.
    expect(result.measurements.residualMs).toBe(390);
  });

  it('records the first interim separately from the finals', async () => {
    const clock = createFakeClock();
    const result = await runSttCase(
      {
        utteranceId: 'i1', samples: speech(200), sampleRate: 8000, language: 'en-IN',
        reference: 'hello there', entities: [], codeMixed: false,
      },
      {
        adapter: streamingSttFake({ segments: ['hello there'], interimAfterMs: 35, residualMs: 90, clock }),
        maxRetries: 0, clock: clock.now,
        sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
      },
    );
    expect(result.measurements.firstInterimMs).toBe(35);
    expect(result.measurements.residualMs).toBe(125);
  });
});

describe('retries and failures are recorded, never hidden', () => {
  it('retries a transient fault and marks the sample as recovered', async () => {
    const clock = createFakeClock();
    const result = await runSttCase(
      {
        utteranceId: 'r1', samples: speech(200), sampleRate: 8000, language: 'en-IN',
        reference: 'recovered', entities: [], codeMixed: false,
      },
      {
        adapter: failingSttFake({
          failures: 2, error: () => new HttpError(429, 'Too Many Requests', 'slow down'), clock,
        }),
        maxRetries: 2, clock: clock.now,
        sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
      },
    );
    expect(result.failure).toBeUndefined();
    expect(result.attempts).toBe(3);
    expect(result.recovered).toBe(true);
  });

  it('EXCLUDES recovered samples from latency, so flakiness cannot look fast', async () => {
    const clock = createFakeClock();
    const flaky = await runSttCase(
      {
        utteranceId: 'r2', samples: speech(200), sampleRate: 8000, language: 'en-IN',
        reference: 'x', entities: [], codeMixed: false,
      },
      {
        adapter: failingSttFake({
          failures: 1, error: () => new HttpError(503, 'Unavailable', 'try again'), clock,
        }),
        maxRetries: 2, clock: clock.now,
        sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
      },
    );
    const aggregate = aggregateStt([flaky]);
    expect(aggregate.failures.recovered).toBe(1);
    expect(aggregate.sampleCount).toBe(0); // not counted in latency
    expect(aggregate.stages.stt).toBeUndefined();
  });

  it('gives up after the retry budget and categorises the failure', async () => {
    const clock = createFakeClock();
    const result = await runSttCase(
      {
        utteranceId: 'r3', samples: speech(200), sampleRate: 8000, language: 'en-IN',
        reference: 'x', entities: [], codeMixed: false,
      },
      {
        adapter: failingSttFake({
          failures: Number.POSITIVE_INFINITY,
          error: () => new HttpError(500, 'Server Error', 'boom'), clock,
        }),
        maxRetries: 1, clock: clock.now,
        sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
      },
    );
    expect(result.failure?.category).toBe('transient_transport');
    expect(result.attempts).toBe(2);
  });

  it('does NOT retry a credentials problem — that is a setup error, not a result', async () => {
    const clock = createFakeClock();
    await expect(
      runSttCase(
        {
          utteranceId: 'a1', samples: speech(100), sampleRate: 8000, language: 'en-IN',
          reference: 'x', entities: [], codeMixed: false,
        },
        {
          adapter: failingSttFake({
            failures: Number.POSITIVE_INFINITY,
            error: () => new HttpError(401, 'Unauthorized', 'bad key'), clock,
          }),
          maxRetries: 3, clock: clock.now,
          sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
        },
      ),
    ).rejects.toThrow(/credentials rejected/i);
  });

  it('does NOT retry a quota problem — retrying spends money that is gone', async () => {
    const clock = createFakeClock();
    await expect(
      runSttCase(
        {
          utteranceId: 'q1', samples: speech(100), sampleRate: 8000, language: 'en-IN',
          reference: 'x', entities: [], codeMixed: false,
        },
        {
          adapter: failingSttFake({
            failures: Number.POSITIVE_INFINITY,
            error: () => new HttpError(402, 'Payment Required', 'insufficient credit'), clock,
          }),
          maxRetries: 3, clock: clock.now,
          sleep: async (ms) => clock.advance(ms), retrySleep: noSleep,
        },
      ),
    ).rejects.toThrow(/quota or credit exhausted/i);
  });

  it('rejects an adapter that never consumed the audio', async () => {
    const clock = createFakeClock();
    const lazy = {
      identity: { id: 'lazy', displayName: 'lazy', adapterVersion: '0', model: 'x', unverified: false },
      inputFormat: { encoding: 'pcm16' as const, sampleRate: 8000 as const, channels: 1 as const },
      streaming: false,
      languageFor: (language: string) => language,
      // eslint-disable-next-line require-yield
      async *transcribe() { throw new Error('No audio was delivered to the STT adapter'); },
    };
    const result = await runSttCase(
      {
        utteranceId: 'l1', samples: speech(100), sampleRate: 8000, language: 'en-IN',
        reference: 'x', entities: [], codeMixed: false,
      },
      { adapter: lazy, maxRetries: 0, clock: clock.now, sleep: noSleep, retrySleep: noSleep },
    );
    expect(result.failure).toBeDefined();
  });
});

describe('TTS measurement', () => {
  it('measures time to first byte from the request, not from an LLM mark', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l1', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: streamingTtsFake({ firstByteMs: 140, clock }),
        maxRetries: 0, clock: clock.now, retrySleep: noSleep,
      },
    );
    expect(result.measurements.firstByteMs).toBe(140);
  });

  it('reads only as far as the first AUDIBLE byte by default, never the whole stream', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l2', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: streamingTtsFake({
          firstByteMs: 100, chunkMs: 20, chunks: 50, silentLeadingChunks: 2, clock,
        }),
        maxRetries: 0, clock: clock.now, retrySleep: noSleep,
      },
    );
    // Three chunks: two silent, then the first audible one. Stopping at chunk
    // ONE made `firstAudible` reachable only when the very first chunk happened
    // to carry sound, which silently disabled the leading-silence check.
    expect(result.timeline.bytes).toBe(960);
    expect(result.measurements.firstByteMs).toBe(100);
    expect(result.measurements.firstAudibleMs).toBe(140);
    // And it is emphatically not a drain: 50 chunks would reach ~1080 ms.
    expect(clock.now()).toBe(140);
    expect(result.measurements.totalMs).toBeUndefined();
  });

  it('stops probing for audio rather than draining a fully silent synthesis', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l2b', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: streamingTtsFake({
          firstByteMs: 100, chunkMs: 20, chunks: 500, silentLeadingChunks: 500, clock,
        }),
        maxRetries: 0, clock: clock.now, retrySleep: noSleep,
      },
    );
    expect(result.timeline.bytes).toBeLessThanOrEqual(32_000);
    expect(result.measurements.firstAudibleMs).toBeUndefined();
  });

  it('drains and reports real-time factor when explicitly asked', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l3', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: streamingTtsFake({ firstByteMs: 100, chunkMs: 10, chunks: 10, clock }),
        maxRetries: 0, drain: true, clock: clock.now, retrySleep: noSleep,
      },
    );
    expect(result.timeline.bytes).toBe(3200);
    // 3200 bytes of pcm16 at 8 kHz = 1600 samples = 200 ms of audio.
    // Computed from the byte count, NOT from a buffer that is only populated
    // when the caller also asked to keep the audio.
    expect(result.measurements.outputDurationMs).toBeCloseTo(200, 0);
    expect(result.measurements.realTimeFactor).toBeGreaterThan(0);
  });

  it('reports output duration without being asked to keep the audio', async () => {
    // Regression: duration was derived from the kept-audio buffer, so it was
    // silently 0 whenever keepAudio was false — which is every latency run.
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l3b', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: streamingTtsFake({ firstByteMs: 10, chunkMs: 5, chunks: 4, clock }),
        maxRetries: 0, drain: true, keepAudio: false, clock: clock.now, retrySleep: noSleep,
      },
    );
    expect(result.audio).toBeUndefined();
    expect(result.measurements.outputDurationMs).toBeCloseTo(80, 0);
  });

  it('separates first byte from first AUDIBLE byte', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l4', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: streamingTtsFake({
          firstByteMs: 50, chunkMs: 30, chunks: 6, silentLeadingChunks: 3, clock,
        }),
        maxRetries: 0, drain: true, clock: clock.now, retrySleep: noSleep,
      },
    );
    // A provider emitting leading silence looks instant on first-byte alone.
    expect(result.measurements.firstByteMs).toBe(50);
    expect(result.measurements.firstAudibleMs).toBeGreaterThan(
      result.measurements.firstByteMs as number,
    );
  });

  it('treats an empty response as a failure, not a fast success', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l5', text: 'hello', language: 'en-IN', codeMixed: false },
      { adapter: emptyTtsFake(), maxRetries: 0, clock: clock.now, retrySleep: noSleep },
    );
    expect(result.failure).toBeDefined();
    expect(result.measurements.firstByteMs).toBeUndefined();
  });

  it('retries a transient TTS fault', async () => {
    const clock = createFakeClock();
    const result = await runTtsCase(
      { lineId: 'l6', text: 'hello', language: 'en-IN', codeMixed: false },
      {
        adapter: failingTtsFake({
          failures: 1, error: () => new HttpError(429, 'Too Many Requests', 'slow'), clock,
        }),
        maxRetries: 2, clock: clock.now, retrySleep: noSleep,
      },
    );
    expect(result.failure).toBeUndefined();
    expect(result.recovered).toBe(true);
  });
});
