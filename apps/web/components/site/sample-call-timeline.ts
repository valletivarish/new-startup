/**
 * The sample call's timeline: call seconds in, current turn and labels out. Pure, so the
 * player (sample-call.tsx) only follows the recording and draws.
 */

import { formatDuration } from '../../lib/format';
import { SAMPLE_CALL } from './sample-data';

/** Length of the sample call in seconds: the recording's length. */
export const DURATION: number = SAMPLE_CALL.durationSeconds;

/** When each turn starts, in call seconds. Turns can overlap: a later one may start first. */
export const TURN_TIMES: readonly number[] = SAMPLE_CALL.turns.map((turn) => turn.at);

/** Index of the turn being spoken at `seconds`: the last one that has started. -1 before the first. */
export function turnIndexAt(seconds: number, times: readonly number[] = TURN_TIMES): number {
  let index = -1;
  times.forEach((at, i) => {
    if (at <= seconds) index = i;
  });
  return index;
}

/** A position inside the call: 0 to the end. */
export function clampTime(seconds: number, duration = DURATION): number {
  return Number.isFinite(seconds) ? Math.min(duration, Math.max(0, seconds)) : 0;
}

/** Where Play starts: from the current position, or from the top once the call has ended. */
export function playFrom(seconds: number, duration = DURATION): number {
  return seconds >= duration ? 0 : clampTime(seconds, duration);
}

/** m:ss, counting whole seconds: 41.9 reads 0:41. */
export function clock(seconds: number): string {
  return formatDuration(Math.floor(clampTime(seconds, Number.POSITIVE_INFINITY)));
}

/** The scrubber's spoken value: "0:42 of 1:21". */
export function positionText(seconds: number, duration = DURATION): string {
  return `${clock(seconds)} of ${clock(duration)}`;
}

/** 0 to 100: how far through the call, for the played part of the track. */
export function percentAt(seconds: number, duration = DURATION): number {
  return duration > 0 ? (clampTime(seconds, duration) / duration) * 100 : 0;
}
