/**
 * Regression tests for defects found by adversarial review of this harness.
 *
 * Every test here names a defect that existed, passed the previous suite, and
 * would have produced a confidently wrong provider decision. They are grouped by
 * what the defect would have cost, because that is the only ranking that matters
 * when deciding what to keep testing.
 */

import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluate, componentGate, MIN_SAMPLES_FOR_VERDICT,
  PHASE_5C_THRESHOLDS, STT_THRESHOLDS, TTS_THRESHOLDS,
} from '../src/measure/verdict.js';
import { classify, withRetries } from '../src/measure/failures.js';
import { HttpError, streamBody } from '../src/adapters/http.js';
import { MissingCredentialsError } from '../src/adapters/types.js';
import { REQUIRED_ENV, OPTIONAL_ENV, STT_ADAPTERS, TTS_ADAPTERS } from '../src/adapters/registry.js';
import { scoreEntity, scoreTranscript, tokenise } from '../src/measure/accuracy.js';
import { framePcm, paceFrames } from '../src/runner/pacing.js';
import { runSttCase } from '../src/runner/stt-runner.js';
import { runTtsCase } from '../src/runner/tts-runner.js';
import { planSweep } from '../src/runner/plan.js';
import { aggregateStt } from '../src/results/aggregate.js';
import { QUALITY_LINES } from '../src/quality/lines.js';
import { writeBlindPack } from '../src/quality/blind.js';
import { COMMANDS, help, KNOWN_FLAGS, numericFlag, parseArgs } from '../src/cli.js';
import { runTtsSweep } from '../src/runner/sweep.js';
import { streamingTtsFake, createFakeClock } from '../src/adapters/fakes.js';
import { RunStore, type RunMetadata } from '../src/results/store.js';
import type { BenchmarkSttAdapter, BenchmarkTtsAdapter } from '../src/adapters/types.js';

const dist = (p50: number, p95: number, count = 30) => ({ count, p50, p95, min: p50, max: p95 });
const cleanAccuracy = () =>
  ({
    wer: 0.1, cer: 0.05, substitutions: 1, deletions: 0, insertions: 0, referenceWords: 100,
    entityAccuracy: 1, entitiesExpected: 20, entitiesFound: 20, entitiesWrong: 0,
  }) as never;

// ---------------------------------------------------------------------------
// The decision rule could not fail anything the CLI could run
// ---------------------------------------------------------------------------

describe('component runs are gated, not merely described', () => {
  it('FAILS a 5000 ms STT residual instead of filing an advisory warning', () => {
    const result = evaluate({
      stages: { stt: dist(5000, 9000) },
      accuracy: cleanAccuracy(),
      hinglishAccuracy: cleanAccuracy(),
      sampleCount: 30, hardFailureCount: 0,
      thresholds: STT_THRESHOLDS, headlineStage: 'stt',
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.join(' ')).toMatch(/component gate/);
  });

  it('FAILS a 2000 ms TTS time to first byte', () => {
    const result = evaluate({
      stages: { tts_first_byte: dist(2000, 3000) },
      sampleCount: 30, hardFailureCount: 0,
      thresholds: TTS_THRESHOLDS, headlineStage: 'tts_first_byte',
    });
    expect(result.verdict).toBe('FAIL');
  });

  it('passes a component inside its derived gate but over its design budget, with a warning', () => {
    // 350 ms is over the 300 ms attribution budget but under the 400 ms gate:
    // the turn still fits 1200 ms if the other stages hit theirs.
    const result = evaluate({
      stages: { stt: dist(350, 500) },
      accuracy: cleanAccuracy(),
      hinglishAccuracy: cleanAccuracy(),
      sampleCount: 30, hardFailureCount: 0,
      thresholds: STT_THRESHOLDS, headlineStage: 'stt',
    });
    expect(result.verdict).toBe('PASS');
    expect(result.warnings.join(' ')).toMatch(/design budget/);
  });

  it('derives the component gate from the total, never tighter than it', () => {
    const stt = componentGate('stt', PHASE_5C_THRESHOLDS);
    const tts = componentGate('tts_first_byte', PHASE_5C_THRESHOLDS);
    expect(stt?.p50).toBe(400);
    expect(tts?.p50).toBe(400);
    // The sum of the budgets plus the gated component must not exceed the total.
    expect((stt?.p50 ?? 0) + (stt?.others ?? 0)).toBe(PHASE_5C_THRESHOLDS.totalTurnP50Ms);
  });

  it('does not warn about stages a component run never measures', () => {
    const result = evaluate({
      stages: { stt: dist(200, 300) },
      accuracy: cleanAccuracy(), hinglishAccuracy: cleanAccuracy(),
      sampleCount: 30, hardFailureCount: 0,
      thresholds: STT_THRESHOLDS, headlineStage: 'stt',
    });
    expect(result.warnings.join(' ')).not.toMatch(/has no samples/);
  });
});

describe('a TTS run can actually reach a verdict', () => {
  it('does not demand a transcript from a run that has no transcript', () => {
    const result = evaluate({
      stages: { tts_first_byte: dist(150, 250) },
      sampleCount: 20, hardFailureCount: 0,
      thresholds: TTS_THRESHOLDS, headlineStage: 'tts_first_byte',
    });
    expect(result.incompleteReasons).toEqual([]);
    expect(result.verdict).toBe('PASS');
  });

  it('ships enough frozen lines to satisfy its own sample floor', () => {
    // The line set IS the TTS sample size. Ten lines against a floor of twenty
    // made every TTS run permanently INCOMPLETE, however much was spent.
    expect(QUALITY_LINES.length).toBeGreaterThanOrEqual(MIN_SAMPLES_FOR_VERDICT);
  });

  it('warns in the plan when the line set cannot reach the floor', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: [], ttsAdapters: ['a'],
      utterances: [], ttsLines: [{ id: 'x', text: 'hello' }],
      maxRetries: 2, maxCalls: 500, minSamplesForVerdict: MIN_SAMPLES_FOR_VERDICT,
    });
    expect(plan.warnings.join(' ')).toMatch(/INCOMPLETE no matter/);
  });
});

describe('a missing code-mixed subset is incomplete, not a shrug', () => {
  it('refuses to PASS an STT run that never tested Hinglish', () => {
    const result = evaluate({
      stages: { stt: dist(200, 300) },
      accuracy: cleanAccuracy(),
      sampleCount: 30, hardFailureCount: 0,
      thresholds: STT_THRESHOLDS, headlineStage: 'stt',
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.incompleteReasons.join(' ')).toMatch(/code-mixed/);
  });
});

// ---------------------------------------------------------------------------
// Our own bugs must not be recorded as the provider's
// ---------------------------------------------------------------------------

describe('adapter defects are not provider failures', () => {
  it('classifies a 400 with an audio-shaped body as OUR request error', () => {
    const error = new HttpError(400, 'Bad Request', '{"err_msg":"invalid audio format"}');
    expect(classify(error)).toBe('client_request_error');
  });

  it('classifies a missing credential as auth, so the sweep stops', () => {
    expect(classify(new MissingCredentialsError('x', ['X_KEY']))).toBe('auth');
  });

  it('does not let a 429 whose body mentions quota abort the sweep', () => {
    const error = new HttpError(429, 'Too Many Requests', 'you have exceeded your rate limit');
    expect(classify(error)).toBe('transient_transport');
  });

  it('makes a run of adapter defects INCOMPLETE rather than a FAIL against the provider', () => {
    const result = evaluate({
      stages: { tts_first_byte: dist(150, 250) },
      sampleCount: 20, hardFailureCount: 5, adapterDefectCount: 5,
      thresholds: TTS_THRESHOLDS, headlineStage: 'tts_first_byte',
    });
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.failures).toEqual([]);
  });

  it('declares every environment variable its adapters read', async () => {
    // The defect: CARTESIA_VOICE_ID was hard-required inside the adapter but
    // absent from REQUIRED_ENV, so the pre-flight passed and every line failed.
    const declared = new Set([...Object.values(REQUIRED_ENV).flat(), ...OPTIONAL_ENV]);
    const read = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.ts')) {
          const source = await readFile(full, 'utf8');
          for (const match of source.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
            read.add(match[1] as string);
          }
        }
      }
    };
    await walk(fileURLToPath(new URL('../src/adapters', import.meta.url)));
    expect([...read].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('names the same text normalisation for every STT adapter in the sweep', () => {
    // Asking one provider for inverse text normalisation and another for
    // verbatim compares request options, not providers — on a gate that can FAIL.
    const forms = new Set(
      Object.values(STT_ADAPTERS).map((factory) => factory().identity.textNormalisation),
    );
    expect(forms.size).toBe(1);
    expect([...forms][0]).toBe('verbatim');
  });

  it('has a TTS adapter for every id it claims', () => {
    expect(Object.keys(TTS_ADAPTERS).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The scorer must not reward a request shape
// ---------------------------------------------------------------------------

describe('number normalisation is two-way', () => {
  it('scores a numeral and its spoken form as identical', () => {
    const score = scoreTranscript(
      'my expected salary is one hundred twenty thousand rupees',
      'my expected salary is 120000 rupees',
    );
    expect(score.wer).toBe(0);
  });

  it('survives Indian digit grouping', () => {
    expect(scoreTranscript('my ctc is twelve lakhs', 'my ctc is 1,200,000').wer).toBe(0);
    expect(scoreTranscript('my ctc is twelve lakhs', 'my ctc is 12,00,000').wer).toBe(0);
  });

  it('still refuses to let "19 years" satisfy "9 years"', () => {
    const result = scoreEntity('I have 19 years of experience', {
      name: 'experience', kind: 'duration', accept: ['9 years'], unit: 'years',
    } as never);
    expect(result.outcome).toBe('wrong');
  });

  it('does not fold adjacent numbers that carry no multiplier', () => {
    // "3 30" is a time, not thirty-three. Folding everything would corrupt it.
    expect(tokenise('the interview is at 3 30')).toEqual(['the', 'interview', 'is', 'at', '3', '30']);
  });

  it('scores a spelled-out phone number the same as a numeric one', () => {
    const expectation = { name: 'phone', kind: 'phone', accept: ['98765 43210'] } as never;
    expect(scoreEntity('my number is 98765 43210', expectation).outcome).toBe('found');
    expect(
      scoreEntity('my number is nine eight seven six five four three two one zero', expectation)
        .outcome,
    ).toBe('found');
    expect(scoreEntity('my number is +91 9876543210', expectation).outcome).toBe('found');
  });

  it('does not let a longer digit string satisfy a shorter expectation', () => {
    const expectation = { name: 'phone', kind: 'phone', accept: ['9876543210'] } as never;
    expect(scoreEntity('reference 1298765432109', expectation).outcome).not.toBe('found');
  });
});

// ---------------------------------------------------------------------------
// The instrument must not hand a provider free time
// ---------------------------------------------------------------------------

describe('audio pacing is scheduled, not accumulated', () => {
  const paced = async (perFrameCostMs: number) => {
    let now = 0;
    const clock = () => now;
    const sleep = async (ms: number) => { now += ms; };
    const frames = framePcm(new Int16Array(8000), 8000); // 1000 ms, 50 frames
    let started = 0;
    let ended = 0;
    const stream = paceFrames(
      frames, () => 20, sleep,
      { onAudioStart: () => { started = now; }, onAudioEnd: () => { ended = now; } },
      clock,
    );
    for await (const _frame of stream) {
      now += perFrameCostMs; // the adapter's own consumption cost
    }
    return ended - started;
  };

  it('delivers one second of audio in one second regardless of consumer cost', async () => {
    const fast = await paced(0);
    const slow = await paced(3);
    expect(fast).toBeGreaterThanOrEqual(1000);
    expect(fast).toBeLessThan(1100);
    // Before the fix the slow consumer's timeline ran ~175 ms longer, handing it
    // that much free processing time against a 300 ms budget.
    expect(Math.abs(slow - fast)).toBeLessThan(60);
  });

  it('reports the endpoint even when the consumer abandons the audio', async () => {
    let ended: { delivered: number; total: number } | undefined;
    const frames = framePcm(new Int16Array(8000), 8000);
    const stream = paceFrames(
      frames, () => 20, async () => { /* no wait */ },
      { onAudioEnd: (delivered, total) => { ended = { delivered, total }; } },
    );
    for await (const _frame of stream) break;
    expect(ended?.delivered).toBe(1);
    expect(ended?.total).toBe(frames.length);
  });
});

describe('an adapter that abandons the audio is a failure, not a fast result', () => {
  it('records audio_not_consumed rather than reporting a tiny residual', async () => {
    const lazy: BenchmarkSttAdapter = {
      identity: {
        id: 'lazy', displayName: 'Lazy', adapterVersion: '0', model: 'm', unverified: false,
      },
      inputFormat: { encoding: 'pcm16', sampleRate: 8000, channels: 1 },
      streaming: true,
      languageFor: (language) => language,
      async *transcribe(request) {
        // Takes two frames and answers, never draining the utterance.
        let seen = 0;
        for await (const _chunk of request.audio) { if (++seen >= 2) break; }
        yield { isFinal: true, text: 'hello' };
      },
    };
    const result = await runSttCase(
      {
        utteranceId: 'u1', samples: new Int16Array(8000), sampleRate: 8000,
        language: 'en-IN', reference: 'hello', entities: [], codeMixed: false,
      },
      { adapter: lazy, maxRetries: 0, sleep: async () => { /* instant */ } },
    );
    expect(result.failure?.category).toBe('audio_not_consumed');
    // The endpoint mark it produced is meaningless — the utterance was truncated
    // — so the sample must never reach the distribution. It is a failure, and
    // failures are excluded from latency by construction.
    const summary = aggregateStt([result]);
    expect(summary.sampleCount).toBe(0);
    expect(summary.stages.stt).toBeUndefined();
    expect(summary.failures.failed).toBe(1);
  });
});

describe('retry accounting reaches the stored timeline', () => {
  it('records the retries that actually happened', async () => {
    let calls = 0;
    const flaky: BenchmarkTtsAdapter = {
      identity: { id: 'f', displayName: 'F', adapterVersion: '0', model: 'm', unverified: false },
      outputFormat: { encoding: 'pcm16', sampleRate: 8000, channels: 1 },
      streaming: true,
      languageFor: (language) => language,
      async *synthesize() {
        calls += 1;
        if (calls < 3) throw new HttpError(503, 'Service Unavailable', 'try later');
        const bytes = new Uint8Array(320);
        bytes.fill(64);
        yield { bytes };
      },
    };
    const result = await runTtsCase(
      { lineId: 'l1', text: 'hi', language: 'en-IN', codeMixed: false },
      { adapter: flaky, maxRetries: 3, retrySleep: async () => { /* instant */ } },
    );
    expect(result.attempts).toBe(3);
    expect(result.timeline.retries).toBe(2);
  });
});

describe('a zero-length chunk is not a first byte', () => {
  it('does not mark first byte for an empty chunk', async () => {
    const empties: BenchmarkTtsAdapter = {
      identity: { id: 'e', displayName: 'E', adapterVersion: '0', model: 'm', unverified: false },
      outputFormat: { encoding: 'pcm16', sampleRate: 8000, channels: 1 },
      streaming: true,
      languageFor: (language) => language,
      async *synthesize() {
        yield { bytes: new Uint8Array(0) };
        yield { bytes: new Uint8Array(0) };
      },
    };
    const result = await runTtsCase(
      { lineId: 'l1', text: 'hi', language: 'en-IN', codeMixed: false },
      { adapter: empties, maxRetries: 0, retrySleep: async () => { /* instant */ } },
    );
    expect(result.failure?.category).toBe('empty_response');
  });
});

// ---------------------------------------------------------------------------
// Cost control must mean what it says
// ---------------------------------------------------------------------------

describe('the CLI cannot silently overrule a budget', () => {
  it('understands --key=value', () => {
    expect(parseArgs(['run', '--max-calls=20']).args['max-calls']).toBe('20');
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    expect(() => parseArgs(['run', '--max-call', '20'])).toThrow(/Unknown flag/);
  });

  it('rejects a non-numeric budget instead of turning it into NaN', () => {
    expect(() => numericFlag({ 'max-calls': 'all' }, 'max-calls', 500)).toThrow(/must be a non-negative number/);
  });

  it('refuses a NaN retry budget rather than retrying forever', async () => {
    await expect(
      withRetries(async () => { throw new HttpError(429, 'Too Many', 'slow down'); }, {
        maxRetries: Number.NaN, provider: 'x', sleep: async () => { /* instant */ },
      }),
    ).rejects.toThrow(/non-negative finite/);
  });

  it('documents exactly the commands it can dispatch', () => {
    // `quality-pack` was in the help text and in no switch case, so the blind
    // listening gate could not be produced by any code path.
    for (const name of Object.keys(COMMANDS)) {
      expect(help()).toContain(name);
    }
    const commandBlock = help().slice(0, help().indexOf('Common flags'));
    for (const match of commandBlock.matchAll(/^ {2}([a-z-]+) {2,}\S/gm)) {
      expect(Object.keys(COMMANDS)).toContain(match[1]);
    }
  });

  it('lists every flag it accepts', () => {
    for (const flag of KNOWN_FLAGS) expect(help()).toContain(`--${flag}`);
  });
});

describe('the plan prices what will actually happen', () => {
  it('multiplies the metered units by the retry budget, not only the call count', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a'], ttsAdapters: ['b'],
      utterances: [{ id: 'u', durationMs: 10_000 }],
      ttsLines: [{ id: 'l', text: '0123456789' }],
      maxRetries: 2, maxCalls: 500,
    });
    expect(plan.worstCaseAudioSeconds).toBe(plan.totalAudioSeconds * 3);
    expect(plan.worstCaseCharacters).toBe(plan.totalCharacters * 3);
  });

  it('excludes a run no code path can execute', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a'], ttsAdapters: ['b'],
      endToEnd: { stt: 'a', tts: 'b' },
      utterances: [{ id: 'u', durationMs: 1000 }],
      ttsLines: [{ id: 'l', text: 'hi' }],
      maxRetries: 0, maxCalls: 500,
    });
    // 1 STT call + 1 TTS call. The e2e run is listed but not counted, because
    // no LLM adapter is registered until the founder confirms the model.
    expect(plan.totalCalls).toBe(2);
    expect(plan.runs.some((r) => !r.executable)).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/EXCLUDED from the totals/);
  });

  it('counts the end-to-end run once an LLM adapter is named', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a'], ttsAdapters: ['b'],
      endToEnd: { stt: 'a', tts: 'b', llm: 'c' },
      utterances: [{ id: 'u', durationMs: 1000 }],
      ttsLines: [{ id: 'l', text: 'hi' }],
      maxRetries: 0, maxCalls: 500,
    });
    // 1 STT + 1 TTS + 3 e2e calls (STT, LLM, TTS per turn).
    expect(plan.totalCalls).toBe(5);
    expect(plan.runs.every((r) => r.executable)).toBe(true);
  });

  it('plans only run kinds the CLI can dispatch, or marks them unexecutable', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a'], ttsAdapters: ['b'],
      endToEnd: { stt: 'a', tts: 'b' },
      utterances: [{ id: 'u', durationMs: 1000 }],
      ttsLines: [{ id: 'l', text: 'hi' }],
      maxRetries: 0, maxCalls: 500,
    });
    for (const run of plan.runs.filter((r) => r.executable)) {
      expect(['stt', 'tts']).toContain(run.kind);
    }
  });
});

// ---------------------------------------------------------------------------
// The wire, and the disk
// ---------------------------------------------------------------------------

describe('stopping at the first byte tears the request down', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  it('disconnects from a streaming response instead of leaking it', async () => {
    let clientLeft = false;
    server = createServer((_request, response) => {
      response.on('close', () => { if (!response.writableEnded) clientLeft = true; });
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.write(Buffer.alloc(320, 64));
      // Never ends: only a client-side cancel can finish this exchange.
    });
    await new Promise<void>((r) => server?.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/`);
    for await (const _chunk of streamBody(response)) break;

    await new Promise((r) => setTimeout(r, 100));
    expect(clientLeft).toBe(true);
  });
});

describe('run directories are never overwritten', () => {
  it('refuses a second run with the same id even without the existence check winning the race', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-store-'));
    const metadata = {
      runId: 'x', benchmarkVersion: 'test', profile: 'p', startedAt: 'now',
      corpus: { manifestPath: 'm', corpusVersion: 'c', utteranceCount: 0, condition: 'clean_16k', inputChecksums: {} },
      subject: { kind: 'stt', adapterId: 'a', adapterVersion: '0', model: 'm', unverified: false, streaming: false },
      configuration: { maxRetries: 0, concurrency: 1, maxCalls: 1, drainTts: false, seed: 1 },
      environment: { node: 'v', platform: 'p', arch: 'a', gitCommit: null, gitDirty: null, ffmpeg: null, host: 'h' },
    } as RunMetadata;

    // Pre-create the directory behind the check, exactly as a concurrent sweep would.
    await mkdir(join(root, 'x'), { recursive: true });
    await writeFile(join(root, 'x', 'raw.jsonl'), 'existing\n');
    const store = new RunStore(root, metadata);
    await expect(store.open()).rejects.toThrow(/never overwritten/);
    expect(await readFile(join(root, 'x', 'raw.jsonl'), 'utf8')).toBe('existing\n');
  });

  it('redacts metrics.json, not only raw.jsonl and errors.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-store-'));
    const metadata = {
      runId: 'y', benchmarkVersion: 'test', profile: 'p', startedAt: 'now',
      corpus: { manifestPath: 'm', corpusVersion: 'c', utteranceCount: 0, condition: 'clean_16k', inputChecksums: {} },
      subject: { kind: 'stt', adapterId: 'a', adapterVersion: '0', model: 'm', unverified: false, streaming: false },
      configuration: { maxRetries: 0, concurrency: 1, maxCalls: 1, drainTts: false, seed: 1 },
      environment: { node: 'v', platform: 'p', arch: 'a', gitCommit: null, gitDirty: null, ffmpeg: null, host: 'h' },
    } as RunMetadata;
    const store = new RunStore(root, metadata);
    await store.open();
    await store.metrics({ note: 'authorization: Bearer sk-live-abcdef123456' });
    const written = await readFile(join(root, 'y', 'metrics.json'), 'utf8');
    expect(written).not.toContain('sk-live-abcdef123456');
    expect(written).toContain('REDACTED');
  });
});

describe('the blind listening pack levels every provider to one sample rate', () => {
  it('resamples to the lowest rate present, so nobody is flattered by fidelity', async () => {
    // Providers do not document the same format matrix, so the adapters ask for
    // different rates. Presenting a 16 kHz sample beside an 8 kHz one lets a
    // listener prefer our request shape rather than the voice — and a candidate
    // on a PSTN call hears 8 kHz however good the synthesis was.
    const root = await mkdtemp(join(tmpdir(), 'bench-blind-'));
    const tone = (rate: 8000 | 16000) => {
      const samples = new Int16Array(rate / 10);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(8000 * Math.sin(i / 6));
      const bytes = new Uint8Array(samples.length * 2);
      for (let i = 0; i < samples.length; i += 1) {
        bytes[i * 2] = (samples[i] as number) & 0xff;
        bytes[i * 2 + 1] = ((samples[i] as number) >> 8) & 0xff;
      }
      return bytes;
    };
    const line = QUALITY_LINES[0] as { lineId: string };
    const { listenDir, blindSet } = await writeBlindPack(
      root,
      [
        { providerId: 'wide', lineId: line.lineId, audio: tone(16000), sampleRate: 16000 },
        { providerId: 'narrow', lineId: line.lineId, audio: tone(8000), sampleRate: 8000 },
      ],
      QUALITY_LINES,
      7,
    );
    expect(blindSet.presentationSampleRate).toBe(8000);
    for (const key of blindSet.order) {
      const wav = await readFile(join(listenDir, `${key}.wav`));
      // Byte 24..27 of a RIFF header is the sample rate, little-endian.
      expect(wav.readUInt32LE(24)).toBe(8000);
    }
  });
});

describe('a drained TTS run produces audio the listening gate can use', () => {
  it('writes one audio file per line', async () => {
    const clock = createFakeClock();
    const root = await mkdtemp(join(tmpdir(), 'bench-tts-'));
    const lines = QUALITY_LINES.slice(0, 3).map((l) => ({
      lineId: l.lineId, text: l.text, language: l.language, codeMixed: false,
    }));
    const outcome = await runTtsSweep('fake', lines, {
      profile: 'p', manifestPath: 'unused', condition: 'narrowband_8k', runsDir: root,
      maxRetries: 0, maxCalls: 100, seed: 1, drainTts: true, concurrency: 1,
      clock: clock.now, retrySleep: async () => { /* instant */ },
      now: () => new Date(0),
      ttsFactory: () => streamingTtsFake({ firstByteMs: 40, clock }),
    });
    const files = await readdir(join(outcome.directory, 'audio'));
    expect(files.sort()).toEqual(lines.map((l) => `${l.lineId}.pcm`).sort());
  });
});
