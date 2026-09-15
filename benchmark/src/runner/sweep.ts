/**
 * The sweep runner — the approved seven-run design.
 *
 * NOT a cross product. TTS time-to-first-byte does not depend on which STT
 * produced the text, and WER does not depend on the TTS at all, so a 3×3 grid
 * re-measures each provider three times on identical inputs. Two-thirds waste,
 * and the direct cause of a provider free tier being exhausted mid-run.
 *
 *   3 × STT-only        audio in, transcript out — residual latency, WER, entities
 *   3 × TTS-only        a frozen line set — first byte, first audible
 *   1 × end-to-end      leading pair, to measure total_turn against the gate
 *
 * Concurrency defaults to 1. Running cases in parallel makes them contend for
 * one provider's rate limit and inflates every latency figure — the harness
 * would then be measuring its own scheduling.
 */

import type { AudioCondition } from '@platform/providers';
import type { CorpusLanguageTag } from '../adapters/types.js';

import { sttAdapter, ttsAdapter } from '../adapters/registry.js';
import { consentedProcessors, loadCorpus } from '../corpus/loader.js';
import {
  aggregateE2e, aggregateStt, aggregateTts,
  type E2eAggregate, type SttAggregate, type TtsAggregate,
} from '../results/aggregate.js';
import {
  BENCHMARK_VERSION,
  collectEnvironment,
  RunStore,
  type RunMetadata,
} from '../results/store.js';
import { evaluate, STT_THRESHOLDS, TTS_THRESHOLDS } from '../measure/verdict.js';
import { QuotaExhaustedError, CredentialsError } from '../measure/failures.js';
import { runSttCase, type SttCaseResult } from './stt-runner.js';
import { runTtsCase, type TtsCaseResult } from './tts-runner.js';
import { runE2eConversation, type E2eTurnCase, type E2eTurnResult } from './e2e-runner.js';
import { SCREENING_PROMPT_VERSION } from './screen.js';
import { llmAdapter } from '../adapters/registry.js';
import type { Sleep } from './pacing.js';
import type { Clock } from '../measure/latency.js';

export interface SweepOptions {
  readonly profile: string;
  readonly manifestPath: string;
  readonly condition: AudioCondition;
  readonly runsDir: string;
  readonly maxRetries: number;
  readonly maxCalls: number;
  readonly seed: number;
  readonly drainTts: boolean;
  readonly concurrency: number;
  /** Injected for tests; real runs use the system clock and real sleeps. */
  readonly clock?: Clock;
  readonly sleep?: Sleep;
  readonly retrySleep?: Sleep;
  /** Overrides the adapter registry, for tests. */
  readonly sttFactory?: (id: string) => ReturnType<typeof sttAdapter>;
  readonly ttsFactory?: (id: string) => ReturnType<typeof ttsAdapter>;
  readonly llmFactory?: (id: string) => ReturnType<typeof llmAdapter>;
  readonly now?: () => Date;
}

export interface SttRunOutcome {
  readonly runId: string;
  readonly adapterId: string;
  readonly aggregate: SttAggregate;
  readonly verdict: ReturnType<typeof evaluate>;
  readonly directory: string;
}

export interface TtsRunOutcome {
  readonly runId: string;
  readonly adapterId: string;
  readonly aggregate: TtsAggregate;
  readonly verdict: ReturnType<typeof evaluate>;
  readonly directory: string;
}

function baseMetadata(
  options: SweepOptions,
  environment: RunMetadata['environment'],
  corpus: RunMetadata['corpus'],
  subject: RunMetadata['subject'],
  runId: string,
  startedAt: string,
): RunMetadata {
  return {
    runId,
    benchmarkVersion: BENCHMARK_VERSION,
    profile: options.profile,
    startedAt,
    corpus,
    subject,
    configuration: {
      maxRetries: options.maxRetries,
      concurrency: options.concurrency,
      maxCalls: options.maxCalls,
      drainTts: options.drainTts,
      seed: options.seed,
    },
    environment,
  };
}

/**
 * Refuse to contact a provider the speakers were never told about.
 *
 * `disclosedProcessors` is a required consent field that nothing read, so a
 * consent naming two processors silently permitted a run against a third. Under
 * the DPDP Act that is the difference between a lawful corpus and one that has
 * to be re-consented, participant by participant.
 */
export async function requireConsentFor(
  manifestPath: string,
  adapterIds: readonly string[],
): Promise<void> {
  const consented = await consentedProcessors(manifestPath);
  const missing = adapterIds.filter((id) => !consented.has(id.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `Consent does not cover ${missing.join(', ')}. Every speaker's consent must name every ` +
        'processor a run will contact, and these are named by no speaker (or only by some). ' +
        `Consent currently covers: ${[...consented].join(', ') || '(nothing)'}. ` +
        'Sending candidate voice recordings to an undisclosed processor is not something this ' +
        'harness will do on your behalf.',
    );
  }
}

/** One STT provider over the whole corpus. */
export async function runSttSweep(
  adapterId: string,
  options: SweepOptions,
): Promise<SttRunOutcome> {
  const adapter = (options.sttFactory ?? sttAdapter)(adapterId);
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  await requireConsentFor(options.manifestPath, [adapterId]);

  const { corpusVersion, utterances, transliterationAliases } = await loadCorpus(
    options.manifestPath,
    options.condition,
  );

  const checksums: Record<string, string> = {};
  for (const utterance of utterances) {
    checksums[utterance.utteranceId] = utterance.conditionMeta.checksum;
  }
  // Every utterance goes through the same condition, so one codec describes the
  // run. Recording it is what lets a reader tell a real AMR-NB round trip from
  // the G.726 substitution most ffmpeg builds force.
  const codec = utterances[0]?.conditionMeta.codec ?? null;

  const runId = `${options.profile}-stt-${adapterId}`;
  const store = new RunStore(
    options.runsDir,
    baseMetadata(
      options,
      await collectEnvironment(),
      {
        manifestPath: options.manifestPath,
        corpusVersion,
        utteranceCount: utterances.length,
        condition: options.condition,
        inputChecksums: checksums,
        codec,
      },
      {
        kind: 'stt',
        adapterId,
        adapterVersion: adapter.identity.adapterVersion,
        model: adapter.identity.model,
        unverified: adapter.identity.unverified,
        streaming: adapter.streaming,
        ...(adapter.identity.textNormalisation
          ? { textNormalisation: adapter.identity.textNormalisation }
          : {}),
        ...(adapter.identity.parameters ? { parameters: adapter.identity.parameters } : {}),
      },
      runId,
      startedAt,
    ),
  );
  await store.open();

  const results: SttCaseResult[] = [];
  let calls = 0;

  try {
    for (const utterance of utterances) {
      if (calls >= options.maxCalls) {
        await store.raw({
          kind: 'note',
          at: now().toISOString(),
          payload: { stopped: 'maxCalls reached', calls, ceiling: options.maxCalls },
        });
        break;
      }

      const result = await runSttCase(
        {
          utteranceId: utterance.utteranceId,
          samples: utterance.conditioned,
          sampleRate: utterance.conditionMeta.sampleRate as 8000 | 16000,
          // The CORPUS label, unmapped. The sweep used to rewrite 'hinglish'
          // to 'en-IN' for every provider, which is one provider's documented
          // answer and another's wrong answer — and it was applied to the exact
          // subset that carries its own sub-gate. Each adapter now declares its
          // own documented mapping, and the mapping is recorded in metadata.
          language: utterance.manifest.language,
          reference: utterance.manifest.reference,
          ...(utterance.manifest.referenceAlt
            ? { referenceAlt: utterance.manifest.referenceAlt }
            : {}),
          entities: utterance.manifest.entities,
          codeMixed: utterance.manifest.codeMixed,
        },
        {
          adapter,
          maxRetries: options.maxRetries,
          normalisation: { aliases: transliterationAliases },
          ...(options.clock ? { clock: options.clock } : {}),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          ...(options.retrySleep ? { retrySleep: options.retrySleep } : {}),
        },
      );

      results.push(result);
      // The ceiling counts PROVIDER CALLS, not cases. Counting cases meant a
      // ceiling of 500 with 2 retries permitted 1500 billed calls — three times
      // the number printed in the confirmation the founder reads before typing
      // --confirm.
      calls += result.attempts;
      // RAW FIRST: written as each measurement completes, so a crash mid-sweep
      // still leaves everything already paid for on disk.
      await store.raw({
        kind: 'stt',
        at: now().toISOString(),
        utteranceId: result.utteranceId,
        payload: {
          transcript: result.transcript,
          timeline: result.timeline,
          measurements: result.measurements,
          accuracy: result.accuracy,
          unscoreable: result.unscoreable,
          expectedEntityCount: result.expectedEntityCount,
          codeMixed: result.codeMixed,
          attempts: result.attempts,
          recovered: result.recovered,
          failure: result.failure,
          inputChecksum: utterance.conditionMeta.checksum,
          deliveredChecksum: result.deliveredChecksum,
          conditionSteps: utterance.conditionMeta.steps,
          conditionCodec: utterance.conditionMeta.codec,
        },
      });
    }
  } catch (error) {
    // A quota or credentials problem stops the sweep rather than being absorbed
    // as provider unreliability — and everything measured so far is kept.
    if (error instanceof QuotaExhaustedError || error instanceof CredentialsError) {
      await store.raw({
        kind: 'note',
        at: now().toISOString(),
        payload: { aborted: error.name, message: error.message },
      });
    }
    await store.close(now().toISOString());
    throw error;
  }

  const aggregate = aggregateStt(results);
  const verdict = evaluate({
    stages: aggregate.stages,
    ...(aggregate.accuracy ? { accuracy: aggregate.accuracy } : {}),
    ...(aggregate.hinglishAccuracy ? { hinglishAccuracy: aggregate.hinglishAccuracy } : {}),
    sampleCount: aggregate.sampleCount,
    hardFailureCount: aggregate.failures.failed,
    adapterDefectCount: aggregate.adapterDefectCount,
    recoveredCount: aggregate.failures.recovered,
    thresholds: STT_THRESHOLDS,
    headlineStage: 'stt',
  });
  if (aggregate.unscoreableCount > 0) {
    await store.raw({
      kind: 'note',
      at: now().toISOString(),
      payload: { unscoreable: aggregate.unscoreableCount, reasons: aggregate.unscoreableReasons },
    });
  }

  await store.metrics({ aggregate, verdict });
  await store.errors(aggregate.failures);
  await store.close(now().toISOString());

  return { runId, adapterId, aggregate, verdict, directory: store.directory };
}

export interface TtsLine {
  readonly lineId: string;
  readonly text: string;
  readonly language: CorpusLanguageTag;
  readonly codeMixed: boolean;
}

/** One TTS provider over the frozen line set. */
export async function runTtsSweep(
  adapterId: string,
  lines: readonly TtsLine[],
  options: SweepOptions,
): Promise<TtsRunOutcome> {
  const adapter = (options.ttsFactory ?? ttsAdapter)(adapterId);
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = `${options.profile}-tts-${adapterId}`;

  const store = new RunStore(
    options.runsDir,
    baseMetadata(
      options,
      await collectEnvironment(),
      {
        manifestPath: options.manifestPath,
        corpusVersion: 'n/a-tts-lines',
        utteranceCount: lines.length,
        condition: options.condition,
        inputChecksums: {},
        codec: null,
      },
      {
        kind: 'tts',
        adapterId,
        adapterVersion: adapter.identity.adapterVersion,
        model: adapter.identity.model,
        unverified: adapter.identity.unverified,
        streaming: adapter.streaming,
        outputSampleRate: adapter.outputFormat.sampleRate,
        outputEncoding: adapter.outputFormat.encoding,
        ...(adapter.identity.parameters ? { parameters: adapter.identity.parameters } : {}),
      },
      runId,
      startedAt,
    ),
  );
  await store.open();

  const results: TtsCaseResult[] = [];
  let calls = 0;

  try {
    for (const line of lines) {
      if (calls >= options.maxCalls) {
        // Recorded, like the STT sweep's. A truncated run that says nothing
        // about being truncated reads as a complete one with fewer samples.
        await store.raw({
          kind: 'note',
          at: now().toISOString(),
          payload: { stopped: 'maxCalls reached', calls, ceiling: options.maxCalls },
        });
        break;
      }

      const result = await runTtsCase(line, {
        adapter,
        maxRetries: options.maxRetries,
        drain: options.drainTts,
        // Draining without keeping the bytes pays for full synthesis and throws
        // every byte away — and the blind listening gate then has nothing to
        // listen to, which is the half of the TTS decision latency cannot make.
        keepAudio: options.drainTts,
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.retrySleep ? { retrySleep: options.retrySleep } : {}),
      });

      results.push(result);
      calls += result.attempts;
      if (result.audio && result.audio.byteLength > 0) {
        await store.audio(`${result.lineId}.pcm`, result.audio);
      }
      await store.raw({
        kind: 'tts',
        at: now().toISOString(),
        lineId: result.lineId,
        payload: {
          timeline: result.timeline,
          measurements: result.measurements,
          codeMixed: result.codeMixed,
          attempts: result.attempts,
          recovered: result.recovered,
          failure: result.failure,
          textLength: line.text.length,
          audioBytes: result.audio?.byteLength ?? 0,
        },
      });
    }
  } catch (error) {
    if (error instanceof QuotaExhaustedError || error instanceof CredentialsError) {
      await store.raw({
        kind: 'note',
        at: now().toISOString(),
        payload: { aborted: error.name, message: error.message },
      });
    }
    await store.close(now().toISOString());
    throw error;
  }

  const aggregate = aggregateTts(results);
  const verdict = evaluate({
    stages: aggregate.stages,
    sampleCount: aggregate.sampleCount,
    hardFailureCount: aggregate.failures.failed,
    adapterDefectCount: aggregate.adapterDefectCount,
    recoveredCount: aggregate.failures.recovered,
    // A buffered adapter's "first byte" is full synthesis. Gating it at 400 ms
    // would rank OUR transport choice as the provider's speed.
    headlineComparable: adapter.streaming,
    ...(adapter.streaming ? {} : {
      headlineIncomparableReason:
        `This adapter buffers the whole response before yielding, so its "time to first byte" is ` +
        'time to FULL SYNTHESIS. It is not comparable with a streaming adapter\'s first-byte ' +
        'figure and the component gate was therefore not applied. Implement the provider\'s ' +
        'documented streaming endpoint before ranking it on this axis.',
    }),
    // Not the full rule: a TTS run has no transcript, so the WER and entity
    // gates could never be satisfied and made every TTS run permanently
    // INCOMPLETE regardless of how good the provider was.
    thresholds: TTS_THRESHOLDS,
    headlineStage: 'tts_first_byte',
  });

  await store.metrics({ aggregate, verdict });
  await store.errors(aggregate.failures);
  await store.close(now().toISOString());

  return { runId, adapterId, aggregate, verdict, directory: store.directory };
}

export interface E2eRunOutcome {
  readonly runId: string;
  readonly aggregate: E2eAggregate;
  readonly verdict: ReturnType<typeof evaluate>;
  readonly directory: string;
}

/**
 * The end-to-end run — the ONLY run that measures the pre-registered gate.
 *
 * One STT, one LLM, one TTS: the leading pair from the component runs plus the
 * LLM held constant. It is deliberately run LAST, because "leading" is decided
 * by the component runs and choosing the pair beforehand would be choosing the
 * answer beforehand.
 */
export async function runE2eSweep(
  adapters: { readonly stt: string; readonly llm: string; readonly tts: string },
  options: SweepOptions,
): Promise<E2eRunOutcome> {
  const stt = (options.sttFactory ?? sttAdapter)(adapters.stt);
  const tts = (options.ttsFactory ?? ttsAdapter)(adapters.tts);
  const llm = (options.llmFactory ?? llmAdapter)(adapters.llm);
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  await requireConsentFor(options.manifestPath, [adapters.stt, adapters.llm, adapters.tts]);

  const { corpusVersion, utterances } = await loadCorpus(
    options.manifestPath,
    options.condition,
  );

  const checksums: Record<string, string> = {};
  for (const utterance of utterances) {
    checksums[utterance.utteranceId] = utterance.conditionMeta.checksum;
  }
  const codec = utterances[0]?.conditionMeta.codec ?? null;

  const runId = `${options.profile}-e2e-${adapters.stt}-${adapters.llm}-${adapters.tts}`;
  const store = new RunStore(
    options.runsDir,
    baseMetadata(
      options,
      await collectEnvironment(),
      {
        manifestPath: options.manifestPath,
        corpusVersion,
        utteranceCount: utterances.length,
        condition: options.condition,
        inputChecksums: checksums,
        codec,
      },
      {
        kind: 'end_to_end',
        adapterId: `${adapters.stt}+${adapters.llm}+${adapters.tts}`,
        adapterVersion: [
          stt.identity.adapterVersion, llm.identity.adapterVersion, tts.identity.adapterVersion,
        ].join(' / '),
        model: [stt.identity.model, llm.identity.model, tts.identity.model].join(' / '),
        // Unverified if ANY leg is. A chain is exactly as trustworthy as its
        // least-verified link, and reporting otherwise would overstate the run.
        unverified: stt.identity.unverified || llm.identity.unverified || tts.identity.unverified,
        streaming: stt.streaming && tts.streaming,
        ...(stt.identity.textNormalisation
          ? { textNormalisation: stt.identity.textNormalisation }
          : {}),
        outputSampleRate: tts.outputFormat.sampleRate,
        outputEncoding: tts.outputFormat.encoding,
        parameters: {
          sttAdapter: adapters.stt,
          llmAdapter: adapters.llm,
          ttsAdapter: adapters.tts,
          screeningPrompt: SCREENING_PROMPT_VERSION,
          // Synthesis starts at the first sentence, while the model is still
          // generating. A serial pipeline would charge total_turn for the whole
          // completion, which is not what the product will do.
          pipelineShape: 'first-sentence-streaming',
          ...(stt.identity.parameters ?? {}),
          ...(tts.identity.parameters ?? {}),
        },
      },
      runId,
      startedAt,
    ),
  );
  await store.open();

  // Group into conversations so multi-turn context is carried, exactly as a
  // real screen would. An utterance with no conversationId is its own
  // conversation — valid, but it measures a cold first turn every time, and the
  // report says how many conversations the sample came from.
  const conversations = new Map<string, E2eTurnCase[]>();
  for (const utterance of utterances) {
    const conversationId = utterance.manifest.conversationId ?? utterance.utteranceId;
    const turns = conversations.get(conversationId) ?? [];
    turns.push({
      utteranceId: utterance.utteranceId,
      conversationId,
      turnIndex: utterance.manifest.turnIndex ?? turns.length,
      samples: utterance.conditioned,
      sampleRate: utterance.conditionMeta.sampleRate as 8000 | 16000,
      language: utterance.manifest.language,
      reference: utterance.manifest.reference,
      entities: utterance.manifest.entities,
      codeMixed: utterance.manifest.codeMixed,
    });
    conversations.set(conversationId, turns);
  }
  for (const turns of conversations.values()) {
    turns.sort((a, b) => a.turnIndex - b.turnIndex);
  }

  const results: E2eTurnResult[] = [];
  let calls = 0;

  try {
    for (const [conversationId, turns] of conversations) {
      if (calls >= options.maxCalls) {
        await store.raw({
          kind: 'note',
          at: now().toISOString(),
          payload: { stopped: 'maxCalls reached', calls, ceiling: options.maxCalls, conversationId },
        });
        break;
      }

      // The ceiling is enforced INSIDE the conversation, per turn. Checking it
      // only between conversations let a five-turn conversation overshoot by
      // fifteen calls plus retries after the ceiling was already reached — on a
      // metered API, with a founder who typed a number to prevent exactly that.
      const turnResults = await runE2eConversation(turns, {
        stt, llm, tts,
        maxRetries: options.maxRetries,
        callBudget: () => Math.max(0, options.maxCalls - calls),
        onTurnComplete: (spent) => { calls += spent; },
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
        ...(options.retrySleep ? { retrySleep: options.retrySleep } : {}),
      });

      for (const result of turnResults) {
        results.push(result);
        await store.raw({
          kind: 'turn',
          at: now().toISOString(),
          utteranceId: result.utteranceId,
          payload: {
            conversationId: result.conversationId,
            timeline: result.timeline,
            durations: result.durations,
            transcript: result.transcript,
            reply: result.reply,
            accuracy: result.accuracy,
            codeMixed: result.codeMixed,
            attempts: result.attempts,
            recovered: result.recovered,
            failure: result.failure,
            replyCharacters: result.replyCharacters,
          replyLength: result.replyLength,
            inputChecksum: checksums[result.utteranceId],
          },
        });
      }
    }
  } catch (error) {
    if (error instanceof QuotaExhaustedError || error instanceof CredentialsError) {
      await store.raw({
        kind: 'note',
        at: now().toISOString(),
        payload: { aborted: error.name, message: error.message },
      });
    }
    await store.close(now().toISOString());
    throw error;
  }

  const aggregate = aggregateE2e(results);
  const verdict = evaluate({
    stages: aggregate.stages,
    ...(aggregate.accuracy ? { accuracy: aggregate.accuracy } : {}),
    ...(aggregate.hinglishAccuracy ? { hinglishAccuracy: aggregate.hinglishAccuracy } : {}),
    sampleCount: aggregate.sampleCount,
    hardFailureCount: aggregate.failures.failed,
    adapterDefectCount: aggregate.adapterDefectCount,
    recoveredCount: aggregate.failures.recovered,
    // The FULL rule: an end-to-end run carries a transcript, so the accuracy
    // gates apply, and its headline is the total the whole budget is about.
    thresholds: STT_THRESHOLDS,
    headlineStage: 'total_turn',
  });

  await store.metrics({ aggregate, verdict });
  await store.errors(aggregate.failures);
  await store.close(now().toISOString());

  return { runId, aggregate, verdict, directory: store.directory };
}
