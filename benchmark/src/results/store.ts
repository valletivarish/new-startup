/**
 * Result persistence.
 *
 * RAW FIRST. Every measurement is appended to `raw.jsonl` as it happens, before
 * any aggregation. If the process dies mid-sweep the completed work survives,
 * and every aggregate figure can be recomputed from the raw file — which is the
 * only way a verdict is auditable rather than merely asserted.
 *
 * Runs are never overwritten. A run directory that already exists is an error,
 * not a prompt to replace it.
 *
 * Files are written under `runs/<run-id>/`:
 *   metadata.json  what was run, with what code, against what corpus
 *   raw.jsonl      one row per measurement, append-only
 *   metrics.json   aggregates, recomputable from raw.jsonl
 *   errors.json    every failure, categorised
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { redact } from '../adapters/http.js';
import { declaredRegion } from '../config/region.js';

const run = promisify(execFile);

/**
 * Everything needed to reproduce a run.
 *
 * A future reader must be able to answer: which corpus, which code, which
 * configuration, which machine, when. Anything less and the number is a claim
 * rather than a measurement.
 */
export interface RunMetadata {
  readonly runId: string;
  readonly benchmarkVersion: string;
  readonly profile: string;
  readonly startedAt: string;
  readonly finishedAt?: string;

  readonly corpus: {
    readonly manifestPath: string;
    readonly corpusVersion: string;
    readonly utteranceCount: number;
    readonly condition: string;
    /**
     * SHA-256 per utterance of the CONDITIONED audio — the common source every
     * adapter's input was derived from.
     *
     * It is not the same thing as what a provider received: each adapter
     * declares its own input format and the runner converts before sending, so
     * two adapters requesting different formats legitimately see different
     * bytes. The post-conversion checksum is recorded per row as
     * `deliveredChecksum`, and the two together are what make "identical input"
     * a checkable claim rather than an assertion.
     */
    readonly inputChecksums: Readonly<Record<string, string>>;
    /** The narrowband codec actually applied, or null when the path is lossless. */
    readonly codec?: string | null;
  };

  readonly subject: {
    readonly kind: 'stt' | 'tts' | 'end_to_end';
    readonly adapterId: string;
    readonly adapterVersion: string;
    readonly model: string;
    readonly unverified: boolean;
    readonly streaming: boolean;
    /** Verbatim vs provider-formatted text, for STT. */
    readonly textNormalisation?: string;
    /** Output sample rate, for TTS — needed to wrap stored samples as WAV. */
    readonly outputSampleRate?: number;
    /** Output encoding, for TTS. Providers do not agree, so it must be recorded. */
    readonly outputEncoding?: string;
    /**
     * Non-secret, behaviour-changing configuration: region, voice, speaker,
     * API version. Without these a run cannot be reproduced or even correctly
     * read — a TTS figure means nothing without knowing which voice produced it.
     */
    readonly parameters?: Readonly<Record<string, string>>;
  };

  readonly configuration: {
    readonly maxRetries: number;
    readonly concurrency: number;
    readonly maxCalls: number;
    readonly drainTts: boolean;
    readonly seed: number;
  };

  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    readonly gitCommit: string | null;
    readonly gitDirty: boolean | null;
    readonly ffmpeg: string | null;
    readonly host: string;
    /**
     * The pre-registered benchmark region, as DECLARED by the operator.
     *
     * Bangalore (BLR1) — see `src/config/region.ts` for why the location is
     * part of the protocol rather than an operational detail. This value is
     * declared, never proven: nothing inside the process can verify where the
     * machine is, and every report says so rather than implying otherwise.
     */
    readonly region?: string;
  };
}

export type RawRowKind = 'stt' | 'tts' | 'turn' | 'note';

export interface RawRow {
  readonly kind: RawRowKind;
  readonly at: string;
  readonly utteranceId?: string;
  readonly lineId?: string;
  /** The full measurement payload. Deliberately unshaped so nothing is lost. */
  readonly payload: unknown;
}

export const BENCHMARK_VERSION = '5c.1.0';

async function gitInfo(): Promise<{ commit: string | null; dirty: boolean | null }> {
  try {
    const { stdout } = await run('git', ['rev-parse', 'HEAD']);
    let dirty: boolean | null = null;
    try {
      const status = await run('git', ['status', '--porcelain']);
      dirty = status.stdout.trim().length > 0;
    } catch { /* not fatal */ }
    return { commit: stdout.trim(), dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

export async function collectEnvironment(): Promise<RunMetadata['environment']> {
  const { commit, dirty } = await gitInfo();
  let ffmpeg: string | null = null;
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-version']);
    ffmpeg = stdout.split('\n')[0] ?? null;
  } catch { /* absent */ }

  const { hostname } = await import('node:os');
  const region = declaredRegion();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    gitCommit: commit,
    gitDirty: dirty,
    ffmpeg,
    host: hostname(),
    ...(region ? { region } : {}),
  };
}

export class RunExistsError extends Error {
  constructor(dir: string) {
    super(
      `Run directory already exists: ${dir}. Benchmark runs are never overwritten — ` +
        'previous evidence must remain intact. Use a different run id.',
    );
    this.name = 'RunExistsError';
  }
}

export class RunStore {
  private readonly dir: string;
  private rows = 0;

  constructor(rootDir: string, private readonly metadata: RunMetadata) {
    this.dir = join(rootDir, metadata.runId);
  }

  get directory(): string {
    return this.dir;
  }

  /**
   * metadata.json goes through redact() like every other artifact.
   *
   * It was the ONE file written with a bare JSON.stringify — and it is the file
   * that carries `subject.parameters`, which every adapter populates straight
   * from `process.env`. A single mis-declared optional variable (a key pasted
   * into AZURE_TTS_VOICE, say) would have been written to disk in clear text
   * while the redaction of the other three files carried on looking careful.
   */
  private serialiseMetadata(extra: Record<string, unknown> = {}): string {
    return redact(JSON.stringify({ ...this.metadata, ...extra }, null, 2)) + '\n';
  }

  async open(): Promise<void> {
    if (existsSync(this.dir)) throw new RunExistsError(this.dir);
    // Create the leaf NON-recursively so the filesystem itself enforces the
    // "never overwrite a run" rule. `mkdir(recursive: true)` succeeds silently
    // on an existing directory, so the existsSync check above was a TOCTOU: two
    // concurrent sweeps with the same deterministic run id both passed it and
    // then interleaved their rows into one raw.jsonl.
    await mkdir(dirname(this.dir), { recursive: true });
    try {
      await mkdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new RunExistsError(this.dir);
      }
      throw error;
    }
    await writeFile(join(this.dir, 'metadata.json'), this.serialiseMetadata(), 'utf8');
  }

  /** Append one raw measurement. Called as results arrive, never batched. */
  async raw(row: RawRow): Promise<void> {
    this.rows += 1;
    // Redact on the way to disk: run output gets shared, and a credential in
    // an error message would be a real incident.
    const line = redact(JSON.stringify(row));
    await appendFile(join(this.dir, 'raw.jsonl'), line + '\n', 'utf8');
  }

  async metrics(value: unknown): Promise<void> {
    // Redacted like every other artifact. metrics.json embeds the same failure
    // records as errors.json — including provider error bodies — so leaving it
    // unredacted made the redaction of the other two files pointless.
    await writeFile(
      join(this.dir, 'metrics.json'),
      redact(JSON.stringify(value, null, 2)) + '\n',
      'utf8',
    );
  }

  /** Persist a synthesised sample for the blind listening gate. */
  async audio(name: string, bytes: Uint8Array): Promise<void> {
    const dir = join(this.dir, 'audio');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
  }

  async errors(value: unknown): Promise<void> {
    await writeFile(
      join(this.dir, 'errors.json'),
      redact(JSON.stringify(value, null, 2)) + '\n',
      'utf8',
    );
  }

  async close(finishedAt: string): Promise<void> {
    await writeFile(
      join(this.dir, 'metadata.json'),
      this.serialiseMetadata({ finishedAt, rawRowCount: this.rows }),
      'utf8',
    );
  }
}

/** Read a run's raw rows back — the basis for recomputing any aggregate. */
export async function readRaw(runDir: string): Promise<RawRow[]> {
  const text = await readFile(join(runDir, 'raw.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RawRow);
}
