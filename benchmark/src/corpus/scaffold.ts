/**
 * The recording scaffold.
 *
 * Generates the shape a recording session records INTO — manifest skeleton,
 * worksheet, and a printable sheet — so that the founder is never constructing
 * 75 JSON entries by hand and `bench validate` works from the very first file.
 *
 * IT INVENTS NO CONTENT. It does not write reference sentences, choose words,
 * or decide what a speaker says. Those are the ground truth the whole benchmark
 * rests on and they are a human judgement. What it generates is structure:
 * identifiers, conversation grouping, turn order, file paths, language and
 * environment labels, and the consent block pre-filled with the processors a
 * sweep will actually contact.
 *
 * The counts come from `CORPUS_RECORDING_SPEC.md` and are not adjustable here,
 * because a corpus that quietly shrinks is a corpus that quietly stops being
 * able to reach a verdict.
 */

import type { CorpusLanguage } from './manifest.js';
import { requiredProcessorIds } from '../adapters/registry.js';
import { MIN_SAMPLES_FOR_VERDICT } from '../measure/verdict.js';
import { allocate, CATEGORY_MINIMUMS } from './coverage.js';
import { renderWorksheet, type WorksheetRow } from './worksheet.js';

/**
 * The recording plan, exactly as specified.
 *
 * `PHASE_5C_BENCHMARK_DESIGN` section 5.3 and `CORPUS_RECORDING_SPEC` section 1:
 * 20 Indian English, 15 Hindi, 20 code-mixed, in five-turn conversations, plus
 * a noisy re-record of a subset.
 */
export const QUIET_PLAN: readonly { language: CorpusLanguage; conversations: number }[] = [
  { language: 'en-IN', conversations: 4 },
  { language: 'hi-IN', conversations: 3 },
  { language: 'hinglish', conversations: 4 },
];

export const TURNS_PER_CONVERSATION = 5;

/**
 * Noisy conversations: four required, plus one of margin.
 *
 * Four conversations is 20 utterances, which is EXACTLY the verdict sample
 * floor — one hard failure or one unscoreable sample drops the cohort to 19 and
 * the whole noisy condition reports INCOMPLETE. The fifth conversation is the
 * approved margin, and it costs one extra recording pass.
 */
export const NOISY_CONVERSATIONS = 5;

export interface ScaffoldOptions {
  readonly corpusVersion: string;
  /** Pseudonymous ids. NEVER real names — the manifest is committed. */
  readonly speakerIds: readonly string[];
  readonly sampleRate?: number;
}

export interface Scaffold {
  readonly manifest: Record<string, unknown>;
  readonly worksheet: string;
  readonly sheet: string;
  readonly rows: readonly WorksheetRow[];
}

function conversationRows(
  prefix: string,
  index: number,
  language: CorpusLanguage,
  environment: 'quiet' | 'noisy',
  speakerId: string,
  margin: boolean,
  /** Which fact categories this slot should carry, one entry per turn. */
  targets: readonly (readonly string[])[] = [],
  /** For a noisy re-record, the quiet conversation whose script it repeats. */
  mirrors?: string,
): WorksheetRow[] {
  const conversationId = `${prefix}-${String(index).padStart(2, '0')}`;
  return Array.from({ length: TURNS_PER_CONVERSATION }, (_, turn) => {
    const utteranceId = `${conversationId}-t${turn + 1}`;
    return {
      utteranceId,
      conversationId,
      turnIndex: turn,
      language,
      environment,
      speakerId,
      // Pre-set for the code-mixed cohort, because that is what the label means
      // — but it stays editable: it must be true only where the speech GENUINELY
      // switches, or the sub-gate judges easy monolingual material.
      codeMixed: language === 'hinglish',
      file: `audio/${utteranceId}.wav`,
      reference: '',
      referenceAlt: '',
      entities: [],
      notes: [
        margin ? 'MARGIN — spare take, beyond the required 20' : '',
        environment === 'noisy' && mirrors
          ? `RE-RECORD of ${mirrors}-t${turn + 1} in a noisy room — same words, ` +
            'copy its reference and entities across'
          : '',
        (targets[turn]?.length ?? 0) > 0 ? `include: ${(targets[turn] ?? []).join(', ')}` : '',
      ].filter(Boolean).join(' · '),
    };
  });
}

export function buildScaffold(options: ScaffoldOptions): Scaffold {
  const speakers = options.speakerIds;
  if (speakers.length < 2) {
    throw new Error(
      'At least two speakers are required. The specification asks for regional accent variation ' +
        'from different states, and one voice cannot provide it — a corpus of one speaker ' +
        'measures how well a provider handles that person.',
    );
  }

  // The specification's category minimums, spread deterministically across the
  // quiet slots. WHAT a speaker says is ground truth and is not generated; WHICH
  // category belongs in which slot is arithmetic, and doing it by hand across
  // eighty slots is how a corpus quietly ends up with four dates where the
  // specification asks for eight.
  const quietSlots = QUIET_PLAN.reduce((n, p) => n + p.conversations, 0) * TURNS_PER_CONVERSATION;
  const allocation = allocate(quietSlots);

  const rows: WorksheetRow[] = [];
  let conversation = 0;
  let slot = 0;
  for (const { language, conversations } of QUIET_PLAN) {
    for (let i = 0; i < conversations; i += 1) {
      conversation += 1;
      const targets = Array.from(
        { length: TURNS_PER_CONVERSATION },
        () => allocation[slot++] ?? [],
      );
      rows.push(...conversationRows(
        'conv', conversation, language, 'quiet',
        speakers[conversation % speakers.length] as string, false, targets,
      ));
    }
  }
  // The noisy condition re-records the SAME SCRIPT in a genuinely noisy place,
  // so each noisy conversation names the quiet one it mirrors. Without that the
  // two conditions would be different material and the comparison would measure
  // the script as much as the noise.
  const mirrors: { source: string; language: CorpusLanguage }[] = [
    { source: 'conv-01', language: 'en-IN' },
    { source: 'conv-05', language: 'hi-IN' },
    { source: 'conv-08', language: 'hinglish' },
    { source: 'conv-09', language: 'hinglish' },
    { source: 'conv-02', language: 'en-IN' },
  ];
  for (let i = 0; i < NOISY_CONVERSATIONS; i += 1) {
    conversation += 1;
    const mirror = mirrors[i] as { source: string; language: CorpusLanguage };
    rows.push(...conversationRows(
      'noisy', i + 1, mirror.language, 'noisy',
      speakers[conversation % speakers.length] as string,
      i >= NOISY_CONVERSATIONS - 1,
      [], mirror.source,
    ));
  }

  const disclosed = requiredProcessorIds().map(
    (id) => `${id} — DESCRIBE THE PROCESSOR AND WHERE IT PROCESSES (see PROVIDER_CREDENTIAL_SETUP.md)`,
  );

  const manifest = {
    corpusVersion: options.corpusVersion,
    description:
      'Recorded corpus for the Phase 5C provider benchmark. References and entity expectations ' +
      'must be written and FROZEN before any provider is contacted.',
    audio: {
      sampleRate: options.sampleRate ?? 16000,
      channels: 1,
      bitsPerSample: 16,
      minDurationMs: 500,
      // The hard cap one candidate documents for its real-time endpoint.
      maxDurationMs: 30_000,
    },
    transliterationAliases: {},
    consent: speakers.map((speakerId) => ({
      speakerId,
      obtainedAt: 'YYYY-MM-DD',
      coversCrossBorderTransfer: true,
      disclosedProcessors: disclosed,
      retentionUntil: 'YYYY-MM-DD',
      deletionContact: 'REPLACE WITH A REAL CONTACT',
    })),
    // Filled by `bench reference` from the worksheet. Left empty rather than
    // stubbed, so a half-finished corpus fails validation loudly.
    utterances: [],
  };

  return { manifest, worksheet: renderWorksheet(rows), sheet: renderSheet(rows), rows };
}

/** The printable sheet the person recording actually holds. */
export function renderSheet(rows: readonly WorksheetRow[]): string {
  const byConversation = new Map<string, WorksheetRow[]>();
  for (const row of rows) {
    byConversation.set(row.conversationId, [...(byConversation.get(row.conversationId) ?? []), row]);
  }

  const quiet = rows.filter((r) => r.environment === 'quiet').length;
  const noisy = rows.filter((r) => r.environment === 'noisy').length;

  const lines = [
    '# Recording sheet',
    '',
    `**${rows.length} recordings** — ${quiet} quiet, ${noisy} noisy — across ` +
      `${byConversation.size} conversations of ${TURNS_PER_CONVERSATION} turns.`,
    '',
    '## Before you start',
    '',
    '- 16 kHz or higher, **mono**, **16-bit WAV**. Never record at 8 kHz: the narrowband',
    '  condition is produced FROM the clean recording, and an 8 kHz source cannot be recovered.',
    '- **30 seconds maximum per utterance.** A hard limit — one candidate\'s real-time endpoint',
    '  caps there. Target 5 to 15 seconds.',
    '- Normalise to about −23 LUFS. Trim leading silence to 200 ms.',
    '- Record each conversation as a continuous exchange, not as disconnected lines.',
    '- **No profanity** — one provider\'s default setting has an undocumented effect on the',
    '  transcript field this benchmark scores against.',
    '',
    '## What every utterance needs afterwards',
    '',
    '- A verbatim `reference` — what was ACTUALLY said, including fillers and self-corrections.',
    `- For **hi-IN and hinglish**: also a \`referenceAlt\` in the other alphabet. Without both,`,
    '  a perfect transcription from one of the three candidates is UNSCOREABLE and the Hinglish',
    '  sub-gate cannot be applied to it.',
    '- Entity expectations. **Each quiet slot names the categories it should carry** in the',
    '  worksheet\'s `notes` column — that allocation already satisfies the specification\'s',
    '  minimums, so following it means the corpus cannot come up short:',
    `  ${Object.entries(CATEGORY_MINIMUMS).map(([k, n]) => `${k} ${n}`).join(' · ')}.`,
    '  `bench validate` counts them and refuses a deciding corpus that is short.',
    '- At least 12 deliberately difficult utterances: mid-sentence code-switching, English',
    '  technical terms inside Hindi, a long answer near the cap, a mid-answer pause,',
    '  a self-correction, fast and slow speech, fillers, a digit-by-digit read-back, a very',
    '  short answer, two regional accents, background speech, and a confusable pair.',
    '',
    '## The slots',
    '',
    '| Conversation | Language | Environment | Speaker | Files |',
    '|---|---|---|---|---|',
  ];

  for (const [conversationId, turns] of byConversation) {
    const first = turns[0] as WorksheetRow;
    const margin = first.notes.startsWith('MARGIN') ? ' *(margin)*' : '';
    lines.push(
      `| \`${conversationId}\`${margin} | ${first.language} | ${first.environment} | ` +
        `\`${first.speakerId}\` | ` +
        `\`${first.utteranceId}.wav\` … \`${(turns.at(-1) as WorksheetRow).utteranceId}.wav\` |`,
    );
  }

  lines.push(
    '',
    `The noisy cohort includes one margin conversation. Four would be exactly ` +
      `${MIN_SAMPLES_FOR_VERDICT} utterances — the verdict floor — where a single failed sample ` +
      'makes the whole noisy condition INCOMPLETE.',
    '',
    '## Then',
    '',
    '```bash',
    'pnpm bench reference --manifest corpus/<name>/manifest.json --sheet corpus/<name>/references.tsv',
    'pnpm bench validate  --manifest corpus/<name>/manifest.json',
    'pnpm bench consent   --manifest corpus/<name>/manifest.json',
    '```',
    '',
    'None of those contacts a provider or costs anything.',
    '',
  );
  return lines.join('\n');
}
