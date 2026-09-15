/**
 * Accuracy tests, with the numeric-entity regressions named explicitly.
 *
 * The substring defect — where "19 years" satisfied an expectation of
 * "9 years" — is the most consequential bug found in this harness, because it
 * inflated exactly the metric the TTS/STT decision gates on, and inflated it
 * most for the providers that make the error. Every teens-for-units pair the
 * brief lists is now a named test.
 */

import { describe, expect, it } from 'vitest';
import {
  combineAccuracy, scoreEntities, scoreEntity, scoreTranscript, tokenise,
} from '../src/measure/accuracy.js';
import type { EntityExpectationInput } from '../src/corpus/manifest.js';

const numeric = (name: string, accept: string[], unit: string): EntityExpectationInput => ({
  name, kind: 'number', accept, unit,
});

describe('word error rate reflects Indian English reality', () => {
  it('does not penalise numeral vs spoken-digit form', () => {
    expect(scoreTranscript('I have nine years of experience', 'I have 9 years of experience').wer).toBe(0);
  });

  it('does penalise a wrong number', () => {
    const score = scoreTranscript(
      'my notice period is ninety days',
      'my notice period is nineteen days',
    );
    expect(score.wer).toBeGreaterThan(0);
    expect(score.substitutions).toBe(1);
  });

  it('counts substitutions, deletions and insertions separately', () => {
    const score = scoreTranscript('one two three four', 'one five three four extra');
    expect(score.substitutions).toBe(1);
    expect(score.insertions).toBe(1);
    expect(score.deletions).toBe(0);
  });

  it('keeps Devanagari rather than scoring Hindi as empty', () => {
    expect(tokenise('मेरा नोटिस पीरियड तीस दिन है').length).toBeGreaterThan(3);
    expect(scoreTranscript('मेरा नोटिस पीरियड', 'मेरा नोटिस पीरियड').wer).toBe(0);
  });

  it('applies caller-supplied aliases to both sides identically', () => {
    const options = { aliases: { naukri: 'job', naukari: 'job' } };
    expect(scoreTranscript('naukri change', 'naukari change', options).wer).toBe(0);
  });

  it('does not report a perfect score for a hallucination against an empty reference', () => {
    expect(scoreTranscript('', '').wer).toBe(0);
    expect(scoreTranscript('', 'the model invented this').wer).toBe(1);
  });

  it('weights combined WER by reference length', () => {
    const short = scoreTranscript('yes', 'no');
    const long = scoreTranscript(
      'i worked at a product company for six years building backend systems in java',
      'i worked at a product company for six years building backend systems in java',
    );
    // Naive averaging gives ~0.5; length weighting gives ~1/14.
    expect(combineAccuracy([short, long])?.wer).toBeLessThan(0.1);
  });
});

describe('REGRESSION: teens never satisfy units', () => {
  // Every pair the brief names. Each was a false "found" before the fix.
  const cases: [string, string, string, string][] = [
    ['9 vs 19', 'nine years', 'I have nineteen years of experience', 'years'],
    ['8 vs 18', 'eight years', 'I have eighteen years of experience', 'years'],
    ['4 vs 14', 'four years', 'I have fourteen years of experience', 'years'],
    ['3 vs 13', 'three months', 'my notice is thirteen months', 'months'],
    ['5 vs 15', 'five lakhs', 'my ctc is fifteen lakhs', 'lakhs'],
    ['2 vs 12', 'two days', 'I need twelve days', 'days'],
  ];

  it.each(cases)('%s — the teen does not count as a capture', (_label, accept, heard, unit) => {
    const result = scoreEntity(heard, numeric('fact', [accept], unit));
    expect(result.outcome).not.toBe('found');
  });

  it.each(cases)('%s — the teen is scored WRONG, not missing', (_label, accept, heard, unit) => {
    // A wrong fact silently rejects a candidate; a missing one makes the agent
    // re-ask. Collapsing them would understate the harm the gate bounds.
    const result = scoreEntity(heard, numeric('fact', [accept], unit));
    expect(result.outcome).toBe('wrong');
    expect(result.heard).toBeTruthy();
  });

  it('still accepts the genuine value in both numeral and spoken form', () => {
    const expectation = numeric('experience', ['nine years', '9 years'], 'years');
    expect(scoreEntity('I have 9 years of experience', expectation).outcome).toBe('found');
    expect(scoreEntity('I have nine years of experience', expectation).outcome).toBe('found');
  });

  it('distinguishes an absent fact from a wrong one', () => {
    const expectation = numeric('experience', ['nine years'], 'years');
    expect(scoreEntity('I would rather not say', expectation).outcome).toBe('missing');
  });
});

describe('entity kinds are matched the way each kind needs', () => {
  it('phone numbers compare digits, ignoring separators', () => {
    const phone: EntityExpectationInput = {
      name: 'mobile', kind: 'phone', accept: ['98765 43210'],
    };
    expect(scoreEntity('my number is 9876543210', phone).outcome).toBe('found');
    expect(scoreEntity('my number is 98765-43210', phone).outcome).toBe('found');
    // A different number of the right shape is confidently wrong, not missing.
    expect(scoreEntity('my number is 9123456780', phone).outcome).toBe('wrong');
  });

  it('names tolerate transliteration variance', () => {
    const name: EntityExpectationInput = {
      name: 'candidate', kind: 'name', accept: ['Rajeshwari'],
    };
    expect(scoreEntity('speaking with Rajeshwari', name).outcome).toBe('found');
    expect(scoreEntity('speaking with Rajeshwary', name).outcome).toBe('found');
    expect(scoreEntity('speaking with Priyanka', name).outcome).toBe('missing');
  });

  it('dates match as whole token runs', () => {
    const date: EntityExpectationInput = {
      name: 'interview', kind: 'date', accept: ['14th october', '14 october'],
    };
    expect(scoreEntity('the interview is on 14th October', date).outcome).toBe('found');
    expect(scoreEntity('the interview is on 4th October', date).outcome).toBe('missing');
  });

  it('locations match as whole token runs', () => {
    const location: EntityExpectationInput = {
      name: 'city', kind: 'location', accept: ['bengaluru', 'bangalore'],
    };
    expect(scoreEntity('I am based in Bangalore', location).outcome).toBe('found');
    expect(scoreEntity('I am based in Mangalore', location).outcome).toBe('missing');
  });

  it('money respects boundaries and reports a wrong figure', () => {
    const money: EntityExpectationInput = {
      name: 'ctc', kind: 'money', accept: ['12 lakhs'], unit: 'lakhs',
    };
    expect(scoreEntity('my ctc is 12 lakhs', money).outcome).toBe('found');
    const wrong = scoreEntity('my ctc is 112 lakhs', money);
    expect(wrong.outcome).toBe('wrong');
    expect(wrong.heard).toContain('112');
  });

  it('handles negation, which an accept-list cannot express', () => {
    // "I cannot relocate" contains "relocate" — the accept list alone would
    // score the opposite of what the candidate said.
    const relocation: EntityExpectationInput = {
      name: 'relocation', kind: 'text',
      accept: ['can relocate', 'willing to relocate'],
      reject: ['cannot relocate', 'not willing to relocate'],
    };
    expect(scoreEntity('yes I can relocate', relocation).outcome).toBe('found');
    expect(scoreEntity('I cannot relocate', relocation).outcome).toBe('wrong');
  });
});

describe('entity accuracy is the screening-usability gate', () => {
  const entities: EntityExpectationInput[] = [
    { name: 'notice', kind: 'duration', accept: ['ninety days', '90 days', '3 months'], unit: 'days' },
    { name: 'experience', kind: 'number', accept: ['nine years', '9 years'], unit: 'years' },
  ];

  it('finds facts across accepted surface forms', () => {
    const score = scoreEntities(
      'I have 9 years of experience and my notice period is 3 months', entities,
    );
    expect(score.accuracy).toBe(1);
    expect(score.found).toBe(2);
  });

  it('names what was missed, so a failure is actionable', () => {
    const score = scoreEntities('I have 9 years of experience', entities);
    expect(score.accuracy).toBe(0.5);
    expect(score.results.find((r) => r.name === 'notice')?.outcome).toBe('missing');
  });

  it('can be high while WER is poor — which is the point of having both', () => {
    const score = scoreTranscript(
      'uh so basically my notice period is ninety days you know',
      'my notice period is 90 days',
      {},
      [entities[0] as EntityExpectationInput],
    );
    expect(score.wer).toBeGreaterThan(0.3);
    expect(score.entityAccuracy).toBe(1);
  });

  it('carries the wrong-fact count into the combined score', () => {
    const a = scoreTranscript('x', 'my notice is 19 days', {}, [
      { name: 'notice', kind: 'duration', accept: ['9 days'], unit: 'days' },
    ]);
    const combined = combineAccuracy([a]);
    expect(combined?.entitiesWrong).toBe(1);
    expect(combined?.entitiesFound).toBe(0);
  });
});
