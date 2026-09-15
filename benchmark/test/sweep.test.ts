/**
 * End-to-end sweep tests.
 *
 * Drives the whole pipeline — corpus → condition → adapter → measurement →
 * persistence → aggregation → verdict — with fakes, and then checks the stored
 * artifacts are sufficient to reproduce the reported aggregate.
 *
 * That last property is the one that matters most: a verdict nobody can
 * recompute is an assertion, not evidence.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeWav } from '../src/audio/wav.js';
import { runSttSweep, runTtsSweep, type TtsLine } from '../src/runner/sweep.js';
import {
  createFakeClock, streamingSttFake, streamingTtsFake, failingSttFake,
} from '../src/adapters/fakes.js';
import { readRaw, type RunMetadata } from '../src/results/store.js';
import { renderSttReport, renderTtsReport } from '../src/results/report.js';
import { distribution } from '../src/measure/latency.js';
import { HttpError } from '../src/adapters/http.js';

function speech(sampleRate: number, ms: number): Int16Array {
  const count = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) out[i] = Math.round(5000 * Math.sin(i / 7));
  return out;
}

async function corpus(utteranceCount = 4) {
  const base = await mkdtemp(join(tmpdir(), 'bench-sweep-'));
  await mkdir(join(base, 'audio'), { recursive: true });

  const utterances = [];
  for (let i = 0; i < utteranceCount; i += 1) {
    await writeFile(join(base, 'audio', `u${i}.wav`), encodeWav(speech(16000, 1200), 16000));
    utterances.push({
      utteranceId: `u${i}`,
      file: `audio/u${i}.wav`,
      language: i % 2 === 0 ? 'en-IN' : 'hinglish',
      codeMixed: i % 2 === 1,
      reference: 'my notice period is 90 days',
      entities: [{ name: 'notice', kind: 'duration', accept: ['90 days'], unit: 'days' }],
      speakerId: 'spk-01',
      environment: 'quiet',
    });
  }

  const path = join(base, 'manifest.json');
  await writeFile(path, JSON.stringify({
    corpusVersion: 'sweep-1',
    audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16, minDurationMs: 500, maxDurationMs: 60000 },
    consent: [{
      speakerId: 'spk-01', obtainedAt: '2026-08-01', coversCrossBorderTransfer: true,
      // Must name every adapter id the test contacts: the sweep refuses to send
      // recordings to a processor the speakers were not told about.
      disclosedProcessors: [
        'fake (test)', 'fake-a (test)', 'fake-b (test)', 'flaky (test)',
        'fake-stt (test)', 'fake-llm (test)', 'fake-tts (test)',
        'sarvam (test)', 'deepgram (test)', 'elevenlabs (test)', 'cartesia (test)', 'gemini (test)',
      ],
      retentionUntil: '2027-08-01',
      deletionContact: 'privacy@example.test',
    }],
    utterances,
  }, null, 2));
  return { base, path };
}

function options(manifestPath: string, runsDir: string, clock: ReturnType<typeof createFakeClock>) {
  return {
    profile: 'test', manifestPath, condition: 'clean_16k' as const, runsDir,
    maxRetries: 1, maxCalls: 100, seed: 7, drainTts: false, concurrency: 1,
    clock: clock.now,
    sleep: async (ms: number) => { clock.advance(ms); },
    retrySleep: async () => {},
    now: () => new Date('2026-08-19T00:00:00.000Z'),
  };
}

describe('STT sweep', () => {
  it('runs the corpus, persists raw rows, and reaches a verdict', async () => {
    const { path } = await corpus(4);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runSttSweep('fake', {
      ...options(path, runsDir, clock),
      sttFactory: () => streamingSttFake({
        segments: ['my notice period is 90 days'], residualMs: 150, clock,
      }),
    });

    expect(outcome.aggregate.failures.attempted).toBe(4);
    expect(outcome.aggregate.failures.failed).toBe(0);
    expect(outcome.aggregate.accuracy?.wer).toBe(0);
    expect(outcome.aggregate.accuracy?.entitiesFound).toBe(4);
    // Only 4 samples, so a percentile is not a result yet.
    expect(outcome.verdict.verdict).toBe('INCOMPLETE');

    const rows = await readRaw(outcome.directory);
    expect(rows.filter((r) => r.kind === 'stt')).toHaveLength(4);
  });

  it('separates the Hinglish subset for the sub-gate', async () => {
    const { path } = await corpus(4);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runSttSweep('fake', {
      ...options(path, runsDir, clock),
      sttFactory: () => streamingSttFake({
        segments: ['my notice period is 90 days'], residualMs: 100, clock,
      }),
    });
    // 2 of the 4 fixtures are code-mixed.
    expect(outcome.aggregate.hinglishAccuracy).toBeDefined();
    expect(outcome.aggregate.hinglishAccuracy?.entitiesExpected).toBe(2);
  });

  it('stores enough to RECOMPUTE the reported aggregate', async () => {
    // The property that makes a verdict auditable rather than asserted.
    const { path } = await corpus(5);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runSttSweep('fake', {
      ...options(path, runsDir, clock),
      sttFactory: () => streamingSttFake({ segments: ['x'], residualMs: 120, clock }),
    });

    const rows = await readRaw(outcome.directory);
    const residuals = rows
      .filter((r) => r.kind === 'stt')
      .map((r) => (r.payload as { measurements: { residualMs?: number } }).measurements.residualMs)
      .filter((v): v is number => typeof v === 'number');

    const recomputed = distribution(residuals);
    expect(recomputed?.p50).toBe(outcome.aggregate.stages.stt?.p50);
    expect(recomputed?.count).toBe(outcome.aggregate.stages.stt?.count);
  });

  it('records the input checksum with every row, proving identical input', async () => {
    const { path } = await corpus(2);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const a = await runSttSweep('fake-a', {
      ...options(path, runsDir, clock),
      profile: 'p-a',
      sttFactory: () => streamingSttFake({ segments: ['x'], residualMs: 100, clock }),
    });
    const b = await runSttSweep('fake-b', {
      ...options(path, runsDir, clock),
      profile: 'p-b',
      sttFactory: () => streamingSttFake({ segments: ['x'], residualMs: 200, clock }),
    });

    const checksums = async (dir: string) =>
      (await readRaw(dir))
        .filter((r) => r.kind === 'stt')
        .map((r) => (r.payload as { inputChecksum: string }).inputChecksum);

    // Two providers, byte-identical input. Without this a "comparison" is not one.
    expect(await checksums(a.directory)).toEqual(await checksums(b.directory));
  });

  it('records failures without hiding them', async () => {
    const { path } = await corpus(3);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runSttSweep('flaky', {
      ...options(path, runsDir, clock),
      maxRetries: 0,
      sttFactory: () => failingSttFake({
        failures: Number.POSITIVE_INFINITY,
        error: () => new HttpError(500, 'Server Error', 'boom'),
        clock,
      }),
    });

    expect(outcome.aggregate.failures.failed).toBe(3);
    expect(outcome.aggregate.failures.byCategory['transient_transport']).toBe(3);
    expect(outcome.verdict.failures.join(' ')).toMatch(/hard failures/);

    const errors = JSON.parse(await readFile(join(outcome.directory, 'errors.json'), 'utf8')) as {
      records: unknown[];
    };
    expect(errors.records).toHaveLength(3);
  });

  it('honours the max-calls ceiling and records that it stopped', async () => {
    const { path } = await corpus(10);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runSttSweep('fake', {
      ...options(path, runsDir, clock),
      maxCalls: 3,
      sttFactory: () => streamingSttFake({ segments: ['x'], residualMs: 50, clock }),
    });

    expect(outcome.aggregate.failures.attempted).toBe(3);
    const rows = await readRaw(outcome.directory);
    expect(rows.some((r) => r.kind === 'note' && JSON.stringify(r.payload).includes('maxCalls'))).toBe(true);
  });
});

describe('TTS sweep', () => {
  it('runs the frozen line set and gates on first byte', async () => {
    const { path } = await corpus(1);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const lines: TtsLine[] = [
      { lineId: 'l1', text: 'hello there', language: 'en-IN', codeMixed: false },
      { lineId: 'l2', text: 'aapka notice period', language: 'hi-IN', codeMixed: true },
    ];

    const outcome = await runTtsSweep('fake', lines, {
      ...options(path, runsDir, clock),
      ttsFactory: () => streamingTtsFake({ firstByteMs: 120, clock }),
    });

    expect(outcome.aggregate.stages.tts_first_byte?.p50).toBe(120);
    expect(outcome.aggregate.failures.attempted).toBe(2);
    const rows = await readRaw(outcome.directory);
    expect(rows.filter((r) => r.kind === 'tts')).toHaveLength(2);
  });
});

describe('reports carry provenance and never claim more than was measured', () => {
  it('flags an unverified adapter prominently', async () => {
    const { path } = await corpus(2);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runSttSweep('fake', {
      ...options(path, runsDir, clock),
      sttFactory: () => ({
        ...streamingSttFake({ segments: ['x'], residualMs: 90, clock }),
        identity: {
          id: 'fake', displayName: 'Fake', adapterVersion: '9.9',
          model: 'm', unverified: true,
        },
      }),
    });

    const metadata = JSON.parse(
      await readFile(join(outcome.directory, 'metadata.json'), 'utf8'),
    ) as RunMetadata;
    const markdown = renderSttReport(metadata, outcome.aggregate, outcome.verdict);

    expect(markdown).toContain('UNVERIFIED');
    expect(markdown).toContain('sweep-1');          // corpus version
    expect(markdown).toContain('9.9');              // adapter version
    expect(markdown).toContain('does not select');  // ranks, never selects
  });

  it('renders a TTS report noting that the stream was not drained', async () => {
    const { path } = await corpus(1);
    const runsDir = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const clock = createFakeClock();

    const outcome = await runTtsSweep(
      'fake',
      [{ lineId: 'l1', text: 'hi', language: 'en-IN', codeMixed: false }],
      { ...options(path, runsDir, clock), ttsFactory: () => streamingTtsFake({ firstByteMs: 60, clock }) },
    );
    const metadata = JSON.parse(
      await readFile(join(outcome.directory, 'metadata.json'), 'utf8'),
    ) as RunMetadata;
    const markdown = renderTtsReport(metadata, outcome.aggregate, outcome.verdict);
    expect(markdown).toMatch(/stopped after the first byte/);
  });
});
