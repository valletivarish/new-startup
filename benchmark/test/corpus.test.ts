/**
 * Corpus validation tests.
 *
 * Every defect caught here is one that would otherwise be attributed to a
 * provider: a silent recording scores every provider as failing, an
 * unnormalised file makes AGC behave differently for reasons unrelated to the
 * provider, and an entity expectation that no perfect transcription could
 * satisfy drags every score down equally but invisibly.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeWav } from '../src/audio/wav.js';
import { validateCorpus, loadCorpus } from '../src/corpus/loader.js';
import { CorpusManifestSchema } from '../src/corpus/manifest.js';

function tone(sampleRate: number, ms: number, amplitude = 6000): Int16Array {
  const count = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  }
  return out;
}

// Every registered adapter must be named, because a sweep refuses to contact a
// processor the speaker was not told about — and each entry must say WHERE, so
// that the person signing knows what they are agreeing to.
const CONSENT = {
  speakerId: 'spk-01',
  obtainedAt: '2026-08-01',
  coversCrossBorderTransfer: true as const,
  disclosedProcessors: [
    'sarvam — Sarvam AI (processing location not documented by the provider)',
    'deepgram — Deepgram, United States (no India region available)',
    'elevenlabs — ElevenLabs, United States (no India region available)',
    'cartesia — Cartesia (endpoint region not disclosed; India is enterprise-only)',
    'gemini — Google LLC, processing location not documented',
  ],
  retentionUntil: '2027-08-01',
  deletionContact: 'privacy@example.test',
};

let dir: string;

async function writeCorpus(overrides: Record<string, unknown> = {}, audio?: Int16Array) {
  const base = await mkdtemp(join(tmpdir(), 'bench-corpus-'));
  await mkdir(join(base, 'audio'), { recursive: true });
  await writeFile(join(base, 'audio', 'u1.wav'), encodeWav(audio ?? tone(16000, 2000), 16000));

  const manifest = {
    corpusVersion: 'test-1',
    description: 'fixture',
    audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16, minDurationMs: 500, maxDurationMs: 60000 },
    consent: [CONSENT],
    utterances: [
      {
        utteranceId: 'u1',
        file: 'audio/u1.wav',
        language: 'en-IN',
        codeMixed: false,
        reference: 'my notice period is 90 days',
        entities: [{ name: 'notice', kind: 'duration', accept: ['90 days'], unit: 'days' }],
        speakerId: 'spk-01',
        environment: 'quiet',
      },
    ],
    ...overrides,
  };
  const path = join(base, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest, null, 2));
  return { base, path };
}

beforeAll(async () => {
  dir = (await writeCorpus()).base;
});

describe('manifest schema', () => {
  it('rejects an unknown field rather than ignoring it', () => {
    const result = CorpusManifestSchema.safeParse({
      corpusVersion: 'x',
      audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      consent: [CONSENT],
      utterances: [],
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  it('REQUIRES consent to cover cross-border transfer', () => {
    // Deepgram and Cartesia process outside India. A consent that does not
    // cover transfer makes the corpus unusable for them, and re-consenting
    // means re-contacting every participant.
    const result = CorpusManifestSchema.safeParse({
      corpusVersion: 'x',
      audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      consent: [{ ...CONSENT, coversCrossBorderTransfer: false }],
      utterances: [],
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one utterance and one consent record', () => {
    expect(
      CorpusManifestSchema.safeParse({
        corpusVersion: 'x',
        audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
        consent: [], utterances: [],
      }).success,
    ).toBe(false);
  });
});

describe('corpus validation makes no provider calls and finds real problems', () => {
  it('accepts a well-formed corpus', async () => {
    const { path } = await writeCorpus();
    const result = await validateCorpus(path);
    expect(result.valid).toBe(true);
    expect(result.utteranceCount).toBe(1);
    expect(result.byLanguage['en-IN']).toBe(1);
  });

  it('reports a missing audio file', async () => {
    const { path } = await writeCorpus({
      utterances: [{
        utteranceId: 'gone', file: 'audio/missing.wav', language: 'en-IN', codeMixed: false,
        reference: 'x', entities: [], speakerId: 'spk-01', environment: 'quiet',
      }],
    });
    const result = await validateCorpus(path);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /not found/.test(i.message))).toBe(true);
  });

  it('refuses an audio path that escapes the corpus directory', async () => {
    const { path } = await writeCorpus({
      utterances: [{
        utteranceId: 'esc', file: '../../../etc/passwd', language: 'en-IN', codeMixed: false,
        reference: 'x', entities: [], speakerId: 'spk-01', environment: 'quiet',
      }],
    });
    const result = await validateCorpus(path);
    expect(result.issues.some((i) => /escapes the corpus directory/.test(i.message))).toBe(true);
  });

  it('detects a silent recording', async () => {
    const { path } = await writeCorpus({}, new Int16Array(32000));
    const result = await validateCorpus(path);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /silent/.test(i.message))).toBe(true);
  });

  it('detects a sample-rate mismatch, which would give providers different audio', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bench-corpus-'));
    await mkdir(join(base, 'audio'), { recursive: true });
    await writeFile(join(base, 'audio', 'u1.wav'), encodeWav(tone(8000, 2000), 8000));
    const path = join(base, 'manifest.json');
    await writeFile(path, JSON.stringify({
      corpusVersion: 'test-1',
      audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16, minDurationMs: 500, maxDurationMs: 60000 },
      consent: [CONSENT],
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false,
        reference: 'x', entities: [], speakerId: 'spk-01', environment: 'quiet',
      }],
    }));
    const result = await validateCorpus(path);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /Sample rate/.test(i.message))).toBe(true);
  });

  it('rejects an utterance whose speaker has no consent record', async () => {
    const { path } = await writeCorpus({
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false,
        reference: 'x', entities: [], speakerId: 'unknown-speaker', environment: 'quiet',
      }],
    });
    const result = await validateCorpus(path);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /No consent record/.test(i.message))).toBe(true);
  });

  it('rejects a corpus whose consent retention has expired', async () => {
    const { path } = await writeCorpus({
      consent: [{ ...CONSENT, retentionUntil: '2020-01-01' }],
    });
    const result = await validateCorpus(path);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /expired/.test(i.message))).toBe(true);
  });

  it('rejects an entity no perfect transcription could satisfy', async () => {
    // An accept-form absent from the reference drags every provider's score
    // down equally and invisibly.
    const { path } = await writeCorpus({
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false,
        reference: 'my notice period is 90 days',
        entities: [{ name: 'ctc', kind: 'money', accept: ['25 lakhs'], unit: 'lakhs' }],
        speakerId: 'spk-01', environment: 'quiet',
      }],
    });
    const result = await validateCorpus(path);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /cannot be satisfied/.test(i.message))).toBe(true);
  });

  it('warns when a numeric entity declares no unit', async () => {
    const { path } = await writeCorpus({
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false,
        reference: 'my notice period is 90 days',
        entities: [{ name: 'notice', kind: 'duration', accept: ['90 days'] }],
        speakerId: 'spk-01', environment: 'quiet',
      }],
    });
    const result = await validateCorpus(path);
    expect(result.issues.some((i) => i.severity === 'warning' && /no unit/.test(i.message))).toBe(true);
  });

  it('flags duplicate utterance ids', async () => {
    const { path } = await writeCorpus({
      utterances: [
        { utteranceId: 'dup', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false, reference: 'x', entities: [], speakerId: 'spk-01', environment: 'quiet' },
        { utteranceId: 'dup', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false, reference: 'x', entities: [], speakerId: 'spk-01', environment: 'quiet' },
      ],
    });
    const result = await validateCorpus(path);
    expect(result.issues.some((i) => /Duplicate/.test(i.message))).toBe(true);
  });
});

describe('corpus loading applies the condition and records provenance', () => {
  it('loads and conditions, recording a checksum per utterance', async () => {
    const { path } = await writeCorpus();
    const loaded = await loadCorpus(path, 'clean_16k');
    expect(loaded.corpusVersion).toBe('test-1');
    expect(loaded.utterances).toHaveLength(1);
    const first = loaded.utterances[0]!;
    expect(first.conditionMeta.checksum).toHaveLength(64);
    expect(first.conditionMeta.sampleRate).toBe(16000);
  });

  it('produces IDENTICAL conditioned audio across loads', async () => {
    // The property that lets a report claim two providers received one input.
    const { path } = await writeCorpus();
    const a = await loadCorpus(path, 'narrowband_8k', { useAmrForNarrowband: false });
    const b = await loadCorpus(path, 'narrowband_8k', { useAmrForNarrowband: false });
    expect(a.utterances[0]!.conditionMeta.checksum).toBe(b.utterances[0]!.conditionMeta.checksum);
  });

  it('refuses to load an utterance with no consent record', async () => {
    const { path } = await writeCorpus({
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN', codeMixed: false,
        reference: 'x', entities: [], speakerId: 'nobody', environment: 'quiet',
      }],
    });
    await expect(loadCorpus(path, 'clean_16k')).rejects.toThrow(/No consent record/);
  });

  it('rejects malformed JSON with a useful message', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bench-corpus-'));
    const path = join(base, 'manifest.json');
    await writeFile(path, '{ not json');
    await expect(validateCorpus(path)).rejects.toThrow(/not valid JSON/);
  });
});

describe('fixture sanity', () => {
  it('created a usable temp corpus', () => {
    expect(dir).toBeTruthy();
  });
});
