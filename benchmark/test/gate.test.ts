/**
 * Tests for the six approved benchmark-gate decisions.
 *
 * Region, consent, dual-script references, cohort margin, the recording
 * workflow, and the Gemini adapter's documented request shape. Each one is here
 * because it is a rule that decides whether a run means anything, and none of
 * them contacts a provider.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_REGIONS, REGION_ENV_VAR, RegionError, declaredRegion, requireRegion,
} from '../src/config/region.js';
import { validateCorpus } from '../src/corpus/loader.js';
import { allocate, coverage, CATEGORY_MINIMUMS } from '../src/corpus/coverage.js';
import { buildScaffold, NOISY_CONVERSATIONS, TURNS_PER_CONVERSATION } from '../src/corpus/scaffold.js';
import {
  WorksheetError, parseEntities, parseWorksheet, renderEntities, renderWorksheet, unfilledRows,
} from '../src/corpus/worksheet.js';
import { requiredProcessorIds, LLM_ADAPTERS, REQUIRED_ENV } from '../src/adapters/registry.js';
import { createGeminiLlm, toGeminiContents } from '../src/adapters/gemini/index.js';
import { ADAPTER_DEFECT, classify } from '../src/measure/failures.js';
import { HttpError } from '../src/adapters/http.js';
import { compatibilityReasons } from '../src/results/pool.js';
import { encodeWav } from '../src/audio/wav.js';
import type { RunMetadata } from '../src/results/store.js';

// ---------------------------------------------------------------------------
// C. Region
// ---------------------------------------------------------------------------

describe('the benchmark region is pre-registered and required', () => {
  it('accepts only BLR1', () => {
    expect(ALLOWED_REGIONS).toEqual(['BLR1']);
    expect(requireRegion({ [REGION_ENV_VAR]: 'BLR1' })).toBe('BLR1');
    expect(requireRegion({ [REGION_ENV_VAR]: 'blr1' })).toBe('BLR1');
  });

  it('refuses to run with no region declared', () => {
    // A latency figure that cannot be tied to where it was produced is an
    // assertion about latency, not a measurement of it.
    expect(() => requireRegion({})).toThrow(RegionError);
    expect(() => requireRegion({})).toThrow(/is not set/);
  });

  it('refuses a region that was not pre-registered', () => {
    expect(() => requireRegion({ [REGION_ENV_VAR]: 'BOM1' })).toThrow(/not a pre-registered/);
  });

  it('never guesses a region from anything else', () => {
    expect(declaredRegion({})).toBeUndefined();
    expect(declaredRegion({ [REGION_ENV_VAR]: '   ' })).toBeUndefined();
  });

  it('refuses to pool runs from different regions', () => {
    const base = (region?: string) => ({
      directory: 'd',
      rows: [],
      metadata: {
        runId: 'r', benchmarkVersion: 'v', profile: 'p', startedAt: 'now',
        corpus: { manifestPath: 'm', corpusVersion: 'c', utteranceCount: 1, condition: 'narrowband_8k', inputChecksums: {} },
        subject: { kind: 'stt', adapterId: 'a', adapterVersion: '1', model: 'm', unverified: true, streaming: false },
        configuration: { maxRetries: 2, concurrency: 1, maxCalls: 10, drainTts: false, seed: 1 },
        environment: {
          node: 'v', platform: 'p', arch: 'a', gitCommit: null, gitDirty: null,
          ffmpeg: null, host: 'h', ...(region ? { region } : {}),
        },
      } as RunMetadata,
    });
    const reasons = compatibilityReasons([base('BLR1'), base('BOM1')]);
    expect(reasons.join(' ')).toMatch(/Benchmark region differs/);
  });
});

// ---------------------------------------------------------------------------
// B. Consent — including the LLM
// ---------------------------------------------------------------------------

describe('consent must name every processor, including the LLM', () => {
  const speaker = (processors: readonly string[]) => ({
    speakerId: 'spk-01', obtainedAt: '2026-08-01', coversCrossBorderTransfer: true as const,
    disclosedProcessors: [...processors], retentionUntil: '2027-08-01',
    deletionContact: 'privacy@example.test',
  });

  async function corpusWith(processors: readonly string[]): Promise<string> {
    const base = await mkdtemp(join(tmpdir(), 'bench-gate-'));
    await mkdir(join(base, 'audio'), { recursive: true });
    const samples = new Int16Array(16000 * 2);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(6000 * Math.sin(i / 8));
    await writeFile(join(base, 'audio', 'u1.wav'), encodeWav(samples, 16000));
    const path = join(base, 'manifest.json');
    await writeFile(path, JSON.stringify({
      corpusVersion: 'c1',
      audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      consent: [speaker(processors)],
      utterances: [{
        utteranceId: 'u1', file: 'audio/u1.wav', language: 'en-IN',
        reference: 'hello there', speakerId: 'spk-01',
      }],
    }), 'utf8');
    return path;
  }

  it('lists the LLM among the processors a sweep will contact', () => {
    // The LLM receives the speech-to-text transcript — candidate speech
    // content, and therefore personal data. It is the processor nobody would
    // have thought to disclose.
    expect(requiredProcessorIds()).toContain('gemini');
    expect(Object.keys(LLM_ADAPTERS)).toEqual(['gemini']);
  });

  it('fails validation BEFORE recording when a processor is undisclosed', async () => {
    const path = await corpusWith(['sarvam — Sarvam AI, location undocumented']);
    const result = await validateCorpus(path);
    const consent = result.issues.filter((i) => i.utteranceId === null && i.severity === 'error');
    expect(consent.length).toBeGreaterThan(0);
    expect(consent.map((i) => i.message).join(' ')).toMatch(/gemini/);
  });

  it('rejects a disclosure that names an id but says nothing about it', async () => {
    // "gemini" alone does not tell a person signing where their voice goes,
    // which is the entire purpose of the disclosure.
    const path = await corpusWith(requiredProcessorIds().map((id) => id));
    const result = await validateCorpus(path);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/with no description/);
  });

  it('accepts a complete disclosure', async () => {
    const path = await corpusWith(
      requiredProcessorIds().map((id) => `${id} — Vendor, processing location stated here`),
    );
    const result = await validateCorpus(path);
    const consent = result.issues.filter((i) => i.utteranceId === null && i.severity === 'error');
    expect(consent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A. Dual-script references and cohort margin
// ---------------------------------------------------------------------------

describe('code-mixed utterances need a reference in both alphabets', () => {
  async function corpusWithUtterance(utterance: Record<string, unknown>): Promise<string> {
    const base = await mkdtemp(join(tmpdir(), 'bench-script-'));
    await mkdir(join(base, 'audio'), { recursive: true });
    const samples = new Int16Array(16000 * 2);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(6000 * Math.sin(i / 8));
    await writeFile(join(base, 'audio', 'u1.wav'), encodeWav(samples, 16000));
    const path = join(base, 'manifest.json');
    await writeFile(path, JSON.stringify({
      corpusVersion: 'c1',
      audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      consent: [{
        speakerId: 'spk-01', obtainedAt: '2026-08-01', coversCrossBorderTransfer: true,
        disclosedProcessors: requiredProcessorIds().map((id) => `${id} — Vendor, location stated`),
        retentionUntil: '2027-08-01', deletionContact: 'privacy@example.test',
      }],
      utterances: [{ file: 'audio/u1.wav', speakerId: 'spk-01', ...utterance }],
    }), 'utf8');
    return path;
  }

  it('rejects a Hinglish utterance with only a romanised reference', async () => {
    // Measured before the fix: a FLAWLESS Devanagari transcription scored 125%
    // word error against a romanised reference, because the three adapters are
    // each asked for their own documented configuration and those return
    // different alphabets.
    const path = await corpusWithUtterance({
      utteranceId: 'u1', language: 'hinglish', codeMixed: true,
      reference: 'meri current ctc twelve lakhs hai',
    });
    const result = await validateCorpus(path);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/needs TWO references/);
    expect(result.valid).toBe(false);
  });

  it('is not satisfied by ONE reference that happens to contain both alphabets', async () => {
    // A romanised sentence with a single Devanagari word used to detect as
    // "mixed", and "mixed" was treated as covering both — so the rule guarded
    // nothing and the providers configured to return Devanagari were still
    // scored against romanised text.
    const path = await corpusWithUtterance({
      utteranceId: 'u1', language: 'hinglish', codeMixed: true,
      reference: 'meri current ctc बारह lakhs hai aur expected fifteen lakhs per annum',
    });
    const result = await validateCorpus(path);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/needs TWO references/);
  });

  it('accepts one with both', async () => {
    const path = await corpusWithUtterance({
      utteranceId: 'u1', language: 'hinglish', codeMixed: true,
      reference: 'meri current ctc twelve lakhs hai',
      referenceAlt: 'मेरी करंट सीटीसी बारह लाख है',
    });
    const result = await validateCorpus(path);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('does not demand an alternate for Indian English', async () => {
    const path = await corpusWithUtterance({
      utteranceId: 'u1', language: 'en-IN', reference: 'my notice period is ninety days',
    });
    const result = await validateCorpus(path);
    expect(result.issues.map((i) => i.message).join(' ')).not.toMatch(/BOTH alphabets/);
  });

  it('warns when a cohort sits at the verdict floor with no margin', async () => {
    const path = await corpusWithUtterance({
      utteranceId: 'u1', language: 'en-IN', environment: 'noisy',
      reference: 'my notice period is ninety days',
    });
    const result = await validateCorpus(path);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/cannot reach a PASS/);
  });
});

// ---------------------------------------------------------------------------
// A. Entity-category coverage — the specification's own minimums
// ---------------------------------------------------------------------------

describe('the specification\'s entity minimums are enforced, not just written down', () => {
  it('allocates exactly the required categories across the quiet slots', () => {
    // Deciding WHAT a speaker says is ground truth. Deciding WHICH category
    // belongs in which slot is arithmetic, and doing it by hand across eighty
    // slots is how a corpus quietly ends up with four dates.
    const quiet = 55;
    const allocated = allocate(quiet).flat();
    for (const [kind, required] of Object.entries(CATEGORY_MINIMUMS)) {
      expect(allocated.filter((k) => k === kind).length, kind).toBe(required);
    }
    expect(allocate(quiet)).toHaveLength(quiet);
  });

  it('reports how far short each category is', () => {
    const rows = coverage([{ kind: 'date' as const }, { kind: 'date' as const }]);
    const date = rows.find((r) => r.kind === 'date');
    expect(date).toEqual({ kind: 'date', required: 8, present: 2, short: 6 });
  });

  it('is an ERROR for a deciding-sized corpus and a warning for a smoke corpus', async () => {
    const build = async (count: number): Promise<string> => {
      const base = await mkdtemp(join(tmpdir(), 'bench-cov-'));
      await mkdir(join(base, 'audio'), { recursive: true });
      const samples = new Int16Array(16000 * 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(6000 * Math.sin(i / 8));
      await writeFile(join(base, 'audio', 'u.wav'), encodeWav(samples, 16000));
      const path = join(base, 'manifest.json');
      await writeFile(path, JSON.stringify({
        corpusVersion: 'c1',
        audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
        consent: [{
          speakerId: 's1', obtainedAt: '2026-08-01', coversCrossBorderTransfer: true,
          disclosedProcessors: requiredProcessorIds().map((id) => `${id} — Vendor, location stated`),
          retentionUntil: '2027-08-01', deletionContact: 'x@example.invalid',
        }],
        utterances: Array.from({ length: count }, (_, i) => ({
          utteranceId: `u${i}`, file: 'audio/u.wav', language: 'en-IN',
          reference: 'my notice period is ninety days', speakerId: 's1', codeMixed: true,
        })),
      }), 'utf8');
      return path;
    };

    const smoke = await validateCorpus(await build(1));
    expect(smoke.issues.filter((i) => i.severity === 'error' && /Entity category/.test(i.message)))
      .toEqual([]);

    const deciding = await validateCorpus(await build(25));
    const short = deciding.issues.filter(
      (i) => i.severity === 'error' && /Entity category/.test(i.message),
    );
    expect(short.length).toBeGreaterThan(0);
    expect(deciding.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Recording workflow
// ---------------------------------------------------------------------------

describe('the recording scaffold generates structure and no content', () => {
  const built = () => buildScaffold({ corpusVersion: 'v1', speakerIds: ['spk-a', 'spk-b'] });

  it('produces the specified counts', () => {
    const { rows } = built();
    const quiet = rows.filter((r) => r.environment === 'quiet');
    const noisy = rows.filter((r) => r.environment === 'noisy');
    // 11 quiet conversations x 5 turns, per CORPUS_RECORDING_SPEC section 1.
    expect(quiet).toHaveLength(55);
    expect(quiet.filter((r) => r.language === 'en-IN')).toHaveLength(20);
    expect(quiet.filter((r) => r.language === 'hi-IN')).toHaveLength(15);
    expect(quiet.filter((r) => r.language === 'hinglish')).toHaveLength(20);
    // The noisy cohort carries a margin conversation: four would be EXACTLY the
    // verdict floor, where one failed sample makes the whole cohort INCOMPLETE.
    expect(noisy).toHaveLength(NOISY_CONVERSATIONS * TURNS_PER_CONVERSATION);
    expect(noisy.filter((r) => r.notes.startsWith('MARGIN'))).toHaveLength(TURNS_PER_CONVERSATION);
  });

  it('writes no reference text — that is ground truth, and it is human', () => {
    const { rows } = built();
    expect(rows.every((r) => r.reference === '' && r.referenceAlt === '')).toBe(true);
    expect(unfilledRows(rows)).toHaveLength(rows.length);
  });

  it('pre-fills the consent block with every processor a sweep will contact', () => {
    const { manifest } = built();
    const consent = (manifest['consent'] as { disclosedProcessors: string[] }[])[0];
    for (const id of requiredProcessorIds()) {
      expect(consent?.disclosedProcessors.join(' ')).toContain(id);
    }
  });

  it('refuses a single-speaker corpus', () => {
    // One voice measures how well a provider handles that person.
    expect(() => buildScaffold({ corpusVersion: 'v1', speakerIds: ['only-one'] }))
      .toThrow(/at least two speakers/i);
  });

  it('caps utterance length at the documented provider limit', () => {
    const { manifest } = built();
    expect((manifest['audio'] as { maxDurationMs: number }).maxDurationMs).toBe(30_000);
  });
});

describe('the worksheet round-trips without losing anything', () => {
  it('survives render then parse', () => {
    const { rows } = buildScaffold({ corpusVersion: 'v1', speakerIds: ['a', 'b'] });
    const filled = rows.slice(0, 3).map((r) => ({
      ...r,
      reference: 'my notice period is ninety days',
      referenceAlt: r.language === 'en-IN' ? '' : 'मेरा नोटिस पीरियड नब्बे दिन है',
      entities: [{
        name: 'notice_period', kind: 'duration' as const,
        accept: ['ninety days', '90 days'], unit: 'days',
      }],
    }));
    const parsed = parseWorksheet(renderWorksheet(filled));
    expect(parsed).toEqual(filled);
  });

  it('parses the entity DSL, including optional unit and reject', () => {
    const entities = parseEntities(
      'notice|duration|90 days/ninety days|days;relocate|text|can relocate||cannot relocate', 2,
    );
    expect(entities).toHaveLength(2);
    expect(entities[0]).toEqual({
      name: 'notice', kind: 'duration', accept: ['90 days', 'ninety days'], unit: 'days',
    });
    expect(entities[1]?.reject).toEqual(['cannot relocate']);
  });

  it('round-trips a delimiter INSIDE a value — "CI/CD" is in our own line set', () => {
    // Unescaped, "CI/CD" split into "CI" and "CD": a corrupted expectation no
    // provider could satisfy, scored against all of them, invisible in output.
    const entities = [
      { name: 'skills', kind: 'text' as const, accept: ['CI/CD', 'PostgreSQL'] },
      {
        name: 'ctc', kind: 'money' as const, accept: ['12 lakhs'], unit: 'lakhs',
        reject: ['no|pipe', 'semi;colon'],
      },
      { name: 'path', kind: 'text' as const, accept: ['back\\slash'] },
    ];
    expect(parseEntities(renderEntities(entities), 2)).toEqual(entities);
  });

  it('names the row and the problem rather than mis-parsing quietly', () => {
    expect(() => parseEntities('notice|duration', 7)).toThrow(/Row 7/);
    expect(() => parseEntities('notice|nonsense|x', 7)).toThrow(/not one of/);
    expect(() => parseEntities('notice|duration|', 7)).toThrow(/no accepted forms/);
  });

  it('refuses a tab inside a cell, which would shift every later column', () => {
    const { rows } = buildScaffold({ corpusVersion: 'v1', speakerIds: ['a', 'b'] });
    const broken = [{ ...(rows[0] as (typeof rows)[number]), reference: 'has\ta tab' }];
    expect(() => renderWorksheet(broken)).toThrow(WorksheetError);
  });

  it('refuses a header with a column removed', () => {
    expect(() => parseWorksheet('utteranceId\treference\nu1\thello')).toThrow(/missing/);
  });
});

// ---------------------------------------------------------------------------
// The Gemini adapter — request shape only, nothing contacted
// ---------------------------------------------------------------------------

describe('the Gemini adapter matches the documented request shape', () => {
  let captured: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const original = globalThis.fetch;

  beforeEach(() => {
    captured = [];
    process.env['GEMINI_API_KEY'] = 'test-key-not-real';
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
      captured.push({ url: String(url), headers, body: init?.body });
      const frames = [
        'data: {"candidates":[{"content":{"parts":[{"text":"What is"}],"role":"model"}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" your notice period?"}],"role":"model"}}]}',
      ].join('\n\n') + '\n\n';
      return new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = original;
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_MODEL'];
  });

  it('maps our roles onto the ones Google documents', () => {
    // `assistant` appears nowhere in Google's docs — it is an OpenAI
    // convention, and sending it would be pattern-matching from another vendor.
    const mapped = toGeminiContents([
      { role: 'system', content: 'You are screening.' },
      { role: 'user', content: 'ninety days' },
      { role: 'assistant', content: 'And your salary?' },
    ]);
    expect(mapped.contents.map((c) => c.role)).toEqual(['user', 'model']);
    expect(JSON.stringify(mapped)).not.toContain('assistant');
    // The system instruction is a Content object with parts, not a string.
    expect(mapped.systemInstruction?.parts[0]?.text).toBe('You are screening.');
  });

  it('authenticates with the documented header, never a query parameter', async () => {
    const adapter = createGeminiLlm();
    for await (const _ of adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })) break;
    expect(captured[0]?.headers['x-goog-api-key']).toBe('test-key-not-real');
    expect(captured[0]?.url).not.toMatch(/[?&]key=/);
  });

  it('calls the documented streaming endpoint with alt=sse', async () => {
    const adapter = createGeminiLlm();
    for await (const _ of adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })) break;
    expect(captured[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse',
    );
  });

  it('reads incremental text from the documented path', async () => {
    const adapter = createGeminiLlm();
    const chunks: string[] = [];
    for await (const chunk of adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk.text);
    }
    expect(chunks.join('')).toBe('What is your notice period?');
  });

  it('reports a blocked prompt as a PROVIDER outcome, not our defect', async () => {
    // Documented: "If set, the prompt was blocked and no candidates are
    // returned." Filing that as an adapter defect would excuse the provider
    // from a refusal it actually made — and it excludes the sample from the
    // failure gate, which is the opposite of what a refusal deserves.
    globalThis.fetch = (async () =>
      new Response('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n', { status: 200 })
    ) as typeof fetch;
    const adapter = createGeminiLlm();
    let thrown: unknown;
    try {
      for await (const _ of adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    } catch (error) { thrown = error; }
    expect((thrown as Error).message).toMatch(/refused to answer: SAFETY/);
    expect(classify(thrown)).toBe('empty_response');
    expect(ADAPTER_DEFECT.has(classify(thrown))).toBe(false);
  });

  it('parses frames whichever line ending the server uses', async () => {
    // The SSE specification permits LF, CR or CRLF. Splitting on a hard-coded
    // "\n\n" dispatched NO frame at all on a CRLF stream: the whole response
    // accumulated, was discarded, and reported as an adapter defect — costing
    // the entire end-to-end sweep, silently, until the report.
    for (const separator of ['\n\n', '\r\n\r\n', '\r\r']) {
      const frames = [
        'data: {"candidates":[{"content":{"parts":[{"text":"What is"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" your notice period?"}]}}]}',
      ].join(separator) + separator;
      globalThis.fetch = (async () => new Response(
        frames.replace(/\n/g, separator.includes('\r\n') ? '\n' : '\n'), { status: 200 },
      )) as typeof fetch;
      const adapter = createGeminiLlm();
      const out: string[] = [];
      for await (const chunk of adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })) {
        out.push(chunk.text);
      }
      expect(out.join(''), `separator ${JSON.stringify(separator)}`)
        .toBe('What is your notice period?');
    }
  });

  it('does not drop a final frame that has no trailing blank line', async () => {
    globalThis.fetch = (async () => new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"last words"}]}}]}', { status: 200 },
    )) as typeof fetch;
    const adapter = createGeminiLlm();
    const out: string[] = [];
    for await (const chunk of adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })) {
      out.push(chunk.text);
    }
    expect(out.join('')).toBe('last words');
  });

  it('records that its residency is undocumented, like the speech adapters', () => {
    const parameters = createGeminiLlm().identity.parameters ?? {};
    expect(parameters['dataResidency']).toMatch(/NOT DOCUMENTED/);
    expect(createGeminiLlm().identity.unverified).toBe(true);
  });

  it('declares the environment variable it reads', () => {
    expect(REQUIRED_ENV['gemini']).toEqual(['GEMINI_API_KEY']);
  });
});

describe('Gemini returns 429 for BOTH transient limits and a hard quota wall', () => {
  it('stops the sweep on the envelope Google ACTUALLY sends for a daily wall', () => {
    // An earlier version matched the literal `quota_exceeded`, which Google
    // never emits — so a daily wall classified as retryable and the sweep
    // hammered an exhausted quota. The real discriminator is the quotaId.
    const body = JSON.stringify({
      error: {
        code: 429, status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota, please check your plan and billing details.',
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
      },
    });
    expect(classify(new HttpError(429, 'Too Many Requests', body))).toBe('quota');
  });

  it('keeps enough of the body for the discriminator to survive', () => {
    // The quotaId sits past the 500th character of a real envelope. Truncating
    // at 400 removed it, and a spend wall became a retry loop.
    const padded = JSON.stringify({
      error: {
        code: 429, status: 'RESOURCE_EXHAUSTED', message: 'x'.repeat(600),
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProject' }] }],
      },
    });
    expect(padded.length).toBeGreaterThan(600);
    expect(classify(new HttpError(429, 'Too Many Requests', padded))).toBe('quota');
  });

  it('does not stop on a per-minute limit, whose message ALSO says "quota exceeded"', () => {
    const body = JSON.stringify({
      error: {
        code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per minute',
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProject' }] }],
      },
    });
    expect(classify(new HttpError(429, 'Too Many Requests', body))).toBe('transient_transport');
  });

  it('treats an unqualified 429 as transient rather than abandoning the run', () => {
    // Retries are bounded and rejected requests are not billed, so guessing
    // "transient" costs time; guessing "wall" abandons a run that would have
    // finished.
    const body = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
    expect(classify(new HttpError(429, 'Too Many Requests', body))).toBe('transient_transport');
  });

  it('treats an invalid key as auth, which is a 401 here rather than a 403', () => {
    expect(classify(new HttpError(401, 'Unauthorized', 'API key not valid'))).toBe('auth');
  });
});
