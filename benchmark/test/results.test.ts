/**
 * Persistence, reproducibility, redaction, planning and the blind quality gate.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BENCHMARK_VERSION, collectEnvironment, readRaw, RunExistsError, RunStore,
  type RunMetadata,
} from '../src/results/store.js';
import { redact } from '../src/adapters/http.js';
import { planSweep, renderPlan } from '../src/runner/plan.js';
import {
  buildBlindSet, decodeQuality, mulberry32, shuffle, writeBlindPack,
} from '../src/quality/blind.js';
import { QUALITY_LINES } from '../src/quality/lines.js';
import { missingCredentials, STT_ADAPTERS, TTS_ADAPTERS } from '../src/adapters/registry.js';

function metadata(runId: string): RunMetadata {
  return {
    runId,
    benchmarkVersion: BENCHMARK_VERSION,
    profile: 'test',
    startedAt: '2026-08-19T00:00:00.000Z',
    corpus: {
      manifestPath: '/corpus/manifest.json',
      corpusVersion: 'test-1',
      utteranceCount: 2,
      condition: 'narrowband_8k',
      inputChecksums: { u1: 'abc', u2: 'def' },
    },
    subject: {
      kind: 'stt', adapterId: 'fake', adapterVersion: '1.0',
      model: 'fake-model', unverified: true, streaming: true,
    },
    configuration: {
      maxRetries: 2, concurrency: 1, maxCalls: 500, drainTts: false, seed: 42,
    },
    environment: {
      node: 'v22', platform: 'darwin', arch: 'arm64',
      gitCommit: 'abc123', gitDirty: false, ffmpeg: 'ffmpeg 7', host: 'test-host',
    },
  };
}

describe('raw results are written first and never overwritten', () => {
  it('writes metadata, raw rows, metrics and errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const store = new RunStore(root, metadata('run-a'));
    await store.open();

    await store.raw({ kind: 'stt', at: '2026-08-19T00:00:01Z', utteranceId: 'u1', payload: { residualMs: 120 } });
    await store.raw({ kind: 'stt', at: '2026-08-19T00:00:02Z', utteranceId: 'u2', payload: { residualMs: 140 } });
    await store.metrics({ p50: 130 });
    await store.errors({ failed: 0 });
    await store.close('2026-08-19T00:00:03Z');

    const dir = store.directory;
    expect(existsSync(join(dir, 'metadata.json'))).toBe(true);
    expect(existsSync(join(dir, 'raw.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'metrics.json'))).toBe(true);
    expect(existsSync(join(dir, 'errors.json'))).toBe(true);

    const rows = await readRaw(dir);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.utteranceId).toBe('u1');
  });

  it('refuses to overwrite an existing run', async () => {
    // Previous evidence must remain intact.
    const root = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    await new RunStore(root, metadata('run-b')).open();
    await expect(new RunStore(root, metadata('run-b')).open()).rejects.toThrow(RunExistsError);
  });

  it('lets every aggregate be recomputed from raw rows', async () => {
    // This is what makes a verdict auditable rather than merely asserted.
    const root = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const store = new RunStore(root, metadata('run-c'));
    await store.open();
    for (const ms of [100, 200, 300, 400]) {
      await store.raw({ kind: 'stt', at: 'now', payload: { residualMs: ms } });
    }
    await store.close('later');

    const rows = await readRaw(store.directory);
    const values = rows.map((r) => (r.payload as { residualMs: number }).residualMs).sort((a, b) => a - b);
    expect(values).toEqual([100, 200, 300, 400]);
  });

  it('records everything needed to reproduce the run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const store = new RunStore(root, metadata('run-d'));
    await store.open();
    await store.close('2026-08-19T01:00:00Z');

    const saved = JSON.parse(await readFile(join(store.directory, 'metadata.json'), 'utf8')) as RunMetadata;
    expect(saved.corpus.corpusVersion).toBe('test-1');
    expect(saved.corpus.condition).toBe('narrowband_8k');
    expect(saved.corpus.inputChecksums['u1']).toBe('abc');
    expect(saved.subject.adapterVersion).toBe('1.0');
    expect(saved.subject.unverified).toBe(true);
    expect(saved.configuration.seed).toBe(42);
    expect(saved.environment.gitCommit).toBe('abc123');
    expect(saved.benchmarkVersion).toBe(BENCHMARK_VERSION);
  });

  it('collects real environment metadata', async () => {
    const environment = await collectEnvironment();
    expect(environment.node).toMatch(/^v\d+/);
    expect(environment.platform).toBeTruthy();
    // git may be absent in some CI images; the field is nullable on purpose.
    expect(environment).toHaveProperty('gitCommit');
  });
});

describe('secrets never reach disk or logs', () => {
  it('redacts api keys, bearer tokens and subscription keys', () => {
    expect(redact('{"api_key":"sk-abcdefghijk"}')).not.toContain('sk-abcdefghijk');
    expect(redact('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
    expect(redact('{"subscription-key": "xyz123456"}')).not.toContain('xyz123456');
    expect(redact('key is sk-verysecretvalue123')).toContain('[REDACTED]');
  });

  it('redacts on the way into raw.jsonl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const store = new RunStore(root, metadata('run-secret'));
    await store.open();
    await store.raw({
      kind: 'note', at: 'now',
      payload: { error: 'HTTP 401: {"api_key":"sk-supersecret12345"}' },
    });
    const text = await readFile(join(store.directory, 'raw.jsonl'), 'utf8');
    expect(text).not.toContain('sk-supersecret12345');
    expect(text).toContain('[REDACTED]');
  });

  it('redacts errors.json too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-runs-'));
    const store = new RunStore(root, metadata('run-secret2'));
    await store.open();
    await store.errors({ message: 'Bearer eyJhbGciOiJIUzI1NiJ9' });
    const text = await readFile(join(store.directory, 'errors.json'), 'utf8');
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('has no credential literal anywhere in benchmark source', async () => {
    const { readdirSync, statSync, readFileSync } = await import('node:fs');
    const root = join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) files.push(full);
      }
    };
    walk(root);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(/sk-[A-Za-z0-9]{16,}/.test(src), `${file} contains a key-shaped literal`).toBe(false);
    }
  });
});

describe('cost control: the plan is the approved seven runs', () => {
  const utterances = Array.from({ length: 55 }, (_, i) => ({ id: `u${i}`, durationMs: 6000 }));
  const ttsLines = QUALITY_LINES.map((l) => ({ id: l.lineId, text: l.text }));

  it('plans 3 STT + 3 TTS + 1 end-to-end, not a cross product', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a', 'b', 'c'], ttsAdapters: ['x', 'y', 'z'],
      endToEnd: { stt: 'a', tts: 'x' },
      utterances, ttsLines, maxRetries: 2, maxCalls: 1000,
    });
    expect(plan.runs).toHaveLength(7);
    expect(plan.runs.filter((r) => r.kind === 'stt')).toHaveLength(3);
    expect(plan.runs.filter((r) => r.kind === 'tts')).toHaveLength(3);
    expect(plan.runs.filter((r) => r.kind === 'end_to_end')).toHaveLength(1);
  });

  it('would flag a 3x3 cross product as duplicated measurement', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a', 'b', 'c', 'd', 'e'],
      ttsAdapters: ['v', 'w', 'x', 'y', 'z'],
      utterances, ttsLines, maxRetries: 2, maxCalls: 10_000,
    });
    expect(plan.warnings.join(' ')).toMatch(/approved design is 7/);
  });

  it('estimates provider calls, audio seconds and characters before spending', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a'], ttsAdapters: ['x'],
      utterances, ttsLines, maxRetries: 2, maxCalls: 1000,
    });
    expect(plan.totalCalls).toBe(55 + ttsLines.length);
    expect(plan.totalAudioSeconds).toBeCloseTo(330, 0);
    expect(plan.totalCharacters).toBeGreaterThan(0);
    // Worst case is what a budget must survive.
    expect(plan.worstCaseCalls).toBe(plan.totalCalls * 3);
  });

  it('warns when the plan exceeds the call ceiling', () => {
    const plan = planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a', 'b', 'c'], ttsAdapters: ['x'],
      utterances, ttsLines, maxRetries: 2, maxCalls: 10,
    });
    expect(plan.warnings.join(' ')).toMatch(/above the --max-calls ceiling/);
  });

  it('renders a plan a human can read before confirming', () => {
    const text = renderPlan(planSweep({
      profile: 'p', condition: 'narrowband_8k',
      sttAdapters: ['a'], ttsAdapters: ['x'],
      utterances, ttsLines, maxRetries: 2, maxCalls: 1000,
    }));
    expect(text).toMatch(/TOTAL: \d+ provider calls/);
    expect(text).toMatch(/worst case with retries/);
  });
});

describe('the blind listening gate cannot leak provider identity', () => {
  const LINE = QUALITY_LINES[0]!.lineId;
  const samples = [
    { providerId: 'alpha', lineId: LINE, audio: new Uint8Array(320), sampleRate: 8000 as const },
    { providerId: 'beta', lineId: LINE, audio: new Uint8Array(320), sampleRate: 8000 as const },
    { providerId: 'gamma', lineId: LINE, audio: new Uint8Array(320), sampleRate: 8000 as const },
  ];

  it('produces opaque keys carrying no provider information', () => {
    const set = buildBlindSet(samples, 42);
    for (const key of set.order) {
      expect(key).toMatch(/^sample-\d{3}$/);
      for (const provider of ['alpha', 'beta', 'gamma']) {
        expect(key).not.toContain(provider);
      }
    }
  });

  it('is deterministic from the recorded seed', () => {
    expect(buildBlindSet(samples, 7).order).toEqual(buildBlindSet(samples, 7).order);
    expect(mulberry32(1)()).toBeCloseTo(mulberry32(1)(), 10);
  });

  it('actually shuffles, so presentation order is not provider order', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      providerId: `p${i % 3}`, lineId: `q${i}`, audio: new Uint8Array(2), sampleRate: 8000 as const,
    }));
    const shuffled = shuffle(many, 99);
    expect(shuffled.map((s) => s.lineId)).not.toEqual(many.map((s) => s.lineId));
  });

  it('writes the mapping OUTSIDE the listener folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-blind-'));
    const { listenDir, mappingPath } = await writeBlindPack(root, samples, QUALITY_LINES, 42);

    // Handing over listen/ must not let a listener decode the set.
    expect(mappingPath.startsWith(listenDir)).toBe(false);
    const { readdirSync } = await import('node:fs');
    const listed = readdirSync(listenDir);
    expect(listed.some((f) => f.includes('mapping'))).toBe(false);
    expect(listed).toContain('scoring-sheet.json');

    const sheet = JSON.parse(await readFile(join(listenDir, 'scoring-sheet.json'), 'utf8')) as {
      samples: { sampleKey: string; text: string }[];
    };
    // The TEXT is shown — you cannot judge pronunciation without it — but the
    // sheet must contain no provider name anywhere.
    const serialised = JSON.stringify(sheet);
    for (const provider of ['alpha', 'beta', 'gamma']) {
      expect(serialised).not.toContain(provider);
    }
    expect(sheet.samples[0]?.text).toBeTruthy();
  });

  it('refuses to build a pack whose sample references an unknown line', async () => {
    // Otherwise the listener gets a scoring sheet with no reference text and
    // scores pronunciation against nothing.
    const root = await mkdtemp(join(tmpdir(), 'bench-blind-'));
    await expect(
      writeBlindPack(
        root,
        [{ providerId: 'alpha', lineId: 'does-not-exist', audio: new Uint8Array(2), sampleRate: 8000 }],
        QUALITY_LINES,
        1,
      ),
    ).rejects.toThrow(/unknown line ids/);
  });

  it('excludes a provider that 2 of 3 listeners reject', () => {
    const set = buildBlindSet(samples, 42);
    const keyFor = (provider: string) =>
      set.order.find((k) => set.mapping[k]?.providerId === provider) as string;

    const scores = [
      { sampleKey: keyFor('alpha'), listenerId: 'L1', intelligibility: 2, naturalness: 2, pronunciation: 1, indianSuitability: 1, unacceptable: true },
      { sampleKey: keyFor('alpha'), listenerId: 'L2', intelligibility: 2, naturalness: 2, pronunciation: 2, indianSuitability: 2, unacceptable: true },
      { sampleKey: keyFor('alpha'), listenerId: 'L3', intelligibility: 4, naturalness: 4, pronunciation: 4, indianSuitability: 4, unacceptable: false },
      { sampleKey: keyFor('beta'), listenerId: 'L1', intelligibility: 5, naturalness: 5, pronunciation: 5, indianSuitability: 5, unacceptable: false },
    ];

    const verdicts = decodeQuality(set, scores);
    expect(verdicts.find((v) => v.providerId === 'alpha')?.excluded).toBe(true);
    expect(verdicts.find((v) => v.providerId === 'beta')?.excluded).toBe(false);
  });

  it('counts LISTENERS who rejected, not samples', () => {
    // One listener disliking five samples is one vote, not five.
    const set = buildBlindSet(samples, 5);
    const keys = set.order;
    const scores = keys.map((key) => ({
      sampleKey: key, listenerId: 'L1',
      intelligibility: 1, naturalness: 1, pronunciation: 1, indianSuitability: 1,
      unacceptable: true,
    }));
    for (const verdict of decodeQuality(set, scores)) {
      expect(verdict.unacceptableVotes).toBe(1);
      expect(verdict.excluded).toBe(false);
    }
  });

  it('uses identical text for every provider', () => {
    // Different text would make the comparison meaningless.
    const ids = new Set(QUALITY_LINES.map((l) => l.lineId));
    expect(ids.size).toBe(QUALITY_LINES.length);
    expect(QUALITY_LINES.length).toBeGreaterThanOrEqual(10);
    // The set must stress what Indian screening calls actually contain.
    const probes = new Set(QUALITY_LINES.flatMap((l) => l.probes));
    for (const required of ['indian_name', 'lakh_crore', 'date', 'english_technical_term', 'code_switch']) {
      expect(probes.has(required as never)).toBe(true);
    }
  });
});

describe('credential pre-flight', () => {
  it('reports which variables are missing without printing any value', () => {
    const missing = missingCredentials([...Object.keys(STT_ADAPTERS), ...Object.keys(TTS_ADAPTERS)]);
    for (const [, names] of Object.entries(missing)) {
      for (const name of names) expect(name).toMatch(/^[A-Z_]+$/);
    }
  });
});
