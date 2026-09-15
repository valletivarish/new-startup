/**
 * Pooling and cost-estimation tests.
 *
 * Both exist because the pre-registered protocol requires them and neither was
 * implemented. The tests care most about the ways each could quietly produce a
 * number that means nothing: pooling two different experiments, or pricing a
 * sweep from a rate nobody verified.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { IncompatibleRunsError, compatibilityReasons, poolRuns } from '../src/results/pool.js';
import {
  estimateCost, parseRateCard, renderCostEstimate, type RateCard,
} from '../src/cost/rates.js';
import type { RunMetadata } from '../src/results/store.js';

function metadata(over: Partial<RunMetadata> = {}): RunMetadata {
  return {
    runId: 'r', benchmarkVersion: '5c.1.0', profile: 'p', startedAt: 'now',
    corpus: {
      manifestPath: 'm', corpusVersion: 'c-1', utteranceCount: 2,
      condition: 'narrowband_8k', inputChecksums: { u1: 'aaa', u2: 'bbb' }, codec: 'g726@32k',
    },
    subject: {
      kind: 'stt', adapterId: 'x', adapterVersion: '0.1', model: 'm1',
      unverified: true, streaming: false,
    },
    configuration: { maxRetries: 2, concurrency: 1, maxCalls: 500, drainTts: false, seed: 42 },
    environment: {
      node: 'v', platform: 'p', arch: 'a', gitCommit: null, gitDirty: null, ffmpeg: null, host: 'h',
    },
    ...over,
  } as RunMetadata;
}

async function writeRun(
  root: string, name: string, meta: RunMetadata, residuals: readonly number[],
): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(meta), 'utf8');
  const rows = residuals.map((residual, index) =>
    JSON.stringify({
      kind: 'stt', at: 'now', utteranceId: `u${index + 1}`,
      payload: {
        transcript: 'hello', timeline: { requestStartedAt: 0, finalAts: [], retries: 0 },
        measurements: { residualMs: residual, finalCount: 1, retries: 0 },
        codeMixed: false, attempts: 1, recovered: false,
      },
    }),
  );
  await writeFile(join(dir, 'raw.jsonl'), rows.join('\n') + '\n', 'utf8');
  return dir;
}

describe('pooling combines samples rather than verdicts', () => {
  it('recomputes percentiles over the combined sample', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-pool-'));
    const a = await writeRun(root, 'a', metadata(), [100, 110]);
    const b = await writeRun(root, 'b', metadata(), [200, 210]);
    const pooled = await poolRuns([a, b]);
    expect(pooled.aggregate.sampleCount).toBe(4);
    // The pooled p50 is a value that actually occurred in the combined sample,
    // not the mean of two run-level p50s.
    expect([100, 110, 200, 210]).toContain(pooled.aggregate.stages.stt?.p50);
  });

  it('refuses to pool a single run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-pool-'));
    const a = await writeRun(root, 'a', metadata(), [100]);
    await expect(poolRuns([a])).rejects.toThrow(/at least two runs/);
  });

  it('refuses to pool runs from different corpus versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-pool-'));
    const a = await writeRun(root, 'a', metadata(), [100]);
    const b = await writeRun(root, 'b', metadata({
      corpus: { ...metadata().corpus, corpusVersion: 'c-2' },
    }), [200]);
    await expect(poolRuns([a, b])).rejects.toThrow(IncompatibleRunsError);
  });

  it('refuses to pool runs whose audio checksums differ', async () => {
    // The strongest check: two runs can agree on every label and still have been
    // fed different audio, if the corpus was re-recorded without a version bump.
    const root = await mkdtemp(join(tmpdir(), 'bench-pool-'));
    const a = await writeRun(root, 'a', metadata(), [100]);
    const b = await writeRun(root, 'b', metadata({
      corpus: { ...metadata().corpus, inputChecksums: { u1: 'aaa', u2: 'CHANGED' } },
    }), [200]);
    const reasons = compatibilityReasons([
      { directory: a, metadata: metadata(), rows: [] },
      {
        directory: b,
        metadata: metadata({ corpus: { ...metadata().corpus, inputChecksums: { u1: 'aaa', u2: 'CHANGED' } } }),
        rows: [],
      },
    ]);
    expect(reasons.join(' ')).toMatch(/checksums differ/);
  });

  it('refuses to pool different adapters, conditions, codecs or retry budgets', () => {
    const base = { directory: 'a', metadata: metadata(), rows: [] };
    const cases: [string, RunMetadata][] = [
      ['adapter', metadata({ subject: { ...metadata().subject, adapterId: 'y' } })],
      ['condition', metadata({ corpus: { ...metadata().corpus, condition: 'clean_16k' } })],
      ['codec', metadata({ corpus: { ...metadata().corpus, codec: 'amr_nb@12.2k' } })],
      ['retries', metadata({ configuration: { ...metadata().configuration, maxRetries: 0 } })],
      ['kind', metadata({ subject: { ...metadata().subject, kind: 'tts' } })],
    ];
    for (const [label, other] of cases) {
      const reasons = compatibilityReasons([base, { directory: 'b', metadata: other, rows: [] }]);
      expect(reasons.length, `pooling across differing ${label} must be refused`).toBeGreaterThan(0);
    }
  });

  it('restores the utterance id so pooled failures name something', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-pool-'));
    const failing = {
      kind: 'stt', at: 'now', utteranceId: 'u-named',
      payload: {
        transcript: '', timeline: { requestStartedAt: 0, finalAts: [], retries: 0 },
        measurements: { finalCount: 0, retries: 0 },
        codeMixed: false, attempts: 1, recovered: false,
        failure: { category: 'timeout', message: 'slow' },
      },
    };
    for (const name of ['a', 'b']) {
      const dir = join(root, name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata()), 'utf8');
      await writeFile(join(dir, 'raw.jsonl'), JSON.stringify(failing) + '\n', 'utf8');
    }
    const pooled = await poolRuns([join(root, 'a'), join(root, 'b')]);
    expect(pooled.aggregate.failures.records.map((r) => r.utteranceId)).toEqual(['u-named', 'u-named']);
  });
});

describe('cost estimation never invents a rate', () => {
  const card: RateCard = parseRateCard({
    version: 'test-1',
    usdToInr: { rate: 90, source: 'ESTIMATE', verifiedOn: '2026-08-24' },
    rates: {
      'a.stt': {
        unit: 'per_audio_hour', amount: 30, currency: 'INR',
        source: 'OFFICIAL', url: 'https://example.test/pricing', verifiedOn: '2026-08-24',
      },
      'b.tts': {
        unit: 'per_10k_characters', amount: 15, currency: 'INR',
        source: 'OFFICIAL', url: 'https://example.test/pricing', verifiedOn: '2026-08-24',
      },
      'c.llm': {
        unit: 'per_1m_output_tokens', amount: 1, currency: 'USD',
        source: 'OFFICIAL', url: 'https://example.test/pricing', verifiedOn: '2026-08-24',
      },
    },
  });

  it('prices audio hours and characters in their own units', () => {
    const estimate = estimateCost(
      [
        { runId: 'r1', key: 'a.stt', audioSeconds: 3600, characters: 0 },
        { runId: 'r2', key: 'b.tts', audioSeconds: 0, characters: 10_000 },
      ],
      card,
    );
    expect(estimate.pricedInr).toBeCloseTo(45, 5);
  });

  it('reports NOT PRICED rather than zero for a missing rate', () => {
    const estimate = estimateCost(
      [{ runId: 'r1', key: 'unknown.stt', audioSeconds: 3600, characters: 0 }],
      card,
    );
    expect(estimate.lines[0]?.inr).toBeUndefined();
    expect(estimate.pricedInr).toBe(0);
    expect(estimate.unpriced).toEqual(['unknown.stt']);
    expect(estimate.complete).toBe(false);
    expect(renderCostEstimate(estimate)).toMatch(/NOT PRICED/);
    expect(renderCostEstimate(estimate)).toMatch(/FLOOR, not an estimate/);
  });

  it('refuses to guess a token count from audio or characters', () => {
    // Token usage depends on the model and the prompt. An estimate that assumed
    // one would be inventing exactly the number it was asked to produce.
    const estimate = estimateCost(
      [{ runId: 'r1', key: 'c.llm', audioSeconds: 3600, characters: 5000 }],
      card,
    );
    expect(estimate.lines[0]?.inr).toBeUndefined();
    expect(estimate.lines[0]?.missingReason).toMatch(/must be measured, not assumed/);
  });

  it('flags a non-official FX rate rather than hiding it in the total', () => {
    const estimate = estimateCost(
      [{ runId: 'r1', key: 'a.stt', audioSeconds: 60, characters: 0 }],
      card,
    );
    expect(estimate.warnings.join(' ')).toMatch(/ESTIMATE/);
  });

  it('rejects a rate card missing provenance', () => {
    expect(() => parseRateCard({
      version: 'x',
      usdToInr: { rate: 90, source: 'ESTIMATE', verifiedOn: '2026-08-24' },
      rates: { 'a.stt': { unit: 'per_audio_hour', amount: 30, currency: 'INR' } },
    })).toThrow();
  });
});
