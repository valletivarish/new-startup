import { describe, expect, it } from 'vitest';
import { SAMPLE_CALL } from './sample-data';
import {
  BUBBLE,
  clockAt,
  FADE,
  GAP,
  HERO_BEATS,
  HERO_LOOP,
  HERO_TURNS,
  HOLD,
  HOLD_FROM,
  LEAD,
  listeningOf,
  PUSH,
  turnAt,
} from './live-call';

const last = HERO_TURNS.length - 1;
/** Loop times every 10ms, start to end. */
const ticks = Array.from({ length: Math.floor(HERO_LOOP * 100) + 1 }, (_, i) => i / 100);

describe('hero transcript sequence', () => {
  it("plays the sample call's opening as written, agent first, ending on the candidate", () => {
    expect(HERO_TURNS.length).toBeGreaterThanOrEqual(4);
    HERO_TURNS.forEach((turn, i) => {
      const source = SAMPLE_CALL.turns[i]!;
      expect(turn).toMatchObject({ speaker: source.speaker, at: source.at, text: source.text });
    });
    expect(HERO_TURNS[0]!.speaker).toBe('agent');
    expect(HERO_TURNS[last]!.speaker).toBe('contact');
  });

  it('lands a line every 0.9s after a short lead-in, each in 220ms', () => {
    expect(GAP).toBe(0.9);
    expect(BUBBLE).toBe(0.22);
    expect(HERO_BEATS[0]).toBe(LEAD);
    HERO_BEATS.slice(1).forEach((at, i) => expect(at - HERO_BEATS[i]!).toBeCloseTo(GAP, 10));
    // Each line has finished arriving before the next one starts.
    expect(Math.max(BUBBLE, PUSH)).toBeLessThan(GAP);
  });

  it('holds the last frame long enough to read, then fades and loops', () => {
    expect(HOLD_FROM).toBeCloseTo(HERO_BEATS[last]! + PUSH, 10);
    expect(HOLD).toBeGreaterThanOrEqual(5);
    expect(HERO_LOOP).toBeCloseTo(HOLD_FROM + HOLD + FADE, 10);
  });

  it('shows no line before the first beat, each line from its beat, and all of them while held', () => {
    expect(turnAt(0)).toBe(-1);
    expect(turnAt(LEAD - 0.01)).toBe(-1);
    HERO_BEATS.forEach((at, i) => {
      expect(turnAt(at)).toBe(i);
      if (i > 0) expect(turnAt(at - 0.01)).toBe(i - 1);
    });
    for (const time of [HOLD_FROM, HOLD_FROM + HOLD / 2, HERO_LOOP]) expect(turnAt(time)).toBe(last);
  });

  it("puts each line's own time on the timer as it lands, ticks forward between lines and stops on the last", () => {
    HERO_BEATS.forEach((at, i) => expect(clockAt(at)).toBe(HERO_TURNS[i]!.at));
    expect(clockAt(0)).toBe(HERO_TURNS[0]!.at);
    let previous = clockAt(0);
    for (const time of ticks) {
      const clock = clockAt(time);
      expect(clock).toBeGreaterThanOrEqual(previous);
      expect(clock).toBeLessThanOrEqual(HERO_TURNS[last]!.at!);
      previous = clock;
    }
    // Between two lines the timer runs on toward the next line's time.
    const mid = (HERO_BEATS[0]! + HERO_BEATS[1]!) / 2;
    expect(clockAt(mid)).toBeGreaterThan(HERO_TURNS[0]!.at!);
    expect(clockAt(mid)).toBeLessThan(HERO_TURNS[1]!.at!);
    // Held: the timer stops.
    expect(clockAt(HOLD_FROM)).toBe(HERO_TURNS[last]!.at);
    expect(clockAt(HERO_LOOP)).toBe(HERO_TURNS[last]!.at);
  });

  it('says Speaking while the agent talks and Listening while the candidate does', () => {
    HERO_TURNS.forEach((turn, i) => expect(listeningOf(i)).toBe(turn.speaker === 'agent' ? 'speaking' : 'listening'));
    expect(listeningOf(-1)).toBe('listening');
    // The frame the server draws, and the loop holds, reads "Listening…".
    expect(listeningOf(turnAt(HOLD_FROM))).toBe('listening');
  });
});
