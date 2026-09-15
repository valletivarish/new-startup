#!/usr/bin/env node
/**
 * Benchmark CLI.
 *
 * Nothing here spends money without printing what it is about to spend first.
 * `validate` and `plan` make no provider calls at all, and `run` refuses to
 * start without `--confirm` once it knows the call count.
 *
 * COMMANDS ARE A TABLE, not a switch with a help string beside it. `quality-pack`
 * was documented in both places and implemented in neither, so typing it printed
 * the help text and the blind listening gate — the half of the TTS decision that
 * latency cannot make — was unreachable. Help is now GENERATED from the same
 * table that dispatches, and a test asserts the two cannot diverge.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AudioCondition } from '@platform/providers';

/**
 * Load the repository-root `.env` into `process.env` without overriding
 * anything already set in the shell. That file is the single place for
 * provider keys; `benchmark/.env.benchmark` is a local symlink to it.
 */
function loadLocalEnvFiles(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const file = resolve(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
loadLocalEnvFiles();

import { validateCorpus, validateConsentOnly, loadManifest } from './corpus/loader.js';
import { buildScaffold } from './corpus/scaffold.js';
import { parseWorksheet, unfilledRows } from './corpus/worksheet.js';
import {
  ALLOWED_REGIONS, REGION_ENV_VAR, declaredRegion, requireRegion,
} from './config/region.js';
import { planSweep, renderPlan } from './runner/plan.js';
import { requireConsentFor, runE2eSweep, runSttSweep, runTtsSweep } from './runner/sweep.js';
import { renderE2eReport, renderSttReport, renderTtsReport } from './results/report.js';
import {
  LLM_ADAPTERS, missingCredentials, requiredProcessorIds, STT_ADAPTERS, TTS_ADAPTERS,
} from './adapters/registry.js';
import { poolRuns } from './results/pool.js';
import {
  estimateCost, parseRateCard, renderCostEstimate, type CostInput,
} from './cost/rates.js';
import { QUALITY_LINES } from './quality/lines.js';
import { writeBlindPack, type QualitySample } from './quality/blind.js';
import { MIN_SAMPLES_FOR_VERDICT } from './measure/verdict.js';
import { probeFfmpeg } from './audio/condition.js';
import type { RunMetadata } from './results/store.js';

export interface Args { readonly [key: string]: string | boolean }

/**
 * Every flag the CLI understands.
 *
 * An unrecognised flag is an ERROR, not something to ignore. A founder who caps
 * spend with a mistyped budget flag and gets the 500-call default instead has
 * been silently overruled on the one decision the flag existed to make.
 */
export const KNOWN_FLAGS: readonly string[] = [
  'manifest', 'condition', 'profile', 'runs-dir', 'kind', 'adapter',
  'max-calls', 'max-retries', 'seed', 'drain', 'confirm', 'run', 'out',
  'ignore-corpus-errors', 'rates', 'runs', 'stt', 'llm', 'tts',
  'sheet', 'speakers', 'corpus-version',
];

export function parseArgs(argv: readonly string[]): { command: string; args: Args } {
  const [command = 'help', ...rest] = argv;
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string;
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    // `--key=value` is the form most people type. Dropping it silently meant
    // `--max-calls=20` was stored under the key "max-calls=20" and the ceiling
    // stayed at its default.
    const equals = body.indexOf('=');
    let key: string;
    if (equals >= 0) {
      key = body.slice(0, equals);
      args[key] = body.slice(equals + 1);
    } else {
      key = body;
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i += 1; }
      else args[key] = true;
    }
    if (!KNOWN_FLAGS.includes(key)) {
      throw new Error(
        `Unknown flag --${key}. Known flags: ${KNOWN_FLAGS.map((f) => `--${f}`).join(', ')}. ` +
          'A mistyped budget flag must be an error, never a silent default.',
      );
    }
  }
  return { command, args };
}

/** A budget that cannot be parsed must stop the run, never become NaN. */
export function numericFlag(args: Args, key: string, fallback: number): number {
  const raw = args[key];
  if (raw === undefined) return fallback;
  if (typeof raw === 'boolean') {
    throw new Error(`--${key} needs a number, e.g. --${key} 20.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `--${key} must be a non-negative number, got "${raw}". A budget that is NaN is not a ` +
        'budget: it disables the ceiling it was typed to impose.',
    );
  }
  return value;
}

export interface CommandContext {
  readonly args: Args;
  readonly manifestPath: string | undefined;
  readonly condition: AudioCondition;
  readonly profile: string;
  readonly runsDir: string;
  readonly maxCalls: number;
  readonly maxRetries: number;
  readonly seed: number;
}

interface Command {
  readonly summary: string;
  readonly run: (context: CommandContext) => Promise<void>;
}

async function doctor(): Promise<void> {
  const ffmpeg = await probeFfmpeg();
  console.log('ffmpeg:', ffmpeg.available ? ffmpeg.version : 'NOT FOUND');
  console.log('narrowband encoders:', ffmpeg.narrowbandEncoders.join(', ') || 'NONE');
  if (ffmpeg.best) {
    console.log(`  → will use ${ffmpeg.best.encoder} (${ffmpeg.best.fidelity})`);
    if (!ffmpeg.best.encoder.includes('amr')) {
      console.log('  ⚠ this is NOT the mobile radio codec. Install an ffmpeg with');
      console.log('    libopencore-amrnb for the closest approximation, and note the');
      console.log('    substitution when reading results.');
    }
  } else {
    console.log('  ⚠ no narrowband ENCODER available (decoders alone are not enough).');
    console.log('    The narrowband condition will refuse to run rather than silently');
    console.log('    degrade to a plain downsample.');
  }
  // Every processor a sweep contacts, LLM included — it needs a key like the rest.
  const ids = new Set(requiredProcessorIds());
  const missing = missingCredentials([...ids]);
  console.log('\nCredentials:');
  for (const id of ids) {
    const gaps = missing[id];
    console.log(`  ${id.padEnd(12)} ${gaps ? `MISSING ${gaps.join(', ')}` : 'present'}`);
  }
  const region = declaredRegion();
  console.log('\nBenchmark region:');
  if (region) {
    const valid = ALLOWED_REGIONS.some((r) => r.toLowerCase() === region.toLowerCase());
    console.log(`  ${REGION_ENV_VAR}=${region} ${valid ? '(pre-registered)' : '⚠ NOT A PRE-REGISTERED REGION'}`);
  } else {
    console.log(`  ${REGION_ENV_VAR} is NOT SET — a spending run will refuse to start.`);
  }
  console.log(`  Pre-registered: ${ALLOWED_REGIONS.join(', ')}. Declared by the operator, never verified.`);

  console.log('\nNo credentials are read, printed or stored by this command.');
}

async function validate({ manifestPath }: CommandContext): Promise<void> {
  if (!manifestPath) throw new Error('--manifest is required');
  const result = await validateCorpus(manifestPath);
  console.log(`Corpus ${result.corpusVersion}: ${result.utteranceCount} utterances`);
  console.log('By language:', JSON.stringify(result.byLanguage));
  console.log('By environment:', JSON.stringify(result.byEnvironment));
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  for (const issue of result.issues) {
    const prefix = issue.severity === 'error' ? 'ERROR' : 'warn ';
    console.log(`  ${prefix} [${issue.utteranceId ?? '-'}] ${issue.message}`);
  }
  console.log(`\n${errors.length} errors, ${warnings.length} warnings`);
  if (!result.valid) {
    console.log('Corpus is INVALID. Fix the errors before running a sweep.');
    process.exitCode = 1;
  }
}

async function plan(context: CommandContext): Promise<void> {
  const { manifestPath, profile, condition, maxRetries, maxCalls } = context;
  if (!manifestPath) throw new Error('--manifest is required');
  const { manifest } = await loadManifest(manifestPath);
  // Real durations, read from the files. Estimating every utterance at half the
  // manifest's maximum put a 30 s figure on a 4 s recording — a plan that is
  // wrong by 5x is not a budget.
  const validation = await validateCorpus(manifestPath);
  const utterances = manifest.utterances.map((u) => ({
    id: u.utteranceId,
    durationMs: validation.durationsMs[u.utteranceId] ?? manifest.audio.maxDurationMs,
    language: u.language,
  }));
  const sweep = planSweep({
    profile,
    condition,
    sttAdapters: Object.keys(STT_ADAPTERS),
    ttsAdapters: Object.keys(TTS_ADAPTERS),
    // Real adapter ids when given, so the cost estimate can price the run.
    // Placeholder strings flowed straight into the rate-card key as
    // "<leading-stt>.stt", which can never match an entry — so the end-to-end
    // line was silently NOT PRICED for a reason that looked like a missing rate.
    endToEnd: {
      stt: typeof context.args['stt'] === 'string' ? context.args['stt'] : '<leading-stt>',
      tts: typeof context.args['tts'] === 'string' ? context.args['tts'] : '<leading-tts>',
      ...(typeof context.args['llm'] === 'string'
        ? { llm: context.args['llm'] }
        : Object.keys(LLM_ADAPTERS)[0]
          ? { llm: Object.keys(LLM_ADAPTERS)[0] as string }
          : {}),
    },
    utterances,
    ttsLines: QUALITY_LINES.map((l) => ({ id: l.lineId, text: l.text })),
    maxRetries,
    maxCalls,
    minSamplesForVerdict: MIN_SAMPLES_FOR_VERDICT,
  });
  console.log(renderPlan(sweep));

  // Cost estimation. Deliberately opt-in via --rates: a monetary total printed
  // from rates nobody verified is worse than no total, because it gets believed.
  const ratesPath = typeof context.args['rates'] === 'string' ? context.args['rates'] : undefined;
  if (ratesPath) {
    const card = parseRateCard(JSON.parse(await readFile(ratesPath, 'utf8')));
    const retryFactor = 1 + maxRetries;
    // TWO passes, because the pre-registered protocol runs each stack twice at
    // different times of day and pools. Pricing one pass halved the bill a
    // founder was using the estimate to decide whether to afford.
    const PASSES = 2;
    const inputs: CostInput[] = sweep.runs
      .filter((r) => r.executable)
      .flatMap((r) =>
        (['stt', 'llm', 'tts'] as const)
          .filter((service) => r.adapters[service] !== undefined)
          .flatMap((service) => {
            const adapter = r.adapters[service] as string;
            if (service !== 'stt') {
              return [{
                runId: r.runId,
                key: `${adapter}.${service}`,
                audioSeconds: 0,
                characters: service === 'tts' ? r.characters * retryFactor * PASSES : 0,
              }];
            }
            // Split by language so a variant rate (code-mixed audio is billed
            // differently by at least one candidate) can actually apply.
            return Object.entries(r.audioSecondsByLanguage).map(([language, seconds]) => ({
              runId: r.runId,
              key: `${adapter}.stt.${language}`,
              audioSeconds: seconds * retryFactor * PASSES,
              characters: 0,
            }));
          }),
      );
    console.log('');
    console.log(`Priced for ${PASSES} passes: the protocol runs each stack twice and pools.`);
    console.log(renderCostEstimate(estimateCost(inputs, card)));
  } else {
    console.log('');
    console.log('No --rates given, so nothing was priced. Pass --rates <rate-card.json> to');
    console.log('convert the units above into money. Rates are data, not code, and each one');
    console.log('records the page it came from and the date it was checked.');
  }

  console.log('\nNo provider was contacted. Nothing was spent.');
}

async function runCommand(context: CommandContext): Promise<void> {
  const { args, manifestPath, condition, profile, runsDir, maxCalls, maxRetries, seed } = context;
  if (!manifestPath) throw new Error('--manifest is required');
  const kind = args['kind'];
  if (kind !== 'stt' && kind !== 'tts' && kind !== 'e2e') {
    throw new Error('--kind must be stt, tts or e2e');
  }

  // An end-to-end run names three adapters, because it is the one run that
  // measures the whole chain. It is deliberately run LAST: "leading" is decided
  // by the component runs, and choosing the pair beforehand chooses the answer.
  const e2eAdapters = kind === 'e2e'
    ? {
        stt: typeof args['stt'] === 'string' ? args['stt'] : undefined,
        llm: typeof args['llm'] === 'string' ? args['llm'] : undefined,
        tts: typeof args['tts'] === 'string' ? args['tts'] : undefined,
      }
    : undefined;
  if (e2eAdapters && (!e2eAdapters.stt || !e2eAdapters.llm || !e2eAdapters.tts)) {
    throw new Error('--kind e2e requires --stt <id> --llm <id> --tts <id>');
  }
  if (e2eAdapters?.llm && !Object.keys(LLM_ADAPTERS).includes(e2eAdapters.llm)) {
    console.error(
      `No LLM adapter "${e2eAdapters.llm}" is registered. The end-to-end runner is implemented\n` +
        'and tested, but the model held constant has not been confirmed by the founder, so no\n' +
        'real LLM adapter exists. Registering one is a provider decision.',
    );
    process.exitCode = 1;
    return;
  }

  const adapterId = kind === 'e2e' ? undefined : args['adapter'];
  if (kind !== 'e2e' && typeof adapterId !== 'string') throw new Error('--adapter is required');

  const needed = kind === 'e2e'
    ? [e2eAdapters?.stt as string, e2eAdapters?.llm as string, e2eAdapters?.tts as string]
    : [adapterId as string];
  const gaps = missingCredentials(needed);
  if (Object.keys(gaps).length > 0) {
    for (const [id, missing] of Object.entries(gaps)) {
      console.error(`Adapter "${id}" needs ${missing.join(', ')} in the environment.`);
    }
    console.error('The benchmark will not run without them and will not fabricate a result.');
    process.exitCode = 1;
    return;
  }

  // The region is pre-registered and every latency figure depends on it. It is
  // the cheapest check there is, so it runs first.
  try {
    // Canonicalised, then written back, so a lower-case declaration and an
    // upper-case one do not read as two different regions when runs are pooled.
    process.env[REGION_ENV_VAR] = requireRegion();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const { manifest } = await loadManifest(manifestPath);

  // The corpus is validated BEFORE spending, not in a separate optional command.
  // A silent recording scores every provider as failing, and an over-long lead-in
  // inflates every latency figure — both would be paid for in full and then
  // attributed to the provider.
  let corpusErrors = 0;
  if (kind === 'stt' || kind === 'e2e') {
    const validation = await validateCorpus(manifestPath);
    corpusErrors = validation.issues.filter((i) => i.severity === 'error').length;
    const corpusWarnings = validation.issues.length - corpusErrors;
    console.log(`Corpus check: ${corpusErrors} errors, ${corpusWarnings} warnings`);
    if (corpusErrors > 0) {
      for (const issue of validation.issues.filter((i) => i.severity === 'error')) {
        console.error(`  ERROR [${issue.utteranceId ?? '-'}] ${issue.message}`);
      }
      if (args['ignore-corpus-errors'] !== true) {
        console.error(
          '\nRefusing to spend on an invalid corpus. Every one of those errors would be paid ' +
            'for and then attributed to the provider. Fix them, or pass --ignore-corpus-errors ' +
            'if you have decided the run is worth it anyway.',
        );
        process.exitCode = 1;
        return;
      }
      console.log('\n--ignore-corpus-errors given: proceeding despite the errors above.');
    }
  }

  // Consent is a PRE-FLIGHT, not a runtime check. Learning that the corpus does
  // not cover this provider should cost nothing and happen before --confirm.
  try {
    await requireConsentFor(manifestPath, needed);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const callCount = kind === 'stt' ? manifest.utterances.length
    : kind === 'tts' ? QUALITY_LINES.length
    : manifest.utterances.length * 3;
  const worstCase = callCount * (1 + maxRetries);
  const subject = kind === 'e2e'
    ? `${e2eAdapters?.stt} + ${e2eAdapters?.llm} + ${e2eAdapters?.tts}`
    : String(adapterId);
  console.log(`About to run: ${kind} / ${subject}`);
  console.log(`  provider calls: ${callCount} (worst case with retries: ${worstCase})`);
  console.log(`  condition:      ${condition}`);
  console.log(`  corpus:         ${manifest.corpusVersion}`);
  console.log(`  ceiling:        ${maxCalls} provider calls (retries included in the count)`);
  console.log(`  region:         ${declaredRegion()} (declared, not verified)`);
  if (callCount < MIN_SAMPLES_FOR_VERDICT) {
    console.log(
      `  ⚠ only ${callCount} samples; the decision rule needs ${MIN_SAMPLES_FOR_VERDICT}, so this ` +
        'run can only reach INCOMPLETE or FAIL — never PASS.',
    );
  }
  if (args['drain'] === true) {
    console.log('  --drain: full synthesis, and the audio is kept for the blind listening pack.');
  }

  if (args['confirm'] !== true) {
    console.log('\nDRY RUN — nothing executed. Re-run with --confirm to spend.');
    return;
  }

  const options = {
    profile, manifestPath, condition, runsDir,
    maxRetries, maxCalls, seed,
    drainTts: args['drain'] === true,
    concurrency: 1,
  };

  if (kind === 'e2e') {
    const outcome = await runE2eSweep(
      {
        stt: e2eAdapters?.stt as string,
        llm: e2eAdapters?.llm as string,
        tts: e2eAdapters?.tts as string,
      },
      options,
    );
    console.log(`\n${outcome.verdict.verdict} — results in ${outcome.directory}`);
  } else if (kind === 'stt') {
    const outcome = await runSttSweep(adapterId as string, options);
    console.log(`\n${outcome.verdict.verdict} — results in ${outcome.directory}`);
  } else {
    const lines = QUALITY_LINES.map((l) => ({
      lineId: l.lineId, text: l.text, language: l.language,
      codeMixed: l.probes.includes('code_switch'),
    }));
    const outcome = await runTtsSweep(adapterId as string, lines, options);
    console.log(`\n${outcome.verdict.verdict} — results in ${outcome.directory}`);
  }
}

async function qualityPack(context: CommandContext): Promise<void> {
  const { runsDir, seed, args } = context;
  const outDir = typeof args['out'] === 'string' ? args['out'] : join(runsDir, 'quality-pack');

  if (!existsSync(runsDir)) throw new Error(`No runs directory at ${runsDir}`);
  const samples: QualitySample[] = [];
  const sources: string[] = [];

  // The protocol runs each stack TWICE, so a naive walk of runs/ picks up two
  // directories per provider and hands the listener the same line twice from
  // one provider and once from another — an unequal, non-blind ballot. Keep the
  // FIRST run seen per (provider, line) and say what was skipped.
  const seen = new Set<string>();
  const skipped: string[] = [];
  const profiles = new Set<string>();

  for (const entry of (await readdir(runsDir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const dir = join(runsDir, entry.name);
    const metadataPath = join(dir, 'metadata.json');
    if (!existsSync(metadataPath)) continue;
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as RunMetadata;
    if (metadata.subject.kind !== 'tts') continue;
    const audioDir = join(dir, 'audio');
    if (!existsSync(audioDir)) continue;
    profiles.add(`${metadata.profile}/${metadata.corpus.corpusVersion}`);

    const rate = metadata.subject.outputSampleRate === 16000 ? 16000 : 8000;
    const encoding = metadata.subject.outputEncoding === 'mulaw' ? 'mulaw' as const : 'pcm16' as const;
    for (const file of await readdir(audioDir)) {
      if (!file.endsWith('.pcm')) continue;
      const lineId = file.replace(/\.pcm$/, '');
      const key = `${metadata.subject.adapterId}::${lineId}`;
      if (seen.has(key)) { skipped.push(`${key} (${entry.name})`); continue; }
      seen.add(key);
      samples.push({
        providerId: metadata.subject.adapterId,
        lineId,
        audio: new Uint8Array(await readFile(join(audioDir, file))),
        sampleRate: rate,
        encoding,
      });
    }
    sources.push(`${metadata.subject.adapterId} (${entry.name})`);
  }

  if (profiles.size > 1) {
    throw new Error(
      `Refusing to build one listening pack from different profiles or corpus versions: ` +
        `${[...profiles].join(', ')}. Listeners would be comparing voices across different ` +
        'inputs without knowing it. Point --runs-dir at one profile.',
    );
  }
  // Every provider must contribute the SAME lines, or the ballot is not blind:
  // a listener hearing one provider on the hard lines and another on the easy
  // ones is scoring the lines, not the voices.
  const byProvider = new Map<string, Set<string>>();
  for (const sample of samples) {
    const lines = byProvider.get(sample.providerId) ?? new Set();
    lines.add(sample.lineId);
    byProvider.set(sample.providerId, lines);
  }
  const lineCounts = new Set([...byProvider.values()].map((l) => l.size));
  if (lineCounts.size > 1) {
    throw new Error(
      'Providers contributed different numbers of lines: ' +
        [...byProvider.entries()].map(([id, l]) => `${id}=${l.size}`).join(', ') +
        '. A listener would be comparing voices on different material. Re-run the short ' +
        'provider, or trim to the common set deliberately.',
    );
  }
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} duplicate sample(s) from repeat runs.`);
  }

  if (samples.length === 0) {
    throw new Error(
      `No TTS audio found under ${runsDir}. Audio is only kept when a TTS run is executed ` +
        'with --drain; a latency-only run stops at the first byte and has nothing to listen to.',
    );
  }

  const { listenDir, mappingPath, blindSet } = await writeBlindPack(
    outDir, samples, QUALITY_LINES, seed,
  );
  console.log(`Built a blind pack of ${blindSet.order.length} samples from: ${sources.join(', ')}`);
  console.log(`  give the listener: ${listenDir}`);
  console.log(`  keep to yourself:  ${mappingPath}`);
  console.log(
    '\nThe listener folder carries no provider information and the presentation order is\n' +
      `shuffled from seed ${seed}. Gate: any candidate 2 of 3 listeners mark unacceptable is\n` +
      'excluded, before any cheapest-passing tiebreak.',
  );
}

async function report({ args }: CommandContext): Promise<void> {
  const runDir = args['run'];
  if (typeof runDir !== 'string') throw new Error('--run <run-dir> is required');
  const metadata = JSON.parse(
    await readFile(join(runDir, 'metadata.json'), 'utf8'),
  ) as RunMetadata;
  const { aggregate, verdict } = JSON.parse(
    await readFile(join(runDir, 'metrics.json'), 'utf8'),
  ) as { aggregate: never; verdict: never };

  const markdown =
    metadata.subject.kind === 'stt' ? renderSttReport(metadata, aggregate, verdict)
    : metadata.subject.kind === 'tts' ? renderTtsReport(metadata, aggregate, verdict)
    : renderE2eReport(metadata, aggregate, verdict);
  const out = join(runDir, 'report.md');
  await writeFile(out, markdown, 'utf8');
  console.log(markdown);
  console.log(`\nWritten to ${out}`);
}

/**
 * Validate consent alone, before anything is recorded.
 *
 * The sweep already refuses to contact an undisclosed processor — but finding
 * that out after a recording session means re-contacting every participant, so
 * the same rule is available here, free, before a microphone is switched on.
 */
async function consent({ manifestPath }: CommandContext): Promise<void> {
  if (!manifestPath) throw new Error('--manifest is required');
  // Deliberately does NOT require a complete corpus: this is the check you want
  // the moment BEFORE a recording session, when there are no utterances yet.
  const { speakers, issues } = await validateConsentOnly(manifestPath);
  const errors = issues.filter((i) => i.severity === 'error');

  console.log(`Consent check — ${speakers} speaker(s)`);
  console.log(`  processors a full sweep will contact: ${requiredProcessorIds().join(', ')}`);
  console.log('');
  if (issues.length === 0) {
    console.log('  Every speaker was told about every processor, and every entry says where.');
  }
  for (const issue of issues) {
    console.log(`  ${issue.severity === 'error' ? 'ERROR' : 'warn '} ${issue.message}`);
  }
  console.log('');
  console.log('  The LLM is on that list because it receives the speech-to-text transcript —');
  console.log('  candidate speech content, and therefore personal data.');
  if (errors.length > 0) {
    console.log('\nConsent is INCOMPLETE. A sweep will refuse to run.');
    process.exitCode = 1;
  }
}

/**
 * Generate the shape a recording session records into.
 *
 * Structure only: identifiers, conversation grouping, turn order, file paths,
 * language and environment labels, and the consent block. It writes no
 * reference sentences and chooses no words — that is the ground truth the whole
 * benchmark rests on, and it is a human judgement.
 */
async function scaffold(context: CommandContext): Promise<void> {
  const out = typeof context.args['out'] === 'string' ? context.args['out'] : undefined;
  if (!out) throw new Error('--out <corpus-directory> is required');
  const speakers = (typeof context.args['speakers'] === 'string'
    ? context.args['speakers'].split(',')
    : []
  ).map((s) => s.trim()).filter(Boolean);
  const corpusVersion = typeof context.args['corpus-version'] === 'string'
    ? context.args['corpus-version']
    : 'v1';

  const built = buildScaffold({ corpusVersion, speakerIds: speakers });

  // Guard EVERY file it writes, not just the manifest. The founder's
  // transcription work lives in references.tsv — a day of writing 80 references
  // and 68 entity expectations — and re-running scaffold silently replaced it
  // with an empty one while the error message talked about the manifest.
  const wouldOverwrite = ['manifest.json', 'references.tsv', 'RECORDING_SHEET.md']
    .filter((name) => existsSync(join(out, name)));
  if (wouldOverwrite.length > 0) {
    throw new Error(
      `Refusing to overwrite: ${wouldOverwrite.join(', ')} in ${out}. references.tsv holds the ` +
        'references and entity expectations somebody wrote by hand, and regenerating it would ' +
        'silently replace a day of work with empty rows. Scaffold into a new directory, or move ' +
        'the existing files aside deliberately.',
    );
  }
  await mkdir(join(out, 'audio'), { recursive: true });
  await writeFile(join(out, 'manifest.json'), JSON.stringify(built.manifest, null, 2) + '\n', 'utf8');
  await writeFile(join(out, 'references.tsv'), built.worksheet, 'utf8');
  await writeFile(join(out, 'RECORDING_SHEET.md'), built.sheet, 'utf8');

  console.log(`Scaffolded ${built.rows.length} recording slots in ${out}`);
  console.log(`  manifest.json        consent block — fill in the dates, contact and processors`);
  console.log(`  references.tsv       one row per recording — fill in reference and entities`);
  console.log(`  RECORDING_SHEET.md   what to do, printable`);
  console.log('');
  console.log('  audio/               record into here, named exactly as the worksheet says');
  console.log('');
  console.log('Nothing was contacted. No reference text was invented — that is yours to write.');
}

/** Merge a filled worksheet into the manifest, then validate. */
async function reference(context: CommandContext): Promise<void> {
  const { manifestPath } = context;
  if (!manifestPath) throw new Error('--manifest is required');
  const sheetPath = typeof context.args['sheet'] === 'string' ? context.args['sheet'] : undefined;
  if (!sheetPath) throw new Error('--sheet <references.tsv> is required');

  const rows = parseWorksheet(await readFile(sheetPath, 'utf8'));
  const pending = unfilledRows(rows);
  if (pending.length > 0) {
    console.log(`${pending.length} of ${rows.length} rows still have no reference:`);
    for (const row of pending.slice(0, 10)) console.log(`  ${row.utteranceId}`);
    if (pending.length > 10) console.log(`  … and ${pending.length - 10} more`);
    console.log('');
    console.log('Those rows are SKIPPED, not stubbed — a blank reference would be ground truth');
    console.log('nobody wrote, and every provider would be scored against it.');
    console.log('');
  }

  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

  // The worksheet is the source of truth for utterances, so this replaces the
  // array — but replacing it must never DELETE an utterance nobody put in the
  // worksheet. That would be silent data loss of hand-written ground truth.
  const existing = (raw['utterances'] as { utteranceId?: string }[] | undefined) ?? [];
  const inSheet = new Set(rows.map((r) => r.utteranceId));
  const orphaned = existing
    .map((u) => u.utteranceId)
    .filter((id): id is string => typeof id === 'string' && !inSheet.has(id));
  if (orphaned.length > 0) {
    throw new Error(
      `The manifest holds ${orphaned.length} utterance(s) the worksheet does not mention: ` +
        `${orphaned.slice(0, 5).join(', ')}${orphaned.length > 5 ? ', …' : ''}. Rewriting the ` +
        'array would delete them. Add them to the worksheet, or edit the manifest directly and ' +
        'stop using the worksheet for this corpus — but do not let a merge quietly drop ground ' +
        'truth somebody wrote.',
    );
  }

  const merged = rows
    .filter((row) => row.reference.trim() !== '')
    .map((row) => ({
      utteranceId: row.utteranceId,
      file: row.file,
      language: row.language,
      codeMixed: row.codeMixed,
      reference: row.reference,
      ...(row.referenceAlt.trim() ? { referenceAlt: row.referenceAlt } : {}),
      entities: row.entities,
      speakerId: row.speakerId,
      environment: row.environment,
      conversationId: row.conversationId,
      turnIndex: row.turnIndex,
    }));

  // Validate the CANDIDATE before it replaces anything on disk. Writing first
  // and validating second means a bad worksheet leaves the manifest broken and
  // the previous good state gone.
  const candidatePath = `${manifestPath}.candidate`;
  await writeFile(
    candidatePath, JSON.stringify({ ...raw, utterances: merged }, null, 2) + '\n', 'utf8',
  );
  const result = await validateCorpus(candidatePath);
  const blocking = result.issues.filter(
    (i) => i.severity === 'error' && !i.message.startsWith('Audio file not found'),
  );
  if (blocking.length > 0) {
    await rm(candidatePath, { force: true });
    for (const issue of blocking) {
      console.error(`  ERROR [${issue.utteranceId ?? '-'}] ${issue.message}`);
    }
    console.error(
      `\n${blocking.length} error(s). The manifest was NOT modified — fix the worksheet and ` +
        're-run. (Missing audio files are not counted here: references are often written before ' +
        'every take is recorded.)',
    );
    process.exitCode = 1;
    return;
  }

  await writeFile(manifestPath, JSON.stringify({ ...raw, utterances: merged }, null, 2) + '\n', 'utf8');
  await rm(candidatePath, { force: true });
  console.log(`Wrote ${merged.length} utterances into ${manifestPath}`);
  console.log('');
  const errors = result.issues.filter((i) => i.severity === 'error');
  for (const issue of result.issues) {
    console.log(`  ${issue.severity === 'error' ? 'ERROR' : 'warn '} [${issue.utteranceId ?? '-'}] ${issue.message}`);
  }
  console.log(`\n${errors.length} errors, ${result.issues.length - errors.length} warnings`);
  if (errors.length > 0) process.exitCode = 1;
}

/**
 * Pool two or more runs of the same stack into one sample.
 *
 * The pre-registered rule is two runs at different times of day, POOLED — not
 * two verdicts compared, which invites picking the flattering one. Pooling also
 * gives the p95 real resolution: at n=30 the p95 IS the second-largest value,
 * so one outlier decides it.
 */
async function pool(context: CommandContext): Promise<void> {
  const raw = context.args['runs'];
  if (typeof raw !== 'string') {
    throw new Error('--runs <dir1,dir2[,dir3]> is required (at least two run directories)');
  }
  const directories = raw.split(',').map((d) => d.trim()).filter(Boolean);
  const pooled = await poolRuns(directories);

  const outDir = typeof context.args['out'] === 'string'
    ? context.args['out']
    : join(context.runsDir, `pooled-${pooled.metadata.subject.kind}-${pooled.metadata.subject.adapterId}`);

  console.log(`Pooled ${directories.length} runs of ${pooled.metadata.subject.adapterId} (${pooled.kind}):`);
  for (const directory of directories) console.log(`  ${directory}`);
  console.log('');
  console.log(`  pooled sample: n = ${pooled.aggregate.sampleCount}`);
  console.log(`  corpus:        ${pooled.metadata.corpus.corpusVersion} / ${pooled.metadata.corpus.condition}`);
  console.log('');
  console.log('Recomputed from raw.jsonl, never from the stored aggregates — a pooled figure');
  console.log('derived from other aggregates could not be audited back to a measurement.');

  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, 'pooled.json'),
    JSON.stringify(pooled, null, 2) + '\n',
    'utf8',
  );
  console.log(`\nWritten to ${join(outDir, 'pooled.json')}`);
}

/** The single source of truth for what exists. Help is generated from it. */
export const COMMANDS: Readonly<Record<string, Command>> = {
  doctor: { summary: 'Check the local environment (ffmpeg, credentials).', run: doctor },
  scaffold: { summary: 'Generate the recording slots, worksheet and consent block.', run: scaffold },
  reference: { summary: 'Merge a filled worksheet into the manifest, then validate.', run: reference },
  validate: { summary: 'Check the corpus. Makes NO provider calls and costs nothing.', run: validate },
  consent: { summary: 'Check consent covers every processor. Free, before recording.', run: consent },
  plan: { summary: 'Show exactly what a sweep would execute and what it would spend.', run: plan },
  run: { summary: 'Execute one run. Requires --confirm.', run: runCommand },
  'quality-pack': { summary: 'Build the blind listening pack from drained TTS runs.', run: qualityPack },
  pool: { summary: 'Pool repeat runs of one stack into a single sample.', run: pool },
  report: { summary: 'Render a stored run as markdown.', run: report },
};

export function help(): string {
  const commands = Object.entries(COMMANDS)
    .map(([name, c]) => `  ${name.padEnd(14)}${c.summary}`)
    .join('\n');
  return `
Phase 5C benchmark harness

${commands}

Common flags
  --manifest <path>     corpus manifest (required for validate/plan/run)
  --condition <name>    clean_16k | narrowband_8k | narrowband_8k_noisy   [narrowband_8k]
  --profile <name>      run-id prefix                                     [phase-5c]
  --runs-dir <path>     where runs are written                            [./runs]
  --out <path>          where the quality pack is written
  --kind stt|tts|e2e    what to run
  --adapter <id>        adapter id (stt/tts runs)
  --stt --llm --tts     adapter ids for an end-to-end run
  --runs <a,b>          run directories to pool
  --sheet <path>        filled worksheet, for the reference command
  --speakers <a,b>      pseudonymous speaker ids, for the scaffold command
  --corpus-version <v>  corpus version, for the scaffold command
  --rates <path>        rate card, to price a plan in money
  --max-calls <n>       hard ceiling on provider calls, retries included  [500]
  --max-retries <n>     retries per call on transient faults              [2]
  --seed <n>            PRNG seed, recorded in metadata                   [42]
  --drain               fully synthesise TTS and keep the audio           [off]
  --ignore-corpus-errors  spend anyway on a corpus that failed validation
  --confirm             actually spend money
`;
}

export async function main(argv: readonly string[]): Promise<void> {
  const { command, args } = parseArgs(argv);
  const handler = COMMANDS[command];
  if (!handler) {
    console.log(help());
    return;
  }

  const runsDir = typeof args['runs-dir'] === 'string'
    ? resolve(args['runs-dir'])
    : join(process.cwd(), 'runs');
  if (!runsDir.split(sep).includes('benchmark')) {
    console.warn(
      `⚠ Run output is going to ${runsDir}, which is outside the benchmark package.\n` +
        '  Run output contains transcripts of real people. Check it is gitignored.',
    );
  }

  await handler.run({
    args,
    manifestPath: typeof args['manifest'] === 'string' ? args['manifest'] : undefined,
    condition: (typeof args['condition'] === 'string'
      ? args['condition']
      : 'narrowband_8k') as AudioCondition,
    profile: typeof args['profile'] === 'string' ? args['profile'] : 'phase-5c',
    runsDir,
    maxCalls: numericFlag(args, 'max-calls', 500),
    maxRetries: numericFlag(args, 'max-retries', 2),
    seed: numericFlag(args, 'seed', 42),
  });
}

// Only run when invoked as a program, so tests can import the table.
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
