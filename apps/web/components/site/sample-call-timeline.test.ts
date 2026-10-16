import { describe, expect, it } from 'vitest';
import { SAMPLE_CALL } from './sample-data';
import { clampTime, clock, DURATION, percentAt, playFrom, positionText, TURN_TIMES, turnIndexAt } from './sample-call-timeline';

describe('sample call timeline', () => {
  it('maps call seconds to the turn being spoken', () => {
    expect(turnIndexAt(0)).toBe(0);
    expect(turnIndexAt(TURN_TIMES[1]! - 0.01)).toBe(0);
    expect(turnIndexAt(TURN_TIMES[1]!)).toBe(1);
    expect(turnIndexAt(DURATION)).toBe(SAMPLE_CALL.turns.length - 1);
    expect(turnIndexAt(-1)).toBe(-1);
    expect(turnIndexAt(3, [5, 10])).toBe(-1);
  });

  it('keeps seeks inside the call and replays from the top once ended', () => {
    expect(clampTime(-4)).toBe(0);
    expect(clampTime(500)).toBe(DURATION);
    expect(clampTime(Number.NaN)).toBe(0);
    expect(playFrom(DURATION)).toBe(0);
    expect(playFrom(40)).toBe(40);
    expect(percentAt(DURATION)).toBe(100);
  });

  it('reads the clock in whole seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(41.9)).toBe('0:41');
    expect(clock(81.4)).toBe('1:21');
    expect(positionText(42, 81)).toBe('0:42 of 1:21');
  });

  it('matches the sample data: turns in order inside the call, every answer on a candidate turn', () => {
    expect(TURN_TIMES).toEqual([...TURN_TIMES].sort((a, b) => a - b));
    expect(Math.max(...TURN_TIMES)).toBeLessThan(DURATION);
    const candidateTimes = SAMPLE_CALL.turns.filter((t) => t.speaker === 'contact').map((t) => t.at);
    for (const answer of SAMPLE_CALL.answers) {
      if (answer.at != null) expect(candidateTimes).toContain(answer.at);
    }
  });
});
