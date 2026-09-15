/**
 * Verdict tests — the pre-registered rule.
 *
 * The rule is the spine of the decision, so these tests check not only that it
 * accepts and rejects correctly, but that it cannot be GAMED: a provider must
 * not pass by failing fast, by missing a measurement, or by being good on
 * average while bad on the code-mixed traffic that matters most.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluate, HINGLISH_MIN_ENTITY_ACCURACY, MIN_SAMPLES_FOR_VERDICT, PHASE_5C_THRESHOLDS,
} from '../src/measure/verdict.js';
import {
  aggregate, createTurnRecorder, distribution, percentile, stageDurations,
} from '../src/measure/latency.js';

const dist = (p50: number, p95: number, count = 30) => ({
  count, p50, p95, min: p50, max: p95,
});
const accuracy = (over: Partial<Record<string, number>> = {}) => ({
  wer: 0.1, cer: 0.05, substitutions: 1, deletions: 0, insertions: 0, referenceWords: 100,
  entityAccuracy: 1, entitiesExpected: 20, entitiesFound: 20, entitiesWrong: 0,
  ...over,
}) as never;

describe('the headline gate', () => {
  it('passes a run inside every threshold', () => {
    const result = evaluate({
      stages: { total_turn: dist(900, 1500) },
      accuracy: accuracy(),
      hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('PASS');
  });

  it('fails on p50 and says by how much', () => {
    const result = evaluate({
      stages: { total_turn: dist(1400, 1800) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.failures[0]).toMatch(/1400 ms exceeds the 1200 ms gate/);
  });

  it('fails on p95 even when p50 is comfortable', () => {
    const result = evaluate({
      stages: { total_turn: dist(700, 2600) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.join(' ')).toMatch(/p95/);
  });
});

describe('REGRESSION: stage budgets are advisory, not gates', () => {
  it('passes a stack that meets the total while overspending one stage', () => {
    // The budgets sum to 1100 ms; gating on them would silently impose a
    // tighter total than the 1200 ms actually pre-registered.
    const result = evaluate({
      stages: { total_turn: dist(1100, 1800), stt: dist(400, 500) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('PASS');
    expect(result.failures).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/Speech-to-text p50 400 ms is over its 300 ms budget/);
  });

  it('verifies the stage budgets really do sum below the total', () => {
    // Guards the arithmetic claim the design document makes.
    const sum =
      (PHASE_5C_THRESHOLDS.sttP50Ms ?? 0) +
      (PHASE_5C_THRESHOLDS.llmFirstTokenP50Ms ?? 0) +
      (PHASE_5C_THRESHOLDS.ttsFirstByteP50Ms ?? 0);
    expect(sum).toBe(1100);
    expect(sum).toBeLessThan(PHASE_5C_THRESHOLDS.totalTurnP50Ms);
  });
});

describe('REGRESSION: hard failures are a count, not a rate', () => {
  it('tolerates one transient failure in 30 turns', () => {
    // A 2% rate threshold is unreachable at n=30: one failure is 3.3%.
    const result = evaluate({
      stages: { total_turn: dist(900, 1500, 29) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 29, hardFailureCount: 1, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('PASS');
  });

  it('fails a genuinely unreliable provider', () => {
    const result = evaluate({
      stages: { total_turn: dist(900, 1500, 26) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 26, hardFailureCount: 4, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.join(' ')).toMatch(/4 hard failures/);
  });
});

describe('the Hinglish sub-gate', () => {
  it('fails a stack that passes pooled but fails on code-mixed traffic', () => {
    // Code-mixing is the linguistic reality of Indian recruitment calls, so
    // pooling alone would hide the strongest reason to run this benchmark.
    const result = evaluate({
      stages: { total_turn: dist(800, 1200) },
      accuracy: accuracy({ entityAccuracy: 0.91 }),
      hinglishAccuracy: accuracy({ entityAccuracy: 0.78 }),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.join(' ')).toMatch(/Hinglish entity accuracy/);
  });

  it('passes when the code-mixed subset clears its own bar', () => {
    const result = evaluate({
      stages: { total_turn: dist(800, 1200) },
      accuracy: accuracy({ entityAccuracy: 0.93 }),
      hinglishAccuracy: accuracy({ entityAccuracy: HINGLISH_MIN_ENTITY_ACCURACY }),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('PASS');
  });

  it('refuses to pass at all when no code-mixed subset exists', () => {
    // This used to be a warning, which by construction could not change the
    // verdict — so a run that never tested the linguistic reality of these
    // calls could still be reported as a PASS. Every other missing measurement
    // is INCOMPLETE; this one is now too.
    const result = evaluate({
      stages: { total_turn: dist(800, 1200) },
      accuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.incompleteReasons.join(' ')).toMatch(/code-mixed/);
  });
});

describe('a missing measurement can never silently pass a gate', () => {
  it('is INCOMPLETE when entity accuracy was not measured', () => {
    const result = evaluate({
      stages: { total_turn: dist(500, 800) },
      accuracy: { wer: 0.1, cer: 0.05, substitutions: 0, deletions: 0, insertions: 0, referenceWords: 50 },
      hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.incompleteReasons.join(' ')).toMatch(/entity accuracy/i);
  });

  it('is INCOMPLETE when the headline stage has no samples', () => {
    const result = evaluate({
      stages: {}, accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('INCOMPLETE');
  });

  it('is INCOMPLETE below the minimum sample count', () => {
    const result = evaluate({
      stages: { total_turn: dist(500, 800, 5) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 5, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.incompleteReasons[0]).toContain(String(MIN_SAMPLES_FOR_VERDICT));
  });

  it('still FAILS an under-sampled run whose measured samples already breach', () => {
    // More data cannot un-happen a breach.
    const result = evaluate({
      stages: { total_turn: dist(3000, 4000, 5) },
      sampleCount: 5, hardFailureCount: 0,
      thresholds: { totalTurnP50Ms: 1200, totalTurnP95Ms: 2000 },
    });
    expect(result.verdict).toBe('FAIL');
  });

  it('surfaces confidently-wrong facts as a warning even when accuracy passes', () => {
    const result = evaluate({
      stages: { total_turn: dist(800, 1200) },
      accuracy: accuracy({ entityAccuracy: 0.95, entitiesWrong: 3 }),
      hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0, thresholds: PHASE_5C_THRESHOLDS,
    });
    expect(result.warnings.join(' ')).toMatch(/CONFIDENTLY WRONG/);
  });
});

describe('component runs gate on their own stage', () => {
  it('applies the STT headline to the stt distribution', () => {
    const result = evaluate({
      stages: { stt: dist(200, 400) },
      accuracy: accuracy(), hinglishAccuracy: accuracy(),
      sampleCount: 30, hardFailureCount: 0,
      thresholds: PHASE_5C_THRESHOLDS, headlineStage: 'stt',
    });
    // No total_turn exists in a component run, and that must not make it fail.
    expect(result.verdict).toBe('PASS');
  });
});

describe('latency primitives', () => {
  it('uses nearest-rank percentiles, never interpolating', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
  });

  it('summarises a distribution', () => {
    expect(distribution([5, 1, 3, 2, 4])).toMatchObject({ count: 5, p50: 3, min: 1, max: 5 });
  });

  it('excludes failed turns from latency and counts them', () => {
    const good = { turnIndex: 0, speechEndedAt: 0, audioOutAt: 500 };
    const quickFailure = {
      turnIndex: 1, speechEndedAt: 0, audioOutAt: 10,
      failed: { stage: 'stt' as const, reason: 'boom' },
    };
    const result = aggregate([good, good, quickFailure]);
    // Including it would make the provider look twice as fast.
    expect(result.stages.total_turn?.p50).toBe(500);
    expect(result.failedTurnCount).toBe(1);
  });

  it('attributes TTS correctly in a NON-streaming pipeline', () => {
    let t = 0;
    const clock = () => t;
    const recorder = createTurnRecorder(0, clock);
    recorder.mark('speechEndedAt');
    t += 180; recorder.mark('sttFinalAt');
    t += 420; recorder.mark('llmFirstTokenAt');
    t += 300; recorder.mark('llmCompleteAt');
    t += 150; recorder.mark('ttsFirstByteAt');
    t += 30; recorder.mark('audioOutAt');

    const d = stageDurations(recorder.timeline());
    // Measured from llmCompleteAt: TTS is not charged for generation time.
    expect(d.tts_first_byte).toBe(150);
    expect(d.total_turn).toBe(1080);
  });

  it('attributes TTS correctly in a STREAMING pipeline', () => {
    let t = 0;
    const clock = () => t;
    const recorder = createTurnRecorder(0, clock);
    recorder.mark('speechEndedAt');
    t += 180; recorder.mark('sttFinalAt');
    t += 420; recorder.mark('llmFirstTokenAt');
    t += 150; recorder.mark('ttsFirstByteAt');   // synthesis starts on first token
    t += 30; recorder.mark('audioOutAt');
    t += 600; recorder.mark('llmCompleteAt');    // completion lands afterwards

    const d = stageDurations(recorder.timeline());
    // Measuring from llmCompleteAt here would give a negative number.
    expect(d.tts_first_byte).toBe(150);
    expect(d.total_turn).toBe(780);
  });

  it('leaves a stage undefined rather than zero when a mark is missing', () => {
    const recorder = createTurnRecorder(0, () => 0);
    recorder.mark('speechEndedAt');
    const d = stageDurations(recorder.timeline());
    expect(d.stt).toBeUndefined();
    expect(d.total_turn).toBeUndefined();
  });
});
