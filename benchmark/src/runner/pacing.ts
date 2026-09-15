/**
 * Real-time audio pacing.
 *
 * THE DEFECT THIS EXISTS TO PREVENT: feeding an utterance to STT as fast as the
 * consumer will take it, then treating the moment the request was issued as
 * "end of speech".
 *
 * On a live call audio arrives AS THE CANDIDATE SPEAKS, so a streaming provider
 * has already processed everything but the last fragment when the endpoint
 * fires. Handing it the whole utterance instantly instead measures cold
 * whole-utterance processing — a number proportional to utterance length that
 * erases streaming's entire production advantage and biases the comparison
 * toward batch APIs.
 *
 * THE SECOND DEFECT, found by adversarial review: pacing that sleeps a full
 * frame duration between yields is CUMULATIVE, not scheduled. Whatever the
 * consuming adapter spends between pulls is added to the audio timeline instead
 * of being absorbed by it, so a slow consumer is handed extra wall clock before
 * the endpoint mark — 222 ms of free head start for a 3 ms/frame consumer over
 * one second of audio, against a 300 ms budget. Frames are therefore scheduled
 * against an absolute deadline: frame i is due at start + (i+1) × its duration,
 * and a slow consumer eats into its own slack.
 *
 * `sleep` and `clock` are injected so tests advance a fake clock instead of
 * really waiting.
 */

import type { NormalizedAudioFrame } from '@platform/providers';
import { systemClock, type Clock } from '../measure/latency.js';

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PacingHooks {
  /** Called immediately before the first frame is yielded. */
  readonly onAudioStart?: () => void;
  /**
   * Called when audio delivery ends — this is the endpoint.
   *
   * Reports how many frames were actually delivered against how many existed,
   * so a caller can tell "the provider consumed the utterance" from "the
   * provider walked away after two frames". The second case must never be
   * reported as a fast residual.
   */
  readonly onAudioEnd?: (delivered: number, total: number) => void;
}

/**
 * Yield frames on a real-time schedule.
 *
 * Frame i is delivered at `start + Σ durations up to i`, measured against the
 * clock rather than by accumulating sleeps, so consumer cost is absorbed by the
 * schedule instead of extending it.
 *
 * The endpoint hook fires after the final frame — where a VAD would fire on a
 * live call, and the origin every downstream latency is measured from. It runs
 * in a `finally`, so an adapter that abandons the audio early still produces an
 * endpoint rather than leaving the mark unset for the caller to fabricate later.
 */
export async function* paceFrames(
  frames: readonly NormalizedAudioFrame[],
  frameDurationMs: (frame: NormalizedAudioFrame) => number,
  sleep: Sleep = realSleep,
  hooks: PacingHooks = {},
  clock: Clock = systemClock,
): AsyncIterable<Uint8Array> {
  let started = false;
  let delivered = 0;
  let start = 0;
  let due = 0;
  try {
    for (const frame of frames) {
      if (!started) {
        hooks.onAudioStart?.();
        start = clock();
        started = true;
      }
      due += frameDurationMs(frame);
      const wait = start + due - clock();
      if (wait > 0) await sleep(wait);
      delivered += 1;
      yield frame.payload;
    }
  } finally {
    hooks.onAudioEnd?.(delivered, frames.length);
  }
}

/**
 * Split PCM samples into fixed-duration frames.
 *
 * 20 ms is the telephony convention and what every carrier in the research
 * uses, so the benchmark feeds audio the same shape production will.
 */
export function framePcm(
  samples: Int16Array,
  sampleRate: 8000 | 16000,
  frameMs = 20,
): NormalizedAudioFrame[] {
  const samplesPerFrame = Math.round((sampleRate * frameMs) / 1000);
  const frames: NormalizedAudioFrame[] = [];
  for (let offset = 0, sequence = 0; offset < samples.length; offset += samplesPerFrame, sequence += 1) {
    const slice = samples.subarray(offset, Math.min(offset + samplesPerFrame, samples.length));
    const payload = new Uint8Array(slice.length * 2);
    for (let i = 0; i < slice.length; i += 1) {
      const value = slice[i] as number;
      payload[i * 2] = value & 0xff;
      payload[i * 2 + 1] = (value >> 8) & 0xff;
    }
    frames.push({
      encoding: 'pcm16',
      sampleRate,
      channels: 1,
      timestampMs: (offset / sampleRate) * 1000,
      sequence,
      payload,
    });
  }
  return frames;
}
