/**
 * The corpus manifest — the machine-readable description of what the benchmark
 * feeds providers.
 *
 * Everything here is validated with Zod and `.strict()`, so a typo in a
 * manifest fails loudly at load rather than silently changing what is measured.
 * A corpus that cannot be validated cannot produce a defensible result, and the
 * whole point of this phase is defensibility.
 *
 * CONSENT IS A REQUIRED FIELD, not an optional courtesy. These are voice
 * recordings of real people; under the DPDP Act they are personal data, and
 * cross-border transfer must be covered because several candidate providers
 * process outside India.
 */

import { z } from 'zod';

/** Languages the corpus distinguishes. `hinglish` is deliberately its own label. */
export const CorpusLanguage = z.enum(['en-IN', 'hi-IN', 'hinglish']);
export type CorpusLanguage = z.infer<typeof CorpusLanguage>;

/**
 * Entity kinds.
 *
 * Kind drives HOW a match is judged. A number needs boundary-safe comparison
 * (so "19 years" never satisfies "9 years"); a name needs to survive
 * transliteration variance; a phone number needs digits compared with
 * separators ignored. Treating them all as strings is what produced the
 * substring defect the design document records.
 */
export const EntityKind = z.enum([
  'number',
  'duration',
  'money',
  'name',
  'date',
  'phone',
  'location',
  'text',
]);
export type EntityKind = z.infer<typeof EntityKind>;

export const EntityExpectationSchema = z
  .object({
    /** Stable identifier used in reports: "notice_period", "years_experience". */
    name: z.string().min(1).max(64),
    kind: EntityKind,
    /** Any of these surface forms counts as captured. */
    accept: z.array(z.string().min(1)).min(1),
    /**
     * Unit token for numeric kinds ("days", "years", "lakhs").
     *
     * When present, a DIFFERENT value adjacent to this unit is scored WRONG
     * rather than merely missing — a wrong notice period silently rejects a
     * qualified candidate, where a missing one only makes the agent re-ask.
     */
    unit: z.string().min(1).max(32).optional(),
    /**
     * Surface forms that must NOT be present.
     *
     * Accept-lists cannot express negation: "I cannot relocate" contains
     * "relocate". Where meaning inverts, list the inverting forms here.
     */
    reject: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type EntityExpectationInput = z.infer<typeof EntityExpectationSchema>;

/** Consent, recorded per speaker rather than per file. */
export const ConsentSchema = z
  .object({
    /** Pseudonymous speaker id. NEVER a real name — this manifest is committed. */
    speakerId: z.string().min(1).max(64),
    /** ISO 8601 date the consent was given. */
    obtainedAt: z.string().min(8),
    /**
     * Must be true. Several candidate providers process outside India, so a
     * consent that does not cover transfer makes the corpus unusable for them
     * — and re-consenting means re-contacting every participant.
     */
    coversCrossBorderTransfer: z.literal(true),
    /**
     * Named processors and their countries, as shown to the speaker.
     *
     * CHECKED BEFORE ANY PROVIDER CALL. Each entry must BEGIN with the adapter
     * id the run will use, followed by prose for the human signing the form:
     *
     *     "deepgram — Deepgram, United States (no India region available)"
     *
     * A sweep refuses to contact an adapter that is not named by EVERY
     * speaker's consent. This field was previously required and read by
     * nothing, so a consent naming two processors silently permitted a run
     * against a third — and under the DPDP Act that is the difference between a
     * lawful corpus and one that must be re-consented participant by
     * participant.
     */
    disclosedProcessors: z.array(z.string().min(1)).min(1),
    /** ISO 8601 date after which the recording must be deleted. */
    retentionUntil: z.string().min(8),
    /** How the speaker can request deletion. */
    deletionContact: z.string().min(1),
  })
  .strict();
export type Consent = z.infer<typeof ConsentSchema>;

export const UtteranceSchema = z
  .object({
    /** Stable within a corpus version. Appears in every raw result row. */
    utteranceId: z.string().min(1).max(128),
    /** Path relative to the manifest's directory. */
    file: z.string().min(1),
    language: CorpusLanguage,
    /**
     * True when the utterance deliberately code-switches.
     *
     * Separate from `language: 'hinglish'` because an `en-IN` answer can still
     * contain a Hindi word, and the Hinglish sub-gate needs to know which
     * utterances actually exercise code-switching.
     */
    codeMixed: z.boolean().default(false),
    /** Ground truth. What a perfect transcription would produce. */
    reference: z.string().min(1),
    /**
     * The SAME utterance written in the other alphabet.
     *
     * Required in practice for code-mixed audio, because the three STT
     * candidates are each asked for their own documented configuration and
     * those configurations return different scripts. Without a reference in the
     * script a provider was configured to produce, a flawless transcription
     * scores as a total failure — measured at 125% word error rate.
     *
     * The scorer picks whichever reference shares the transcript's alphabet.
     * If neither does, the sample is recorded as UNSCOREABLE and excluded,
     * rather than counted against the provider.
     */
    referenceAlt: z.string().min(1).optional(),
    entities: z.array(EntityExpectationSchema).default([]),
    speakerId: z.string().min(1).max(64),
    /** Free-text note about the recording environment, for later analysis. */
    environment: z.enum(['quiet', 'noisy']).default('quiet'),
    /** Which conversation this belongs to, so multi-turn context is preserved. */
    conversationId: z.string().min(1).max(128).optional(),
    /** Position within that conversation, 0-based. */
    turnIndex: z.number().int().min(0).optional(),
  })
  .strict();
export type UtteranceInput = z.infer<typeof UtteranceSchema>;

export const CorpusManifestSchema = z
  .object({
    /**
     * Corpus version. Bumped whenever audio or references change.
     *
     * Recorded in every run so a result can never be compared against a
     * different corpus without it being obvious.
     */
    corpusVersion: z.string().min(1).max(64),
    description: z.string().max(2000).default(''),
    /** Expected audio properties. Every file is checked against these. */
    audio: z
      .object({
        sampleRate: z.number().int().min(8000).max(48000),
        channels: z.literal(1),
        bitsPerSample: z.literal(16),
        minDurationMs: z.number().int().min(100).default(500),
        maxDurationMs: z.number().int().min(1000).default(60_000),
      })
      .strict(),
    /**
     * Equivalences applied identically to reference and hypothesis.
     *
     * Caller-supplied on purpose: an equivalence the scorer invents is a thumb
     * on the scale. Use it for transliteration variance the corpus author has
     * decided is not a recognition error ("naukri"/"naukari").
     */
    transliterationAliases: z.record(z.string(), z.string()).default({}),
    consent: z.array(ConsentSchema).min(1),
    utterances: z.array(UtteranceSchema).min(1),
  })
  .strict();
export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;

export function parseManifest(raw: unknown): CorpusManifest {
  return CorpusManifestSchema.parse(raw);
}
