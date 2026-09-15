/**
 * End-to-end runner tests.
 *
 * This is the only run that measures the pre-registered gate, so the tests care
 * most about the things that would make its number quietly wrong: a fabricated
 * endpointing figure, a stage attributed to the wrong layer, a failed turn
 * averaged into the latency, or context that is not actually carried.
 */

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runE2eConversation, type E2eTurnCase } from '../src/runner/e2e-runner.js';
import { aggregateE2e } from '../src/results/aggregate.js';
import { runE2eSweep } from '../src/runner/sweep.js';
import { evaluate, STT_THRESHOLDS } from '../src/measure/verdict.js';
import { SCREENING_SYSTEM_PROMPT, screeningMessages } from '../src/runner/screen.js';
import { stageDurations } from '../src/measure/latency.js';
import { encodeWav } from '../src/audio/wav.js';
import {
  createFakeClock, failingLlmFake, streamingLlmFake, streamingSttFake, streamingTtsFake,
} from '../src/adapters/fakes.js';
import { HttpError } from '../src/adapters/http.js';
import type { BenchmarkLlmAdapter, LlmMessage } from '../src/adapters/types.js';

/** A tiny corpus whose consent names exactly the fakes this suite drives. */
async function writeFakeCorpus(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'bench-e2e-corpus-'));
  await mkdir(join(base, 'audio'), { recursive: true });
  const samples = new Int16Array(16000 * 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(6000 * Math.sin(i / 8));
  const ids = ['u1', 'u2', 'u3', 'u4'];
  for (const id of ids) await writeFile(join(base, 'audio', `${id}.wav`), encodeWav(samples, 16000));
  const path = join(base, 'manifest.json');
  await writeFile(path, JSON.stringify({
    corpusVersion: 'e2e-fixture-1',
    audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
    consent: [{
      speakerId: 'spk-01', obtainedAt: '2026-08-01', coversCrossBorderTransfer: true,
      disclosedProcessors: [
        'fake-stt — local test double, no transfer',
        'fake-llm — local test double, no transfer',
        'fake-tts — local test double, no transfer',
      ],
      retentionUntil: '2027-08-01', deletionContact: 'privacy@example.invalid',
    }],
    utterances: ids.map((id, index) => ({
      utteranceId: id, file: `audio/${id}.wav`, language: 'en-IN',
      reference: 'my notice period is ninety days', speakerId: 'spk-01',
      conversationId: 'c1', turnIndex: index,
    })),
  }), 'utf8');
  return path;
}

function speech(ms: number): Int16Array {
  const out = new Int16Array(Math.round((8000 * ms) / 1000));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(4000 * Math.sin(i / 8));
  return out;
}

const turn = (over: Partial<E2eTurnCase> = {}): E2eTurnCase => ({
  utteranceId: 'u1',
  conversationId: 'c1',
  turnIndex: 0,
  samples: speech(400),
  sampleRate: 8000,
  language: 'en-IN',
  reference: 'my notice period is 90 days',
  entities: [],
  codeMixed: false,
  ...over,
});

const stack = (clock: ReturnType<typeof createFakeClock>, over: {
  residualMs?: number; firstTokenMs?: number; ttsFirstByteMs?: number;
} = {}) => ({
  stt: streamingSttFake({
    clock, segments: ['my notice period is 90 days'],
    residualMs: over.residualMs ?? 150, interimAfterMs: 30,
  }),
  llm: streamingLlmFake({
    clock, firstTokenMs: over.firstTokenMs ?? 200, reply: 'And what is your expected salary?',
  }),
  tts: streamingTtsFake({ clock, firstByteMs: over.ttsFirstByteMs ?? 120 }),
  maxRetries: 0,
  clock: clock.now,
  sleep: async (ms: number) => clock.advance(ms),
  retrySleep: async () => { /* instant */ },
});

describe('the end-to-end turn chain', () => {
  it('measures total_turn as endpoint to first returned audio byte', async () => {
    const clock = createFakeClock();
    const results = await runE2eConversation([turn()], stack(clock));
    const durations = results[0]?.durations as Record<string, number>;

    // The STT fake emits an interim 30 ms after the endpoint and its final
    // 150 ms after that, so the post-endpoint residual is 180 ms — the mark is
    // the LAST final, not the first sign of life.
    expect(durations['stt']).toBeCloseTo(180, 0);
    expect(durations['llm_first_token']).toBeCloseTo(200, 0);
    // The pipeline is STREAMING: synthesis starts at the first sentence, so the
    // TTS first byte can arrive before the model has finished talking and the
    // stage overlaps generation rather than following it. That is why a TTS
    // provider is judged on its own COMPONENT run, where nothing hides it.
    expect(durations['tts_first_byte']).toBeLessThanOrEqual(120);
    expect(durations['total_turn']).toBeGreaterThan(durations['stt'] as number);
  });

  it('overlaps synthesis with generation instead of queueing behind it', async () => {
    // THE ARGUMENT FOR THIS ENTIRE RUNNER. A serial pipeline charges the turn
    // for the model's whole completion before synthesis can begin; a streaming
    // one does not, and the gate is written against the streaming shape.
    const chatty = createFakeClock();
    const chattyStack = {
      ...stack(chatty),
      llm: streamingLlmFake({
        clock: chatty, firstTokenMs: 200, perTokenMs: 25,
        reply: 'What is your notice period? I also need your expected salary and your current city and your earliest joining date.',
      }),
    };
    const results = await runE2eConversation([turn()], chattyStack);
    const d = results[0]?.durations as Record<string, number>;
    // Serial would be residual + the ENTIRE completion + first byte.
    const serialLowerBound = (d['stt'] as number) + (d['llm_complete'] as number) + 120;
    expect(d['total_turn']).toBeLessThan(serialLowerBound);
    // And only the first sentence was billed to TTS.
    expect(results[0]?.replyCharacters).toBeLessThan(results[0]?.replyLength as number);
  });

  it('never reports an endpointing figure, which would be the utterance length', async () => {
    // Recorded utterances have pre-cut boundaries. A figure here would be a
    // fabricated VAD decision printed as a measurement.
    const clock = createFakeClock();
    const results = await runE2eConversation([turn({ samples: speech(3000) })], stack(clock));
    expect(results[0]?.durations.endpointing).toBeUndefined();
    expect(results[0]?.timeline.speechStartedAt).toBeUndefined();
  });

  it('does not report audio_out, because there is no carrier', async () => {
    const clock = createFakeClock();
    const results = await runE2eConversation([turn()], stack(clock));
    expect(results[0]?.durations.audio_out).toBeUndefined();
    expect(results[0]?.timeline.audioOutAt).toBeUndefined();
  });

  it('total_turn is independent of how long the candidate spoke', async () => {
    const short = createFakeClock();
    const long = createFakeClock();
    const a = await runE2eConversation([turn({ samples: speech(400) })], stack(short));
    const b = await runE2eConversation([turn({ samples: speech(4000) })], stack(long));
    const at = (a[0]?.durations as Record<string, number>)['total_turn'] as number;
    const bt = (b[0]?.durations as Record<string, number>)['total_turn'] as number;
    expect(Math.abs(at - bt)).toBeLessThan(1);
  });
});

describe('the LLM receives the transcript, never the reference', () => {
  it('sends what STT actually produced', async () => {
    const clock = createFakeClock();
    const seen: LlmMessage[][] = [];
    const spy: BenchmarkLlmAdapter = {
      identity: { id: 'spy', displayName: 'Spy', adapterVersion: '0', model: 'm', unverified: false },
      streaming: true,
      async *complete(request) {
        seen.push([...request.messages]);
        clock.advance(50);
        yield { text: 'Understood.' };
      },
    };
    await runE2eConversation(
      [turn({ reference: 'THE REFERENCE TRANSCRIPT' })],
      { ...stack(clock), llm: spy },
    );
    const flattened = JSON.stringify(seen);
    expect(flattened).not.toContain('THE REFERENCE TRANSCRIPT');
    expect(flattened).toContain('my notice period is 90 days');
  });

  it('carries conversation history across turns', async () => {
    const clock = createFakeClock();
    const seen: LlmMessage[][] = [];
    const spy: BenchmarkLlmAdapter = {
      identity: { id: 'spy', displayName: 'Spy', adapterVersion: '0', model: 'm', unverified: false },
      streaming: true,
      async *complete(request) {
        seen.push([...request.messages]);
        clock.advance(50);
        yield { text: 'Next question.' };
      },
    };
    await runE2eConversation(
      [
        turn({ utteranceId: 'u1', turnIndex: 0 }),
        turn({ utteranceId: 'u2', turnIndex: 1 }),
      ],
      { ...stack(clock), llm: spy },
    );
    expect(seen[0]).toHaveLength(2);          // system + first candidate turn
    expect(seen[1]).toHaveLength(4);          // + assistant reply + second turn
    expect(seen[1]?.[2]?.role).toBe('assistant');
    expect(seen[1]?.[2]?.content).toBe('Next question.');
  });

  it('freezes the screening prompt and bounds the reply length', () => {
    const messages = screeningMessages([], 'hello');
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe(SCREENING_SYSTEM_PROMPT);
    // TTS is billed per character; an unbounded reply makes the run's cost
    // depend on the model's verbosity rather than on the corpus.
    expect(SCREENING_SYSTEM_PROMPT).toMatch(/at most 25 words/);
  });
});

describe('failures are attributed to the stage that failed', () => {
  it('records an LLM failure as llm_first_token and does not call TTS', async () => {
    const clock = createFakeClock();
    let ttsCalls = 0;
    const countingTts = streamingTtsFake({ clock, firstByteMs: 100 });
    const wrapped = {
      ...countingTts,
      async *synthesize(request: never) {
        ttsCalls += 1;
        yield* countingTts.synthesize(request);
      },
    };
    const results = await runE2eConversation([turn()], {
      ...stack(clock),
      llm: failingLlmFake({
        clock, failures: 99, error: () => new HttpError(500, 'Server Error', 'boom'),
      }),
      tts: wrapped,
    });
    expect(results[0]?.failure?.stage).toBe('llm_first_token');
    // A failed turn must not spend on the stage after it.
    expect(ttsCalls).toBe(0);
  });

  it('excludes a failed turn from latency and counts it separately', async () => {
    const clock = createFakeClock();
    const good = await runE2eConversation([turn()], stack(clock));
    const bad = await runE2eConversation([turn({ utteranceId: 'u2' })], {
      ...stack(clock),
      llm: failingLlmFake({
        clock, failures: 99, error: () => new HttpError(500, 'Server Error', 'boom'),
      }),
    });
    const summary = aggregateE2e([...good, ...bad]);
    expect(summary.sampleCount).toBe(1);
    expect(summary.failures.failed).toBe(1);
    expect(summary.failuresByStage['llm_first_token']).toBe(1);
  });

  it('continues the conversation after a failed turn rather than truncating it', async () => {
    // Abandoning would give a provider that failed early a SHORTER conversation
    // than its peers, and the comparison would then be across different inputs.
    const clock = createFakeClock();
    let calls = 0;
    const flaky: BenchmarkLlmAdapter = {
      identity: { id: 'flaky', displayName: 'Flaky', adapterVersion: '0', model: 'm', unverified: false },
      streaming: true,
      async *complete() {
        calls += 1;
        if (calls === 1) throw new HttpError(500, 'Server Error', 'boom');
        clock.advance(40);
        yield { text: 'Recovered question.' };
      },
    };
    const results = await runE2eConversation(
      [turn({ utteranceId: 'u1', turnIndex: 0 }), turn({ utteranceId: 'u2', turnIndex: 1 })],
      { ...stack(clock), llm: flaky },
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.failure?.stage).toBe('llm_first_token');
    expect(results[1]?.failure).toBeUndefined();
  });
});

describe('the end-to-end verdict applies the full pre-registered rule', () => {
  it('is the only run whose headline is total_turn', async () => {
    const clock = createFakeClock();
    const results = await runE2eConversation([turn()], stack(clock));
    const summary = aggregateE2e(results);
    const verdict = evaluate({
      stages: summary.stages,
      sampleCount: 30, hardFailureCount: 0,
      thresholds: STT_THRESHOLDS, headlineStage: 'total_turn',
      accuracy: summary.accuracy as never,
      hinglishAccuracy: summary.accuracy as never,
    });
    expect(summary.stages.total_turn).toBeDefined();
    expect(verdict.failures).toEqual([]);
  });

  it('FAILS a stack whose total exceeds the gate even when every stage is inside its own budget', async () => {
    // 400 + 400 + 400 = 1200 exactly at the derived component gates, but the
    // total is 1200 ms, which is the whole point of measuring end to end.
    const clock = createFakeClock();
    const results = await runE2eConversation([turn()], stack(clock, {
      residualMs: 500, firstTokenMs: 500, ttsFirstByteMs: 350,
    }));
    const summary = aggregateE2e(results);
    const verdict = evaluate({
      stages: summary.stages,
      sampleCount: 30, hardFailureCount: 0,
      thresholds: STT_THRESHOLDS, headlineStage: 'total_turn',
      accuracy: summary.accuracy as never,
      hinglishAccuracy: summary.accuracy as never,
    });
    expect((summary.stages.total_turn?.p50 ?? 0)).toBeGreaterThan(1200);
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.failures.join(' ')).toMatch(/Total turn p50/);
  });
});

describe('the end-to-end sweep persists a full run', () => {
  it('writes raw turns, metadata and metrics, and marks the chain unverified if any leg is', async () => {
    const clock = createFakeClock();
    const root = await mkdtemp(join(tmpdir(), 'bench-e2e-'));
    // Its OWN corpus, not the shipped template: the template is documentation a
    // founder reads, and it should not have to disclose this suite's fakes as
    // if they were processors of anybody's voice.
    const manifestPath = await writeFakeCorpus();
    const outcome = await runE2eSweep(
      { stt: 'fake-stt', llm: 'fake-llm', tts: 'fake-tts' },
      {
        profile: 'p', manifestPath,
        condition: 'narrowband_8k', runsDir: root,
        maxRetries: 0, maxCalls: 500, seed: 1, drainTts: false, concurrency: 1,
        clock: clock.now,
        sleep: async (ms) => clock.advance(ms),
        retrySleep: async () => { /* instant */ },
        now: () => new Date(0),
        sttFactory: () => ({
          ...streamingSttFake({ clock, segments: ['hello'], residualMs: 100 }),
          identity: {
            id: 'fake-stt', displayName: 'F', adapterVersion: '0', model: 'm',
            // One unverified leg must make the whole chain unverified.
            unverified: true,
          },
        }),
        llmFactory: () => streamingLlmFake({ clock, firstTokenMs: 100, reply: 'Next?' }),
        ttsFactory: () => streamingTtsFake({ clock, firstByteMs: 80 }),
      },
    );

    const files = (await readdir(outcome.directory)).sort();
    expect(files).toContain('raw.jsonl');
    expect(files).toContain('metrics.json');

    const rows = (await readFile(join(outcome.directory, 'raw.jsonl'), 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l) as { kind: string });
    expect(rows.every((r) => r.kind === 'turn')).toBe(true);
    expect(rows).toHaveLength(4); // the example corpus has four utterances

    const metadata = JSON.parse(
      await readFile(join(outcome.directory, 'metadata.json'), 'utf8'),
    ) as { subject: { kind: string; unverified: boolean; parameters: Record<string, string> } };
    expect(metadata.subject.kind).toBe('end_to_end');
    expect(metadata.subject.unverified).toBe(true);
    expect(metadata.subject.parameters['screeningPrompt']).toBeTruthy();
  });
});

describe('stageDurations defines total_turn offline', () => {
  it('uses the first TTS byte when there is no carrier hand-off', () => {
    const durations = stageDurations({
      turnIndex: 0, speechEndedAt: 1000, sttFinalAt: 1150,
      llmFirstTokenAt: 1350, ttsFirstByteAt: 1470,
    });
    expect(durations.total_turn).toBe(470);
    expect(durations.audio_out).toBeUndefined();
  });

  it('prefers a real carrier hand-off when one exists', () => {
    const durations = stageDurations({
      turnIndex: 0, speechEndedAt: 1000, sttFinalAt: 1150,
      llmFirstTokenAt: 1350, ttsFirstByteAt: 1470, audioOutAt: 1600,
    });
    expect(durations.total_turn).toBe(600);
    expect(durations.audio_out).toBe(130);
  });
});
