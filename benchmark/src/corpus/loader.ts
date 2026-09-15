/**
 * Corpus loading and validation.
 *
 * Validation is aggressive on purpose. Every defect this catches is one that
 * would otherwise show up as a provider looking worse than it is — a silent
 * recording, a stereo file averaged differently by two adapters, an 8 kHz
 * source that can never be used for the clean condition. Those would be
 * attributed to the provider, not to the corpus, and the whole comparison
 * would be quietly wrong.
 *
 * `validateCorpus` makes NO provider calls and costs nothing.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { AudioCondition } from '@platform/providers';

import { decodeWav, leadingSilenceMs, peakLevel, rmsDbfs, toMono } from '../audio/wav.js';
import {
  applyAmrNarrowband,
  applyCondition,
  type ConditionMetadata,
} from '../audio/condition.js';
import {
  ConsentSchema,
  parseManifest,
  type Consent,
  type CorpusManifest,
  type UtteranceInput,
} from './manifest.js';
import { detectScript, scoreEntity, type Script } from '../measure/accuracy.js';
import { requiredProcessorIds } from '../adapters/registry.js';
import { CATEGORY_PURPOSE, coverage } from './coverage.js';
import { MIN_SAMPLES_FOR_VERDICT } from '../measure/verdict.js';

export interface CorpusIssue {
  readonly utteranceId: string | null;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface LoadedUtterance {
  readonly utteranceId: string;
  readonly manifest: UtteranceInput;
  readonly consent: Consent;
  readonly samples: Int16Array;
  readonly sourceSampleRate: number;
  readonly durationMs: number;
}

export interface CorpusValidationResult {
  readonly corpusVersion: string;
  readonly utteranceCount: number;
  /** Real per-utterance durations, so `plan` can price a sweep from fact. */
  readonly durationsMs: Readonly<Record<string, number>>;
  readonly issues: readonly CorpusIssue[];
  readonly valid: boolean;
  /** Counts by language, so a missing Hinglish sub-gate sample is visible. */
  readonly byLanguage: Readonly<Record<string, number>>;
  readonly byEnvironment: Readonly<Record<string, number>>;
}

/** Peak below this is almost certainly a failed recording, not a quiet speaker. */
const SILENT_PEAK = 0.01;
/** Leading silence above this inflates every latency figure. */
const MAX_LEADING_SILENCE_MS = 200;
/** Loudness window around the −23 LUFS target the design asks for. */
const RMS_MIN_DBFS = -33;
const RMS_MAX_DBFS = -12;

/**
 * The shortest per-request audio limit any candidate provider documents.
 *
 * One candidate's real-time REST endpoint documents a hard 30-second cap and
 * routes anything longer to a batch API — which is a different product with
 * different latency, and therefore not the thing this benchmark measures. An
 * utterance over this length cannot be sent to every candidate on equal terms,
 * so the comparison would silently exclude one provider or measure it on a
 * different endpoint.
 *
 * Checked here rather than left to the manifest's own `maxDurationMs`, because
 * a corpus author setting that bound has no reason to know a vendor limit.
 */
const MAX_REALTIME_UTTERANCE_MS = 30_000;

/**
 * Languages whose transcripts can legitimately come back in either alphabet.
 *
 * The three STT adapters are each asked for their own DOCUMENTED configuration
 * on this material — one gets an auto-detect sentinel, one a code-switching
 * mode, one an Indian English locale — and those configurations return
 * different scripts. A romanised reference scored against a Devanagari
 * transcription reports a FLAWLESS transcription as a 125% word error rate.
 *
 * So for these languages the corpus must supply a reference in BOTH alphabets.
 * Without it the sample is UNSCOREABLE for whichever provider returns the other
 * one, and the Hinglish sub-gate — the single strongest reason this benchmark
 * exists — cannot be applied to that provider at all.
 */
const DUAL_SCRIPT_LANGUAGES = new Set(['hi-IN', 'hinglish']);

export async function loadManifest(path: string): Promise<{
  manifest: CorpusManifest;
  baseDir: string;
}> {
  const text = await readFile(path, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Corpus manifest is not valid JSON: ${(error as Error).message}`);
  }
  return { manifest: parseManifest(raw), baseDir: dirname(resolve(path)) };
}

function resolveAudioPath(baseDir: string, file: string): string {
  // A manifest is DATA, from outside this program. It must not be able to name
  // a file outside its own directory — and the containment check has to apply
  // to every path, not only relative ones. Exempting absolute paths (as this
  // did) meant a manifest could simply write an absolute path and be read from
  // anywhere on disk, which is not a weaker check but no check at all.
  if (isAbsolute(file)) {
    throw new Error(
      `Audio path must be relative to the manifest, got an absolute path: ${file}`,
    );
  }
  const base = resolve(baseDir);
  const resolved = resolve(join(base, file));
  // Compare with a trailing separator: a bare prefix test lets a sibling
  // directory whose name merely EXTENDS the base ("/x/corpus-other" against
  // "/x/corpus") pass containment.
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`Audio path escapes the corpus directory: ${file}`);
  }
  return resolved;
}

/**
 * Validate the corpus without touching a provider.
 *
 * Returns every issue rather than throwing on the first, because a founder
 * fixing a corpus wants the whole list, not one error per run.
 */
export async function validateCorpus(manifestPath: string): Promise<CorpusValidationResult> {
  const { manifest, baseDir } = await loadManifest(manifestPath);
  const issues: CorpusIssue[] = [];
  const byLanguage: Record<string, number> = {};
  const byEnvironment: Record<string, number> = {};
  const durationsMs: Record<string, number> = {};

  const consentBySpeaker = new Map(manifest.consent.map((c) => [c.speakerId, c]));
  const seenIds = new Set<string>();

  for (const utterance of manifest.utterances) {
    const id = utterance.utteranceId;

    if (seenIds.has(id)) {
      issues.push({ utteranceId: id, severity: 'error', message: 'Duplicate utteranceId.' });
    }
    seenIds.add(id);

    byLanguage[utterance.language] = (byLanguage[utterance.language] ?? 0) + 1;
    byEnvironment[utterance.environment] = (byEnvironment[utterance.environment] ?? 0) + 1;

    // ---- Consent -----------------------------------------------------------
    const consent = consentBySpeaker.get(utterance.speakerId);
    if (!consent) {
      issues.push({
        utteranceId: id,
        severity: 'error',
        message: `No consent record for speaker "${utterance.speakerId}". Recordings of real people cannot be used without one.`,
      });
    } else {
      const expiry = Date.parse(consent.retentionUntil);
      if (Number.isFinite(expiry) && expiry < Date.now()) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message: `Consent retention for "${consent.speakerId}" expired on ${consent.retentionUntil}. The recording must be deleted, not benchmarked.`,
        });
      }
    }

    // ---- Reference scripts -------------------------------------------------
    if (DUAL_SCRIPT_LANGUAGES.has(utterance.language)) {
      const primary = detectScript(utterance.reference);
      const alternate = utterance.referenceAlt?.trim()
        ? detectScript(utterance.referenceAlt)
        : undefined;
      const scripts = new Set([primary, ...(alternate ? [alternate] : [])]);
      // A genuine pair, not one string that happens to contain both alphabets.
      // "mixed" is NOT accepted as covering both: a romanised sentence with one
      // Devanagari word is mixed, and treating that as satisfying the rule made
      // the rule guard nothing.
      const covers = (script: Script) => scripts.has(script);
      if (alternate === undefined || !covers('latin') || !covers('devanagari')) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message:
            `A ${utterance.language} utterance needs TWO references — a predominantly romanised ` +
            `one and a predominantly Devanagari one. This one supplies ` +
            `${alternate === undefined ? 'only a single reference' : [...scripts].join(' and ')}. ` +
            'Put the romanised form in ' +
            '`reference` and the Devanagari form in `referenceAlt` (or the reverse). The three ' +
            'speech-to-text candidates are each asked for their own documented configuration on ' +
            'code-mixed audio, and those configurations return different scripts: without both, ' +
            'a perfect transcription from one of them is UNSCOREABLE and the Hinglish sub-gate ' +
            'cannot be applied to it.',
        });
      }
    }

    // ---- Entities ----------------------------------------------------------
    for (const entity of utterance.entities) {
      if (
        (entity.kind === 'number' ||
          entity.kind === 'duration' ||
          entity.kind === 'money') &&
        !entity.unit
      ) {
        issues.push({
          utteranceId: id,
          severity: 'warning',
          message: `Entity "${entity.name}" is numeric but declares no unit, so a confidently WRONG value cannot be distinguished from a missing one.`,
        });
      }
      // Satisfiability is tested with the SCORER, not with a substring match.
      //
      // They disagreed, and the disagreement rejected valid corpora: a phone
      // number spoken as "nine eight seven six five" with an accept form of
      // "9876543210" contains no literal substring match, but the scorer folds
      // number words to digits and matches it perfectly. A validator that is
      // stricter than the thing it guards blocks work that would have scored
      // fine — and one that is looser lets through an expectation no
      // transcription can satisfy. Asking the scorer is the only way the two
      // cannot drift apart.
      const references = [
        utterance.reference,
        ...(utterance.referenceAlt ? [utterance.referenceAlt] : []),
      ];
      const satisfiable = references.some(
        (reference) => scoreEntity(reference, entity, {
          aliases: manifest.transliterationAliases,
        }).outcome === 'found',
      );
      if (!satisfiable) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message: `Entity "${entity.name}" has no accepted form present in the reference transcript — the expectation cannot be satisfied even by a perfect transcription.`,
        });
      }
    }

    // ---- Audio -------------------------------------------------------------
    let path: string;
    try {
      path = resolveAudioPath(baseDir, utterance.file);
    } catch (error) {
      issues.push({ utteranceId: id, severity: 'error', message: (error as Error).message });
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch {
      issues.push({
        utteranceId: id,
        severity: 'error',
        message: `Audio file not found: ${utterance.file}`,
      });
      continue;
    }

    try {
      const wav = decodeWav(bytes);
      durationsMs[id] = wav.durationMs;

      if (wav.sampleRate !== manifest.audio.sampleRate) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message: `Sample rate ${wav.sampleRate} Hz does not match the manifest's ${manifest.audio.sampleRate} Hz. Providers must all receive audio derived identically.`,
        });
      }
      if (wav.channels !== 1) {
        issues.push({
          utteranceId: id,
          severity: 'warning',
          message: `File has ${wav.channels} channels; it will be averaged to mono. Record mono to avoid ambiguity.`,
        });
      }
      if (wav.durationMs < manifest.audio.minDurationMs) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message: `Duration ${Math.round(wav.durationMs)} ms is below the ${manifest.audio.minDurationMs} ms minimum.`,
        });
      }
      if (wav.durationMs > manifest.audio.maxDurationMs) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message: `Duration ${Math.round(wav.durationMs)} ms exceeds the ${manifest.audio.maxDurationMs} ms maximum.`,
        });
      }

      const mono = toMono(wav.samples, wav.channels);
      const peak = peakLevel(mono);
      if (peak < SILENT_PEAK) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message: `Recording is effectively silent (peak ${(peak * 100).toFixed(2)}% of full scale). A silent file scores every provider as failing.`,
        });
      }
      if (peak > 0.999) {
        issues.push({
          utteranceId: id,
          severity: 'warning',
          message: 'Recording is clipped at full scale, which degrades every provider unequally.',
        });
      }

      const rms = rmsDbfs(mono);
      if (Number.isFinite(rms) && (rms < RMS_MIN_DBFS || rms > RMS_MAX_DBFS)) {
        issues.push({
          utteranceId: id,
          severity: 'warning',
          message: `Loudness ${rms.toFixed(1)} dBFS RMS is outside the ${RMS_MIN_DBFS}..${RMS_MAX_DBFS} window. Unnormalised audio makes provider AGC behave differently for reasons unrelated to the provider.`,
        });
      }

      if (wav.durationMs > MAX_REALTIME_UTTERANCE_MS) {
        issues.push({
          utteranceId: id,
          severity: 'error',
          message:
            `Duration ${Math.round(wav.durationMs)} ms exceeds the ${MAX_REALTIME_UTTERANCE_MS} ms ` +
            'per-request limit documented by at least one candidate provider\'s real-time endpoint. ' +
            'Longer audio would have to go to that vendor\'s batch API, which is a different ' +
            'product with different latency — so this utterance cannot be put to every candidate ' +
            'on equal terms. Split it into separate turns.',
        });
      }

      const silence = leadingSilenceMs(mono, wav.sampleRate);
      if (silence > MAX_LEADING_SILENCE_MS) {
        issues.push({
          utteranceId: id,
          severity: 'warning',
          message: `${Math.round(silence)} ms of leading silence exceeds ${MAX_LEADING_SILENCE_MS} ms and will inflate every latency figure for this utterance.`,
        });
      }
    } catch (error) {
      issues.push({
        utteranceId: id,
        severity: 'error',
        message: `Audio could not be read: ${(error as Error).message}`,
      });
    }
  }

  issues.push(...consentIssues(manifest));
  issues.push(...cohortIssues(manifest));
  issues.push(...coverageIssues(manifest));

  return {
    corpusVersion: manifest.corpusVersion,
    utteranceCount: manifest.utterances.length,
    durationsMs,
    issues,
    valid: !issues.some((i) => i.severity === 'error'),
    byLanguage,
    byEnvironment,
  };
}

/** Load one utterance's audio, already mono. */
export async function loadUtterance(
  baseDir: string,
  utterance: UtteranceInput,
  consent: Consent,
): Promise<LoadedUtterance> {
  const bytes = await readFile(resolveAudioPath(baseDir, utterance.file));
  const wav = decodeWav(bytes);
  const mono = toMono(wav.samples, wav.channels);
  return {
    utteranceId: utterance.utteranceId,
    manifest: utterance,
    consent,
    samples: mono,
    sourceSampleRate: wav.sampleRate,
    durationMs: (mono.length / wav.sampleRate) * 1000,
  };
}

/** Load every utterance and apply the run's audio condition. */
export async function loadCorpus(
  manifestPath: string,
  condition: AudioCondition,
  options: { useAmrForNarrowband?: boolean } = {},
): Promise<{
  corpusVersion: string;
  /** Caller-supplied equivalences, applied identically to both sides. */
  transliterationAliases: Readonly<Record<string, string>>;
  /** Processors the speakers were told about. Checked before any provider call. */
  disclosedProcessors: readonly string[];
  utterances: readonly (LoadedUtterance & { conditioned: Int16Array; conditionMeta: ConditionMetadata })[];
}> {
  const { manifest, baseDir } = await loadManifest(manifestPath);
  const consentBySpeaker = new Map(manifest.consent.map((c) => [c.speakerId, c]));
  const out = [];

  for (const utterance of manifest.utterances) {
    const consent = consentBySpeaker.get(utterance.speakerId);
    if (!consent) {
      throw new Error(
        `No consent record for speaker "${utterance.speakerId}" (utterance ${utterance.utteranceId}). Refusing to load.`,
      );
    }
    // Re-checked HERE, not only in validateCorpus. `validate` is a separate,
    // optional command, so relying on it alone meant an expired recording could
    // be sent to a provider by anyone who skipped it — and expired consent
    // means the recording must be deleted, not benchmarked.
    const expiry = Date.parse(consent.retentionUntil);
    if (Number.isFinite(expiry) && expiry < Date.now()) {
      throw new Error(
        `Consent retention for speaker "${consent.speakerId}" expired on ${consent.retentionUntil} ` +
          `(utterance ${utterance.utteranceId}). The recording must be deleted, not benchmarked.`,
      );
    }
    const loaded = await loadUtterance(baseDir, utterance, consent);

    const applied =
      condition === 'narrowband_8k' && options.useAmrForNarrowband !== false
        ? await applyAmrNarrowband(loaded.samples, loaded.sourceSampleRate)
        : await applyCondition(loaded.samples, loaded.sourceSampleRate, condition);

    out.push({ ...loaded, conditioned: applied.samples, conditionMeta: applied.metadata });
  }

  return {
    corpusVersion: manifest.corpusVersion,
    transliterationAliases: manifest.transliterationAliases,
    // Union across speakers: a run may only contact a processor EVERY speaker
    // was told about, so the caller intersects rather than unions. Both are
    // returned so the caller can say which speaker's consent is the blocker.
    disclosedProcessors: [...new Set(manifest.consent.flatMap((c) => c.disclosedProcessors))],
    utterances: out,
  };
}

/**
 * Which providers every speaker's consent actually covers.
 *
 * `disclosedProcessors` was a required field that NOTHING read. A consent
 * naming two processors silently permitted a run against a third — which is the
 * one thing the field exists to prevent, and re-consenting means re-contacting
 * every participant.
 */
export async function consentedProcessors(manifestPath: string): Promise<Set<string>> {
  const { manifest } = await loadManifest(manifestPath);
  const perSpeaker = manifest.consent.map(
    (c) => new Set(c.disclosedProcessors.map(disclosedAdapterId)),
  );
  if (perSpeaker.length === 0) return new Set();
  return perSpeaker.reduce((intersection, current) => {
    return new Set([...intersection].filter((name) => current.has(name)));
  });
}

/**
 * The adapter id a disclosed-processor entry refers to.
 *
 * CONVENTION, enforced here and documented in the corpus spec: each entry
 * begins with the adapter id, then prose for the human who signs the form:
 *
 *     "deepgram — Deepgram, United States (no India region available)"
 *
 * Matching on the leading identifier rather than a substring is deliberate. A
 * substring rule would let an entry disclosing only `fake-stt` silently cover
 * an adapter called `fake`, which is the exact class of quiet over-permission
 * this check exists to prevent.
 */
export function normaliseProcessor(name: string): string {
  const leading = name.trim().split(/[\s,;:—–-]|\(/)[0] ?? '';
  return leading.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** The adapter id a consent entry covers, using the same leading-token rule. */
export function disclosedAdapterId(entry: string): string {
  const leading = entry.trim().split(/[\s,;:]|—|–|\(/)[0] ?? '';
  return leading.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * Check consent alone, on a manifest that has no utterances yet.
 *
 * This is the state a scaffolded corpus is in the moment before a recording
 * session, and it is exactly when the check is most useful: a missing processor
 * found now costs a paragraph, and found afterwards costs re-contacting every
 * participant. Requiring a complete corpus first would have made the command
 * useless at the only time it matters.
 */
export async function validateConsentOnly(manifestPath: string): Promise<{
  speakers: number;
  issues: CorpusIssue[];
}> {
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as { consent?: unknown };
  const parsed = z.array(ConsentSchema).min(1).safeParse(raw.consent);
  if (!parsed.success) {
    return {
      speakers: 0,
      issues: [{
        utteranceId: null,
        severity: 'error',
        message:
          'The consent block is missing or malformed: ' +
          parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
      }],
    };
  }
  const issues = consentIssues({ consent: parsed.data } as CorpusManifest);
  // Retention expiry is enforced by `validateCorpus` and again by `loadCorpus`.
  // Omitting it here meant `bench consent` could pass on a corpus that a run
  // would then refuse — the opposite of a pre-flight.
  for (const consent of parsed.data) {
    const expiry = Date.parse(consent.retentionUntil);
    if (Number.isFinite(expiry) && expiry < Date.now()) {
      issues.push({
        utteranceId: null,
        severity: 'error',
        message:
          `Consent retention for "${consent.speakerId}" expired on ${consent.retentionUntil}. ` +
          'The recordings must be deleted, not benchmarked.',
      });
    }
  }
  return { speakers: parsed.data.length, issues };
}

/**
 * Consent must name every processor a run will contact — checked BEFORE
 * recording, not at run time.
 *
 * The run-time check already refuses to contact an undisclosed processor. But
 * discovering that after a recording session means re-contacting every
 * participant, so the same rule is applied here where it costs nothing.
 *
 * The LLM is in this list. It receives the speech-to-text transcript, which is
 * candidate speech content and therefore personal data — it is a processor
 * exactly as the speech vendors are, and it was the one nobody would have
 * thought to disclose.
 */
export function consentIssues(manifest: CorpusManifest): CorpusIssue[] {
  const issues: CorpusIssue[] = [];
  const required: readonly string[] = requiredProcessorIds();

  for (const consent of manifest.consent) {
    const disclosed = new Map(
      consent.disclosedProcessors.map((entry) => [disclosedAdapterId(entry), entry]),
    );

    // An entry whose leading token is not a known adapter id will never be
    // recognised, however clearly a human reads it. Say so, rather than letting
    // it look disclosed while the run refuses to start.
    for (const [id, entry] of disclosed) {
      if (!required.includes(id)) {
        issues.push({
          utteranceId: null,
          severity: 'warning',
          message:
            `Speaker "${consent.speakerId}" discloses "${entry}", which parses to the id "${id}" ` +
            `— not one of ${required.join(', ')}. Each entry must BEGIN with the adapter id, so ` +
            'this one discloses nothing the harness can match. One entry per processor.',
        });
      }
    }

    const missing = required.filter((id) => !disclosed.has(id));
    if (missing.length > 0) {
      issues.push({
        utteranceId: null,
        severity: 'error',
        message:
          `Speaker "${consent.speakerId}" was not told about: ${missing.join(', ')}. Every ` +
          'processor a run will contact must be named in every speaker\'s consent, and each ' +
          'entry must BEGIN with the adapter id followed by prose for the person signing — ' +
          'for example "deepgram — Deepgram, United States (no India region available)". ' +
          'A sweep refuses to contact an undisclosed processor, and fixing this after a ' +
          'recording session means re-contacting every participant.',
      });
    }

    // A scaffolded manifest is full of placeholders, and the check that matters
    // most runs against exactly that state. Treating "DESCRIBE THE PROCESSOR"
    // as a description would report an unfilled form as consented.
    for (const [field, value] of [
      ['obtainedAt', consent.obtainedAt],
      ['retentionUntil', consent.retentionUntil],
      ['deletionContact', consent.deletionContact],
    ] as const) {
      if (/REPLACE|DESCRIBE|YYYY-MM-DD|TODO|<[^>]*>/i.test(value)) {
        issues.push({
          utteranceId: null,
          severity: 'error',
          message:
            `Speaker "${consent.speakerId}" still has the scaffold placeholder in ` +
            `${field}: "${value}". Consent that has not been filled in is not consent.`,
        });
      }
    }
    for (const field of ['obtainedAt', 'retentionUntil'] as const) {
      if (!Number.isFinite(Date.parse(consent[field]))) {
        issues.push({
          utteranceId: null,
          severity: 'error',
          message:
            `Speaker "${consent.speakerId}" has ${field}="${consent[field]}", which is not a date ` +
            'this can parse. Retention expiry is enforced before every load, and an unparseable ' +
            'date silently disables that check.',
        });
      }
    }

    for (const [id, entry] of disclosed) {
      // The id alone does not tell a person signing the form where their voice
      // goes, which is the whole purpose of the disclosure.
      const prose = entry.slice(id.length).replace(/^[\s—–:,;-]+/, '').trim();
      if (/REPLACE|DESCRIBE THE PROCESSOR|TODO|<[^>]*>/i.test(prose)) {
        issues.push({
          utteranceId: null,
          severity: 'error',
          message:
            `Speaker "${consent.speakerId}" still has the scaffold placeholder for "${id}". ` +
            'Say who the processor is and where it processes — PROVIDER_CREDENTIAL_SETUP.md has ' +
            'the wording for each, including the ones whose location is not documented at all.',
        });
        continue;
      }
      if (prose.length < 3) {
        issues.push({
          utteranceId: null,
          severity: 'error',
          message:
            `Speaker "${consent.speakerId}" discloses "${entry}" with no description. An entry ` +
            'must say who the processor is and where it processes, because that is what the ' +
            'person signing is consenting to. Where a provider does not document its processing ' +
            'location, say so in those words rather than leaving it blank.',
        });
      }
    }
  }
  return issues;
}

/**
 * Warn when a cohort is too small to reach a verdict.
 *
 * Derived from `MIN_SAMPLES_FOR_VERDICT`, not a new requirement: a cohort at
 * exactly the floor has NO margin, so one hard failure or one unscoreable
 * sample takes it below and the whole run for that cohort is INCOMPLETE.
 */
export function cohortIssues(manifest: CorpusManifest): CorpusIssue[] {
  const issues: CorpusIssue[] = [];
  const count = (predicate: (u: UtteranceInput) => boolean) =>
    manifest.utterances.filter(predicate).length;

  const cohorts: [string, number][] = [
    ['quiet', count((u) => u.environment === 'quiet')],
    ['noisy', count((u) => u.environment === 'noisy')],
    ['code-mixed (the Hinglish sub-gate)', count((u) => u.codeMixed)],
  ];
  if (manifest.utterances.length === 0) return issues;

  for (const [name, size] of cohorts) {
    if (size === 0) {
      // An ABSENT cohort is worse than a small one, and it used to produce no
      // message at all. With no code-mixed utterances the Hinglish sub-gate —
      // the strongest reason this benchmark exists — silently never applies,
      // and a run passes without ever testing the traffic it was built for.
      //
      // It is an ERROR only for a corpus large enough to be a DECIDING one. A
      // one-utterance smoke corpus obviously is not testing the sub-gate, and
      // making the first-contact check impossible would push people to skip it.
      const deciding = manifest.utterances.length >= MIN_SAMPLES_FOR_VERDICT;
      issues.push({
        utteranceId: null,
        severity: name.includes('code-mixed') && deciding ? 'error' : 'warning',
        message:
          `The ${name} cohort is EMPTY. ` +
          (name.includes('code-mixed')
            ? 'The Hinglish sub-gate cannot be applied at all, so a stack could pass without ' +
              'ever being tested on code-mixed speech. Set codeMixed: true on the utterances ' +
              'that genuinely switch language.'
            : 'That condition will not be measured.'),
      });
      continue;
    }
    if (size < MIN_SAMPLES_FOR_VERDICT) {
      issues.push({
        utteranceId: null,
        severity: 'warning',
        message:
          `The ${name} cohort has ${size} utterances; the decision rule needs ` +
          `${MIN_SAMPLES_FOR_VERDICT} successful samples, so this cohort cannot reach a PASS.`,
      });
    } else if (size < MIN_SAMPLES_FOR_VERDICT + 3) {
      issues.push({
        utteranceId: null,
        severity: 'warning',
        message:
          `The ${name} cohort has ${size} utterances against a floor of ` +
          `${MIN_SAMPLES_FOR_VERDICT} — almost no margin. One hard failure or one unscoreable ` +
          'sample drops it below the floor and the whole cohort reports INCOMPLETE. Spare takes ' +
          'are cheap; a wasted sweep is not.',
      });
    }
  }
  return issues;
}

/**
 * The specification's entity-category minimums, checked.
 *
 * Stated in `CORPUS_RECORDING_SPEC.md` section 4 and enforced nowhere until
 * now. It is an ERROR only for a corpus large enough to be the DECIDING one —
 * a smoke corpus of one utterance obviously does not carry ten names, and
 * making the first-contact check impossible would push people to skip it.
 */
export function coverageIssues(manifest: CorpusManifest): CorpusIssue[] {
  if (manifest.utterances.length === 0) return [];
  const deciding = manifest.utterances.length >= MIN_SAMPLES_FOR_VERDICT;
  const rows = coverage(manifest.utterances.flatMap((u) => u.entities));

  return rows
    .filter((row) => row.short > 0)
    .map((row) => ({
      utteranceId: null,
      severity: deciding ? ('error' as const) : ('warning' as const),
      message:
        `Entity category "${row.kind}" has ${row.present} of the ${row.required} the ` +
        `specification requires — ${row.short} short. That category covers ` +
        `${CATEGORY_PURPOSE[row.kind]}. A corpus below the minimum cannot support a ` +
        'conclusion about that category, and the shortfall is invisible once the sweep has run.',
    }));
}
