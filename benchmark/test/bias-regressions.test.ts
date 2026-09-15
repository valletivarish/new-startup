/**
 * Regression tests for the bias review.
 *
 * Every test here names a defect that was CONFIRMED by an adversarial verifier
 * who reproduced it against this code. They are grouped by the bias category
 * the brief asked to be hunted, because that is how a future reader will want
 * to check whether a change reopened one.
 *
 * None of them contacts a provider.
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  chooseReference, detectScript, scoreAgainstBestReference, scoreEntity, scoreTranscript, tokenise,
} from '../src/measure/accuracy.js';
import { ADAPTER_DEFECT, ResponseShapeError, classify } from '../src/measure/failures.js';
import { evaluate, TTS_THRESHOLDS } from '../src/measure/verdict.js';
import { firstSentenceEnd, runLlmTurn } from '../src/runner/llm-runner.js';
import { runE2eConversation, type E2eTurnCase } from '../src/runner/e2e-runner.js';
import { aggregateStt } from '../src/results/aggregate.js';
import { runSttCase } from '../src/runner/stt-runner.js';
import { estimateCost, parseRateCard } from '../src/cost/rates.js';
import { RunStore, type RunMetadata } from '../src/results/store.js';
import { redact } from '../src/adapters/http.js';
import { requireConsentFor } from '../src/runner/sweep.js';
import { TTS_ADAPTERS } from '../src/adapters/registry.js';
import {
  createFakeClock, streamingLlmFake, streamingSttFake, streamingTtsFake,
} from '../src/adapters/fakes.js';
import type { BenchmarkLlmAdapter, BenchmarkSttAdapter } from '../src/adapters/types.js';

// ---------------------------------------------------------------------------
// accuracy scoring bias
// ---------------------------------------------------------------------------

describe('a cross-alphabet comparison is unscoreable, not a provider failure', () => {
  const reference = 'meri current ctc twelve lakhs hai';

  it('detects the script of a transcript', () => {
    expect(detectScript(reference)).toBe('latin');
    expect(detectScript('मेरी सीटीसी बारह लाख है')).toBe('devanagari');
    expect(detectScript('meri ctc बारह लाख hai')).toBe('mixed');
  });

  it('refuses to score Devanagari against a romanised reference', () => {
    // MEASURED before the fix: a FLAWLESS Devanagari transcription scored 125%
    // word error and 0% entity accuracy against this romanised reference —
    // triple-FAILing a provider for our language configuration and the corpus's
    // choice of alphabet.
    const result = scoreAgainstBestReference([reference], 'मेरी सीटीसी बारह लाख है');
    expect(result).toHaveProperty('unscoreable', true);
  });

  it('scores against the alternate reference when the corpus supplies one', () => {
    const result = scoreAgainstBestReference(
      [reference, 'मेरी सीटीसी बारह लाख है'],
      'मेरी सीटीसी बारह लाख है',
    );
    expect(result).not.toHaveProperty('unscoreable');
    expect((result as { wer: number }).wer).toBe(0);
  });

  it('picks the reference sharing the transcript\'s alphabet', () => {
    const refs = [reference, 'मेरी सीटीसी बारह लाख है'];
    expect(chooseReference(refs, 'meri ctc twelve lakhs hai')?.index).toBe(0);
    expect(chooseReference(refs, 'मेरी सीटीसी बारह लाख है')?.index).toBe(1);
  });

  it('excludes an unscoreable sample from accuracy instead of counting it against the provider', async () => {
    const clock = createFakeClock();
    const devanagariOnly: BenchmarkSttAdapter = {
      identity: { id: 'dev', displayName: 'D', adapterVersion: '0', model: 'm', unverified: false },
      inputFormat: { encoding: 'pcm16', sampleRate: 8000, channels: 1 },
      streaming: true,
      languageFor: (l) => l,
      async *transcribe(request) {
        for await (const _ of request.audio) { /* drain */ }
        clock.advance(120);
        yield { isFinal: true, text: 'मेरी सीटीसी बारह लाख है' };
      },
    };
    const result = await runSttCase(
      {
        utteranceId: 'u1', samples: new Int16Array(1600), sampleRate: 8000,
        language: 'hinglish', reference, entities: [], codeMixed: true,
      },
      { adapter: devanagariOnly, maxRetries: 0, clock: clock.now, sleep: async (ms) => clock.advance(ms) },
    );
    expect(result.unscoreable).toBeTruthy();
    expect(result.accuracy).toBeUndefined();
    const summary = aggregateStt([result]);
    expect(summary.unscoreableCount).toBe(1);
    expect(summary.accuracy).toBeUndefined();
  });
});

describe('Devanagari survives tokenisation', () => {
  it('keeps combining marks, so Hindi words are not shredded into consonants', () => {
    // Devanagari vowel signs are MARKS, not letters. A character class of
    // \p{L}\p{N} alone stripped every matra and turned "मेरा" into "म","र".
    // Every Hindi and Hinglish transcript was reduced to bare consonants — and
    // the tests missed it because they compared two identically-shredded
    // strings and got a word error rate of zero.
    expect(tokenise('मेरा नाम कविता है')).toEqual(['मेरा', 'नाम', 'कविता', 'है']);
  });

  it('folds Devanagari number words, so a Hindi phone number can be scored', () => {
    expect(tokenise('नौ आठ सात छह पांच')).toEqual(['9', '8', '7', '6', '5']);
    const found = scoreEntity(
      'मेरा नंबर नौ आठ सात छह पांच चार तीन दो एक शून्य है',
      { name: 'p', kind: 'phone', accept: ['9876543210'] } as never,
    );
    expect(found.outcome).toBe('found');
  });

  it('folds Devanagari lakh figures the same way as romanised ones', () => {
    expect(tokenise('बारह लाख')).toEqual(['1200000']);
    expect(scoreTranscript('मेरी सीटीसी बारह लाख है', 'मेरी सीटीसी 1200000 है').wer).toBe(0);
  });

  it('still distinguishes a wrong Hindi word from a right one', () => {
    // The shredding bug hid because identical inputs shred identically. This
    // asserts the scorer can still tell two DIFFERENT Hindi sentences apart.
    expect(scoreTranscript('मेरा नोटिस पीरियड नब्बे दिन है', 'मेरा नोटिस पीरियड नब्बे दिन है').wer).toBe(0);
    expect(scoreTranscript('मेरा नोटिस पीरियड नब्बे दिन है', 'मेरा नोटिस पीरियड साठ दिन है').wer)
      .toBeGreaterThan(0);
  });
});

describe('number normalisation does not invent errors', () => {
  it('does not multiply a decimal into nonsense', () => {
    // "1.2 lakh" became [1, 2, lakh] -> (1+2) x 100000 = 300000. A 2.5x error,
    // invented by the scorer, on the entity kind the money gate is about.
    expect(tokenise('my ctc is 1.2 lakh')).toContain('120000');
  });

  it('folds spoken compound numbers that carry no multiplier', () => {
    expect(scoreTranscript('I have twenty two years', 'I have 22 years').wer).toBe(0);
  });

  it('still leaves a time alone', () => {
    expect(tokenise('at 3 30')).toEqual(['at', '3', '30']);
  });

  it('reads "oh" as zero in a phone read-back', () => {
    const expectation = { name: 'phone', kind: 'phone', accept: ['9876504321'] } as never;
    expect(scoreEntity('nine eight seven six five oh four three two one', expectation).outcome)
      .toBe('found');
  });
});

describe('failing an utterance outright does not score better than transcribing it badly', () => {
  it('counts a failed utterance\'s entities as missing', async () => {
    const clock = createFakeClock();
    const failing: BenchmarkSttAdapter = {
      identity: { id: 'f', displayName: 'F', adapterVersion: '0', model: 'm', unverified: false },
      inputFormat: { encoding: 'pcm16', sampleRate: 8000, channels: 1 },
      streaming: true,
      languageFor: (l) => l,
      // eslint-disable-next-line require-yield
      async *transcribe() { throw new Error('provider exploded'); },
    };
    const result = await runSttCase(
      {
        utteranceId: 'u1', samples: new Int16Array(1600), sampleRate: 8000,
        language: 'en-IN', reference: 'ninety days',
        entities: [{ name: 'notice', kind: 'duration', accept: ['ninety days'], unit: 'days' }] as never,
        codeMixed: false,
      },
      { adapter: failing, maxRetries: 0, clock: clock.now, sleep: async () => { /* instant */ } },
    );
    const summary = aggregateStt([result]);
    // Before: the failed utterance vanished from the denominator entirely, so
    // failing scored strictly better than a bad transcription.
    expect(summary.accuracy?.entitiesExpected).toBe(1);
    expect(summary.accuracy?.entityAccuracy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// provider attribution bias
// ---------------------------------------------------------------------------

describe('a response we could not parse is OUR defect', () => {
  it('classifies a 200 with an unexpected shape as an adapter defect', () => {
    const error = new ResponseShapeError('X', 'a transcript field', '{"text":"hello"}');
    expect(classify(error)).toBe('response_shape_unrecognised');
    expect(ADAPTER_DEFECT.has(classify(error))).toBe(true);
  });

  it('makes a run of them INCOMPLETE, never a FAIL against the provider', () => {
    // With maxHardFailures at 1, TWO mis-parsed responses used to print a red
    // FAIL for a provider that had answered every question correctly.
    const result = evaluate({
      stages: { tts_first_byte: { count: 30, p50: 150, p95: 250, min: 100, max: 300 } },
      sampleCount: 30, hardFailureCount: 30, adapterDefectCount: 30,
      thresholds: TTS_THRESHOLDS, headlineStage: 'tts_first_byte',
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.failures).toEqual([]);
  });
});

describe('a buffered adapter is not ranked against a streaming gate', () => {
  it('reports INCOMPLETE rather than passing or failing a full-synthesis figure', () => {
    const result = evaluate({
      stages: { tts_first_byte: { count: 30, p50: 900, p95: 1200, min: 800, max: 1400 } },
      sampleCount: 30, hardFailureCount: 0,
      headlineComparable: false,
      headlineIncomparableReason: 'This adapter buffers the whole response.',
      thresholds: TTS_THRESHOLDS, headlineStage: 'tts_first_byte',
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.failures).toEqual([]);
    expect(result.incompleteReasons.join(' ')).toMatch(/buffers the whole response/);
  });

  it('still gates an adapter whose figure IS comparable', () => {
    const result = evaluate({
      stages: { tts_first_byte: { count: 30, p50: 900, p95: 1200, min: 800, max: 1400 } },
      sampleCount: 30, hardFailureCount: 0,
      headlineComparable: true,
      thresholds: TTS_THRESHOLDS, headlineStage: 'tts_first_byte',
    });
    expect(result.verdict).toBe('FAIL');
  });
});

describe('every TTS adapter is asked for the same audio format', () => {
  it('so nothing has to be resampled to be heard beside its peers', () => {
    // Levelling to the lowest rate present does not remove a fidelity bias, it
    // REVERSES it: our linear resampler adds artefacts a natively-8 kHz
    // provider never suffers. The fix is at the request, not the playback.
    const formats = Object.values(TTS_ADAPTERS).map((f) => f().outputFormat);
    expect(new Set(formats.map((f) => f.sampleRate)).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// latency measurement bias
// ---------------------------------------------------------------------------

describe('the end-to-end pipeline is streaming, not serial', () => {
  it('starts synthesis at the first sentence rather than after the whole reply', async () => {
    const clock = createFakeClock();
    const turn: E2eTurnCase = {
      utteranceId: 'u1', conversationId: 'c1', turnIndex: 0,
      samples: new Int16Array(3200), sampleRate: 8000, language: 'en-IN',
      reference: 'hello', entities: [], codeMixed: false,
    };
    const results = await runE2eConversation([turn], {
      stt: streamingSttFake({ clock, segments: ['hello'], residualMs: 100, interimAfterMs: 0 }),
      // 20 words after the first sentence: a serial pipeline would charge the
      // turn for all of it before synthesis could begin.
      llm: streamingLlmFake({
        clock, firstTokenMs: 100, perTokenMs: 20,
        reply: 'What is your notice period? I also need to know your expected salary and your current location and your joining date please.',
      }),
      tts: streamingTtsFake({ clock, firstByteMs: 80 }),
      maxRetries: 0, clock: clock.now,
      sleep: async (ms) => clock.advance(ms), retrySleep: async () => { /* instant */ },
    });
    const durations = results[0]?.durations as Record<string, number>;
    // Synthesis began at the first sentence, so the total does not include the
    // remaining ~20 words of generation.
    expect(durations['total_turn']).toBeLessThan(durations['llm_complete'] as number + 80);
    // And only the sentence that was sent is counted as billed characters.
    expect(results[0]?.replyCharacters).toBeLessThan(results[0]?.replyLength as number);
  });

  it('finds a sentence boundary without splitting a decimal', () => {
    expect(firstSentenceEnd('Your CTC is 12.5 lakhs and')).toBeUndefined();
    // Index just past the '?', so slicing to it keeps the whole question.
    expect(firstSentenceEnd('What is your notice period? And your')).toBe(27);
    expect('What is your notice period? And your'.slice(0, 27).trim())
      .toBe('What is your notice period?');
  });
});

describe('a whitespace-only chunk is not a token', () => {
  it('does not credit the provider with a token it did not produce', async () => {
    const clock = createFakeClock();
    const leadingSpace: BenchmarkLlmAdapter = {
      identity: { id: 'l', displayName: 'L', adapterVersion: '0', model: 'm', unverified: false },
      streaming: true,
      async *complete() {
        yield { text: ' ' };
        clock.advance(200);
        yield { text: 'Hello.' };
      },
    };
    const result = await runLlmTurn([{ role: 'user', content: 'hi' }], {
      adapter: leadingSpace, maxRetries: 0, clock: clock.now,
      retrySleep: async () => { /* instant */ },
    });
    expect(result.firstTokenAt).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// cost accounting
// ---------------------------------------------------------------------------

describe('cost estimation', () => {
  const card = parseRateCard({
    version: 't', usdToInr: { rate: 90, source: 'OFFICIAL', verifiedOn: '2026-08-24' },
    rates: {
      'a.stt': {
        unit: 'per_audio_hour', amount: 100, currency: 'INR', source: 'OFFICIAL',
        url: 'u', verifiedOn: '2026-08-24', freeAllowance: 1, freeAllowancePeriod: 'per_month',
      },
      'a.stt.hinglish': {
        unit: 'per_audio_hour', amount: 200, currency: 'INR', source: 'OFFICIAL',
        url: 'u', verifiedOn: '2026-08-24',
      },
    },
  });

  it('applies a free allowance once across the estimate, not once per line', () => {
    // Subtracting it inside the per-line loop gave a provider used by three
    // runs its monthly allowance three times.
    const estimate = estimateCost(
      [
        { runId: 'r1', key: 'a.stt', audioSeconds: 3600, characters: 0 },
        { runId: 'r2', key: 'a.stt', audioSeconds: 3600, characters: 0 },
      ],
      card,
    );
    // Two hours, one free: exactly one hour billed.
    expect(estimate.pricedInr).toBeCloseTo(100, 5);
  });

  it('prices a language variant at its own rate when one exists', () => {
    const estimate = estimateCost(
      [{ runId: 'r1', key: 'a.stt.hinglish', audioSeconds: 3600, characters: 0 }],
      card,
    );
    expect(estimate.pricedInr).toBeCloseTo(200, 5);
  });

  it('falls back to the base rate and SAYS so', () => {
    const estimate = estimateCost(
      [{ runId: 'r1', key: 'a.stt.en-IN', audioSeconds: 3600, characters: 0 }],
      card,
    );
    expect(estimate.warnings.join(' ')).toMatch(/priced with the base rate/);
  });
});

// ---------------------------------------------------------------------------
// credential leakage and cross-border data
// ---------------------------------------------------------------------------

describe('credentials never reach disk', () => {
  it('redacts metadata.json, which carries adapter parameters read from the environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-meta-'));
    const metadata = {
      runId: 'r', benchmarkVersion: 'v', profile: 'p', startedAt: 'now',
      corpus: { manifestPath: 'm', corpusVersion: 'c', utteranceCount: 0, condition: 'clean_16k', inputChecksums: {} },
      subject: {
        kind: 'stt', adapterId: 'a', adapterVersion: '0', model: 'm',
        unverified: true, streaming: false,
        parameters: { voice: 'sk-live-abcdef1234567890' },
      },
      configuration: { maxRetries: 0, concurrency: 1, maxCalls: 1, drainTts: false, seed: 1 },
      environment: { node: 'v', platform: 'p', arch: 'a', gitCommit: null, gitDirty: null, ffmpeg: null, host: 'h' },
    } as RunMetadata;
    const store = new RunStore(root, metadata);
    await store.open();
    const written = await readFile(join(root, 'r', 'metadata.json'), 'utf8');
    expect(written).not.toContain('sk-live-abcdef1234567890');
  });

  it('redacts a credential named in prose, not only as key: value', () => {
    expect(redact('your api key abcdef1234567890 is invalid')).not.toContain('abcdef1234567890');
    expect(redact('subscription key: abcdef1234567890')).not.toContain('abcdef1234567890');
  });
});

describe('a run cannot contact a processor the speakers were not told about', () => {
  async function manifestWith(processors: readonly string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bench-consent-'));
    await mkdir(join(dir, 'audio'), { recursive: true });
    const path = join(dir, 'manifest.json');
    await writeFile(path, JSON.stringify({
      corpusVersion: 'c1',
      audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      consent: [{
        speakerId: 's1', obtainedAt: '2026-08-01', coversCrossBorderTransfer: true,
        disclosedProcessors: [...processors], retentionUntil: '2027-08-01',
        deletionContact: 'x@example.test',
      }],
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN',
        reference: 'hello', speakerId: 's1',
      }],
    }), 'utf8');
    return path;
  }

  it('refuses an undisclosed provider', async () => {
    const path = await manifestWith(['azure — Microsoft, Central India']);
    await expect(requireConsentFor(path, ['deepgram'])).rejects.toThrow(/Consent does not cover/);
  });

  it('allows one every speaker was told about', async () => {
    const path = await manifestWith(['deepgram — Deepgram, United States']);
    await expect(requireConsentFor(path, ['deepgram'])).resolves.toBeUndefined();
  });

  it('does not let a longer id satisfy a shorter one', async () => {
    // "fake-stt (test)" must not silently cover an adapter called "fake".
    const path = await manifestWith(['fake-stt — local']);
    await expect(requireConsentFor(path, ['fake'])).rejects.toThrow(/Consent does not cover/);
  });
});
