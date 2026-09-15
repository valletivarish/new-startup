/**
 * Report rendering.
 *
 * Two audiences: a person deciding, and a person auditing. So every report
 * carries the verdict AND the provenance — corpus version, adapter version,
 * git commit, whether the adapter was ever verified against the real API.
 *
 * The `unverified` flag is printed prominently on purpose. A number from an
 * adapter that has never touched the live service deserves less trust than one
 * from a proven adapter, and the reader must be told which they are reading.
 */

import type { LatencyDistribution } from '@platform/providers';
import type { E2eAggregate, SttAggregate, TtsAggregate } from './aggregate.js';
import type { RunMetadata } from './store.js';
import type { evaluate } from '../measure/verdict.js';

type Verdict = ReturnType<typeof evaluate>;

function mark(verdict: string): string {
  return verdict === 'PASS' ? '🟢' : verdict === 'FAIL' ? '🔴' : '🟡';
}

function row(label: string, d: LatencyDistribution | undefined): string {
  if (!d) return `| ${label} | — | — | — | — | 0 |`;
  return `| ${label} | ${Math.round(d.p50)} | ${Math.round(d.p95)} | ${Math.round(d.min)} | ${Math.round(d.max)} | ${d.count} |`;
}

function provenance(metadata: RunMetadata): string[] {
  const lines = [
    '## Provenance',
    '',
    '| | |',
    '|---|---|',
    `| Run id | \`${metadata.runId}\` |`,
    `| Benchmark version | ${metadata.benchmarkVersion} |`,
    `| Started | ${metadata.startedAt} |`,
    `| Corpus version | **${metadata.corpus.corpusVersion}** |`,
    `| Audio condition | **${metadata.corpus.condition}** |`,
    `| Narrowband codec | ${metadata.corpus.codec ?? 'none (lossless path)'} |`,
    `| Utterances | ${metadata.corpus.utteranceCount} |`,
    `| Adapter | \`${metadata.subject.adapterId}\` v${metadata.subject.adapterVersion} |`,
    `| Model | ${metadata.subject.model} |`,
    `| Streaming | ${metadata.subject.streaming ? 'yes' : 'no'} |`,
    ...(metadata.subject.textNormalisation
      ? [`| Text normalisation requested | ${metadata.subject.textNormalisation} |`]
      : []),
    ...Object.entries(metadata.subject.parameters ?? {}).map(
      ([key, value]) => `| ${key} | ${value} |`,
    ),
    `| Node | ${metadata.environment.node} on ${metadata.environment.platform}/${metadata.environment.arch} |`,
    `| Git commit | ${metadata.environment.gitCommit ?? 'unknown'}${metadata.environment.gitDirty ? ' **(working tree dirty)**' : ''} |`,
    `| Host | ${metadata.environment.host} |`,
    `| Benchmark region | ${metadata.environment.region ?? '**NOT DECLARED**'} (declared, not verified) |`,
    `| Retries allowed | ${metadata.configuration.maxRetries} |`,
    `| Seed | ${metadata.configuration.seed} |`,
  ];

  if (metadata.subject.unverified) {
    lines.push(
      '',
      '> ⚠️ **This adapter is UNVERIFIED.** Its request shape was written from published',
      '> documentation and has never been exercised against the live service in this',
      '> repository. Treat these numbers as provisional until the adapter has been',
      '> confirmed against real credentials.',
    );
  }
  if (!metadata.environment.region) {
    lines.push(
      '',
      '> ⚠️ **No benchmark region was declared for this run.** Every latency figure below',
      '> includes the network position of whatever machine produced it, and there is no record',
      '> of where that was. Do not compare these numbers against the turn budget.',
    );
  }
  if (metadata.corpus.codec && !metadata.corpus.codec.includes('amr')) {
    lines.push(
      '',
      `> ⚠️ The narrowband condition used **${metadata.corpus.codec}**, a real ITU-T narrowband`,
      '> codec but NOT the AMR-NB an Indian mobile actually applies on the radio leg. This',
      '> ffmpeg build cannot encode AMR-NB. Results are still comparable BETWEEN providers —',
      '> every one received identical input — but they are optimistic relative to a real call.',
    );
  }
  if (metadata.environment.gitDirty) {
    lines.push(
      '',
      '> ⚠️ **The working tree was dirty at run time**, so this result cannot be tied to',
      '> a single commit. Re-run from a clean tree before using it to decide anything.',
    );
  }
  return lines;
}

export function renderSttReport(
  metadata: RunMetadata,
  aggregate: SttAggregate,
  verdict: Verdict,
): string {
  const lines = [
    `# STT benchmark — ${metadata.subject.adapterId}`,
    '',
    `**Verdict: ${mark(verdict.verdict)} ${verdict.verdict}**`,
    '',
    ...provenance(metadata),
    '',
    '## Latency (ms)',
    '',
    '| Measure | p50 | p95 | min | max | n |',
    '|---|---|---|---|---|---|',
    row('**Post-endpoint residual** (the gated figure)', aggregate.stages.stt),
    row('First interim after endpoint', aggregate.firstInterim),
    row('Wall clock request → completion (context only)', aggregate.totalRequest),
    '',
  ];

  if (aggregate.residualVsDurationCorrelation !== undefined) {
    const r = aggregate.residualVsDurationCorrelation;
    lines.push(
      '### Bias check: does residual latency track utterance length?',
      '',
      `Pearson correlation between audio duration and residual latency: **${r.toFixed(2)}**`,
      '',
      r > 0.7
        ? '> ⚠️ **Strong correlation.** Residual latency is tracking how long the utterance was, ' +
          'which is what happens when audio is not paced in real time or when the provider ' +
          'buffers everything. For a streaming provider this figure should be roughly ' +
          'independent of duration — investigate before trusting the comparison.'
        : '> Low correlation, as expected: residual latency is measuring post-endpoint ' +
          'processing rather than utterance length.',
      '',
    );
  }

  if (aggregate.accuracy) {
    const a = aggregate.accuracy;
    lines.push(
      '## Accuracy',
      '',
      '| Measure | Value |',
      '|---|---|',
      `| Word error rate | ${(a.wer * 100).toFixed(1)}% |`,
      `| Character error rate | ${(a.cer * 100).toFixed(1)}% |`,
      `| Substitutions / deletions / insertions | ${a.substitutions} / ${a.deletions} / ${a.insertions} |`,
      `| Reference words | ${a.referenceWords} |`,
    );
    if (a.entityAccuracy !== undefined) {
      lines.push(
        `| **Entity accuracy** | **${(a.entityAccuracy * 100).toFixed(1)}%** (${a.entitiesFound}/${a.entitiesExpected}) |`,
      );
    }
    if (a.entitiesWrong !== undefined && a.entitiesWrong > 0) {
      lines.push(
        `| ⚠️ **Facts heard WRONG** | **${a.entitiesWrong}** — a wrong fact rejects a candidate silently |`,
      );
    }
    lines.push('');
  }

  if (aggregate.hinglishAccuracy?.entityAccuracy !== undefined) {
    const h = aggregate.hinglishAccuracy;
    lines.push(
      '### Hinglish subset (sub-gate)',
      '',
      `Entity accuracy on code-mixed utterances: **${((h.entityAccuracy ?? 0) * 100).toFixed(1)}%** ` +
        `over ${h.referenceWords} reference words.`,
      '',
    );
  }

  const f = aggregate.failures;
  lines.push(
    '## Failures',
    '',
    `Attempted ${f.attempted} · succeeded ${f.succeeded} · recovered after retry ${f.recovered} · **failed ${f.failed}**`,
    '',
    `Failure rate: ${(f.failureRate * 100).toFixed(1)}% (denominator: ${f.denominator})`,
    '',
  );
  if (Object.keys(f.byCategory).length > 0) {
    lines.push('| Category | Count |', '|---|---|');
    for (const [category, count] of Object.entries(f.byCategory)) {
      lines.push(`| ${category} | ${count} |`);
    }
    lines.push('');
  }
  if (f.recovered > 0) {
    lines.push(
      `> ${f.recovered} sample(s) succeeded only after a retry. Their latency is EXCLUDED from`,
      '> the distribution above — a provider that is flaky but eventually fast must not',
      '> out-rank one that is reliably mediocre. Their TRANSCRIPTS are still scored: a retry',
      '> changes when the answer arrived, not what it said.',
      '',
    );
  }
  if (aggregate.adapterDefectCount > 0) {
    lines.push(
      `> ⚠️ ${aggregate.adapterDefectCount} call(s) failed with a 4xx — OUR request was wrong, not`,
      '> the provider. Those are excluded from the failure gate and make this run incomplete',
      '> rather than a verdict on the provider.',
      '',
    );
  }

  return [...lines, ...verdictSection(verdict), ...footer()].join('\n');
}

export function renderTtsReport(
  metadata: RunMetadata,
  aggregate: TtsAggregate,
  verdict: Verdict,
): string {
  const lines = [
    `# TTS benchmark — ${metadata.subject.adapterId}`,
    '',
    `**Verdict: ${mark(verdict.verdict)} ${verdict.verdict}**`,
    '',
    ...provenance(metadata),
    '',
    '## Latency (ms)',
    '',
    '| Measure | p50 | p95 | min | max | n |',
    '|---|---|---|---|---|---|',
    row('**Time to first byte** (the gated figure)', aggregate.stages.tts_first_byte),
    row('Time to first AUDIBLE byte', aggregate.firstAudible),
    '',
  ];

  if (!metadata.subject.streaming) {
    lines.push(
      '> ⚠️ **This adapter is NOT streaming**, so "time to first byte" here is time to FULL',
      '> synthesis: the whole response is buffered before any byte is handed on. It is not',
      '> comparable with a streaming adapter\'s first-byte figure and must not be placed',
      '> beside one in a ranking. First-audible is equally affected.',
      '',
    );
  }

  if (aggregate.firstAudible && aggregate.stages.tts_first_byte) {
    const gap = aggregate.firstAudible.p50 - aggregate.stages.tts_first_byte.p50;
    if (gap > 50) {
      lines.push(
        `> ⚠️ First audible audio arrives **${Math.round(gap)} ms after** the first byte, so this`,
        '> provider is emitting leading silence. Time-to-first-byte flatters it by that much,',
        '> and a candidate hears the later number.',
        '',
      );
    }
  }

  if (!metadata.configuration.drainTts) {
    lines.push(
      '> Synthesis was stopped after the first byte, which is what the gate measures.',
      '> Real-time factor and full-synthesis timing are therefore not reported — run with',
      '> `--drain` when those are needed (it costs more quota).',
      '',
    );
  }

  const f = aggregate.failures;
  lines.push(
    '## Failures',
    '',
    `Attempted ${f.attempted} · succeeded ${f.succeeded} · recovered after retry ${f.recovered} · **failed ${f.failed}**`,
    '',
  );
  if (Object.keys(f.byCategory).length > 0) {
    lines.push('| Category | Count |', '|---|---|');
    for (const [category, count] of Object.entries(f.byCategory)) {
      lines.push(`| ${category} | ${count} |`);
    }
    lines.push('');
  }
  if (aggregate.adapterDefectCount > 0) {
    lines.push(
      `> ⚠️ ${aggregate.adapterDefectCount} call(s) failed with a 4xx — OUR request was wrong, not`,
      '> the provider. Those are excluded from the failure gate and make this run incomplete',
      '> rather than a verdict on the provider.',
      '',
    );
  }

  return [...lines, ...verdictSection(verdict), ...footer()].join('\n');
}

/**
 * The end-to-end report — the only one whose headline is the pre-registered gate.
 *
 * It states what is NOT in the number as prominently as what is. An offline
 * total_turn excludes the carrier leg entirely, and a reader who takes 1100 ms
 * here as "inside the 1200 ms budget on a real call" has been misled by an
 * omission rather than by a figure.
 */
export function renderE2eReport(
  metadata: RunMetadata,
  aggregate: E2eAggregate,
  verdict: Verdict,
): string {
  const lines = [
    `# End-to-end benchmark — ${metadata.subject.adapterId}`,
    '',
    `**Verdict: ${mark(verdict.verdict)} ${verdict.verdict}**`,
    '',
    ...provenance(metadata),
    '',
    '## Turn latency (ms)',
    '',
    '| Stage | p50 | p95 | min | max | n |',
    '|---|---|---|---|---|---|',
    row('**Total turn** (the gated figure)', aggregate.stages.total_turn),
    row('Speech-to-text (endpoint → final)', aggregate.stages.stt),
    row('LLM time to first token', aggregate.stages.llm_first_token),
    row('LLM time to completion', aggregate.stages.llm_complete),
    row('TTS time to first byte', aggregate.stages.tts_first_byte),
    '',
    '> **What `total_turn` is here:** end of candidate speech → **first returned audio byte**,',
    '> which is how `06_PROVIDER_AND_COST_SPEC` §14 words the budget.',
    '>',
    '> **What it excludes:** the carrier leg. There is no phone call in this run, so the',
    '> media-edge round trip a real candidate would also wait through is NOT in this number',
    '> and cannot be measured offline. Add it before comparing against a live-call target.',
    '>',
    '> **`endpointing` is absent on purpose.** Recorded utterances have pre-cut boundaries, so',
    '> any figure would be the utterance length printed as if it were a VAD decision.',
    '',
    `Turns: ${aggregate.failures.attempted} across ${aggregate.conversationCount} conversation(s). ` +
      `Characters actually synthesised: ${aggregate.replyCharacters.toLocaleString()} ` +
      `(of ${aggregate.replyLength.toLocaleString()} generated).`,
    '',
    '> **The pipeline is streaming:** synthesis starts at the first sentence boundary, while the',
    '> model is still generating. A serial pipeline would charge this total for the whole',
    '> completion — inflating the one gated figure by however long the model kept talking.',
    '> Only the sentence that was sent is billed, which is why the two character counts differ.',
    '',
  ];

  if (aggregate.conversationCount === aggregate.failures.attempted && aggregate.failures.attempted > 1) {
    lines.push(
      '> ⚠️ Every turn was its own conversation, so no multi-turn context was carried. This',
      '> measures a cold first turn repeatedly, which is not what a five-minute screen does.',
      '> Set `conversationId` and `turnIndex` in the manifest to fix it.',
      '',
    );
  }

  if (aggregate.accuracy) {
    const a = aggregate.accuracy;
    lines.push(
      '## Accuracy (of the transcript the LLM actually received)',
      '',
      '| Measure | Value |',
      '|---|---|',
      `| Word error rate | ${(a.wer * 100).toFixed(1)}% |`,
      `| Character error rate | ${(a.cer * 100).toFixed(1)}% |`,
    );
    if (a.entityAccuracy !== undefined) {
      lines.push(
        `| **Entity accuracy** | **${(a.entityAccuracy * 100).toFixed(1)}%** (${a.entitiesFound}/${a.entitiesExpected}) |`,
      );
    }
    if (a.entitiesWrong !== undefined && a.entitiesWrong > 0) {
      lines.push(
        `| ⚠️ **Facts heard WRONG** | **${a.entitiesWrong}** — a wrong fact rejects a candidate silently |`,
      );
    }
    lines.push('');
  }

  const f = aggregate.failures;
  lines.push(
    '## Failures',
    '',
    `Attempted ${f.attempted} · succeeded ${f.succeeded} · recovered after retry ${f.recovered} · **failed ${f.failed}**`,
    '',
  );
  if (Object.keys(aggregate.failuresByStage).length > 0) {
    lines.push('| Stage that failed | Count |', '|---|---|');
    for (const [stage, count] of Object.entries(aggregate.failuresByStage)) {
      lines.push(`| ${stage} | ${count} |`);
    }
    lines.push(
      '',
      '> Failures are attributed to the STAGE they happened in. A chain that fails is not',
      '> evidence against every layer in it.',
      '',
    );
  }
  if (aggregate.adapterDefectCount > 0) {
    lines.push(
      `> ⚠️ ${aggregate.adapterDefectCount} call(s) failed with a 4xx — OUR request was wrong, not`,
      '> the provider. Excluded from the failure gate; this run did not measure them.',
      '',
    );
  }

  return [...lines, ...verdictSection(verdict), ...footer()].join('\n');
}

function verdictSection(verdict: Verdict): string[] {
  const lines: string[] = [];
  if (verdict.failures.length > 0) {
    lines.push('## Threshold failures', '');
    for (const failure of verdict.failures) lines.push(`- ${failure}`);
    lines.push('');
  }
  if (verdict.warnings.length > 0) {
    lines.push('## Advisory (does not change the verdict)', '');
    for (const warning of verdict.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  if (verdict.incompleteReasons.length > 0) {
    lines.push('## Why this run is incomplete', '');
    for (const reason of verdict.incompleteReasons) lines.push(`- ${reason}`);
    lines.push('');
  }
  return lines;
}

function footer(): string[] {
  return [
    '---',
    '',
    '*Measured, not claimed. Percentiles are nearest-rank. Failed and retried samples are*',
    '*excluded from latency and counted separately. Every figure above can be recomputed*',
    '*from `raw.jsonl` in the run directory.*',
    '',
    '**This report ranks providers. It does not select one.** Selection is the next',
    'decision gate and belongs to the founder.',
    '',
  ];
}
